use super::*;

fn epoch(gateway: &Gateway, id: &str) -> Option<String> {
    gateway.session.lock().unwrap().as_ref().filter(|s| s.id == id).map(|s| s.epoch.clone())
}
fn bounds(value: &Value) -> bool {
    observation::keys(value, &["min", "max"]) && ["min", "max"].iter().all(|k|
        value[*k].as_array().is_some_and(|a| a.len() == 3 && a.iter().all(|v| v.as_f64().is_some_and(|n| n.is_finite() && n.abs() <= 100000.0))))
}
fn valid(summary: &Value) -> bool {
    if !observation::keys(summary, &["frame", "contentFrame", "signature", "contextLost", "capturedAt", "particles", "color", "pointSize", "brightness", "parts", "bounds"]) { return false; }
    if !summary["contentFrame"].as_u64().is_some_and(|n| n > 0 && n <= summary["frame"].as_u64().unwrap_or(0)) || summary["contextLost"] != false || !summary["frame"].as_u64().is_some_and(|n| n > 0)
        || summary["signature"].as_u64().is_none() || !summary["particles"].as_u64().is_some_and(|n| n > 0 && n <= 10000) { return false; }
    if !summary["capturedAt"].as_u64().is_some_and(|at| at.abs_diff(now()) <= 2000) { return false; }
    if !["pointSize", "brightness"].iter().all(|k| summary[*k].as_f64().is_some_and(|n| n.is_finite() && (0.0..=100.0).contains(&n))) { return false; }
    if !summary["color"].as_str().is_some_and(|s| s.len() == 7 && s.starts_with('#') && s[1..].bytes().all(|b| b.is_ascii_hexdigit())) { return false; }
    if !bounds(&summary["bounds"]) { return false; }
    summary["parts"].as_array().is_some_and(|parts| parts.len() <= 24 && parts.iter().all(|p|
        observation::keys(p, &["id", "kind", "particles", "bounds"]) && p["particles"].as_u64().is_some_and(|n| n <= 10000 && (if n == 0 { p["bounds"].is_null() } else { bounds(&p["bounds"]) })) && p["id"].as_str().is_some_and(|s| !s.is_empty() && s.len() <= 32 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-'))
        && p["kind"].as_str().is_some_and(|s| ["curve", "ellipsoid", "patch"].contains(&s))))
}
pub(super) fn receive(inner: &mut Inner, value: Value) -> bool {
    if !observation::keys(&value, &["type", "id", "epoch", "summary"]) || !valid(&value["summary"])
        || !value["epoch"].as_str().is_some_and(|s| uuid::Uuid::parse_str(s).is_ok()) { return false; }
    if inner.output.as_ref().is_some_and(|(id, _)| value["id"] == *id) {
        if let Some((_, reply)) = inner.output.take() { let _ = reply.send(value); }
    }
    true
}
pub async fn inspect(State(gateway): State<Gateway>, Path(id): Path<String>, Json(request): Json<Value>) -> Response {
    if request != json!({}) { return error(StatusCode::BAD_REQUEST, "render_arguments"); }
    if !active(&gateway, &id) { return error(StatusCode::NOT_FOUND, "session_closed"); }
    let Some(owner) = epoch(&gateway, &id) else { return error(StatusCode::NOT_FOUND, "session_closed"); };
    let (reply, receive) = oneshot::channel(); let request_id = uuid::Uuid::new_v4().to_string();
    let connection;
    {
        let mut inner = gateway.live.inner.lock().unwrap();
        connection = inner.generation.clone();
        if inner.output.is_some() || inner.last_output.is_some_and(|last| last.elapsed() < Duration::from_secs(1)) { return error(StatusCode::TOO_MANY_REQUESTS, "render_rate_limited"); }
        let Some(sender) = inner.sender.clone() else { return error(StatusCode::SERVICE_UNAVAILABLE, "live_disconnected"); };
        if sender.try_send(json!({"type":"inspect_expression", "id":request_id, "epoch":owner})).is_err() { return error(StatusCode::SERVICE_UNAVAILABLE, "live_mailbox_full"); }
        inner.output = Some((request_id.clone(), reply)); inner.last_output = Some(Instant::now());
    }
    let result = tokio::time::timeout(Duration::from_secs(2), receive).await;
    let mut inner = gateway.live.inner.lock().unwrap();
    if inner.output.as_ref().is_some_and(|(key, _)| *key == request_id) { inner.output = None; }
    let same_connection = inner.generation == connection && inner.sender.is_some();
    drop(inner);
    if !same_connection || !active(&gateway, &id) || epoch(&gateway, &id).as_deref() != Some(&owner) { return error(StatusCode::CONFLICT, "render_epoch_changed"); }
    match result {
        Ok(Ok(value)) if value["epoch"] == owner => Json(json!({"schemaVersion":1, "source":"fisch-renderer", "format":"structured", "session":id, "epoch":owner,
            "requestId":request_id, "receivedAt":now(), "summary":value["summary"], "evidence":"submitted particle buffers grouped by authored part index and style; bounds are renderer coordinates, not pixels, recognition or camera"})).into_response(),
        _ => error(StatusCode::GATEWAY_TIMEOUT, "render_refresh_unavailable"),
    }
}
