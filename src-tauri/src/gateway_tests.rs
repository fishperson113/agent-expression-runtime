use super::gateway::*;
use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use tower::ServiceExt;
#[test]
fn browser_port_search_spans_the_range_instead_of_staying_in_reserved_blocks() {
    let ports: std::collections::HashSet<_> = (0..16384).map(|i| browser_port(15000, i)).collect();
    assert_eq!(ports.len(), 16384);
    assert!(ports.iter().all(|port| (49152..=65535).contains(port)));
    assert!((0..4).any(|i| !(63936..=65135).contains(&browser_port(15000, i))));
}
#[tokio::test]
async fn stalled_admission_revokes_its_session_and_frees_gateway_slots() {
    let g = Gateway::new();
    let owner = g.clone();
    g.subscribe(Arc::new(move |event| {
        if event.kind != "expression" { owner.control_ack(event.epoch); }
        Ok(())
    }));
    let app = g.router();
    let first = json_response(app.clone().oneshot(request(&g, "/v1/sessions", Some(json!({}))))
        .await.unwrap()).await;
    let url = format!("/v1/sessions/{}/expressions", first["id"].as_str().unwrap());
    let response = app.clone().oneshot(request(&g, &url, Some(json!({
        "epoch": first["epoch"], "requestId": "stalled", "body": {"type":"wait","durationMs":1}
    })))).await.unwrap();
    assert_eq!(json_response(response).await["status"], "pending");
    tokio::time::sleep(std::time::Duration::from_millis(1600)).await;
    let second = json_response(app.clone().oneshot(request(&g, "/v1/sessions", Some(json!({}))))
        .await.unwrap()).await;
    assert_ne!(first["id"], second["id"]);
    let url = format!("/v1/sessions/{}/expressions", second["id"].as_str().unwrap());
    let response = app.oneshot(request(&g, &url, Some(json!({
        "epoch": second["epoch"], "requestId": "new", "body": {"type":"wait","durationMs":1}
    })))).await.unwrap();
    assert_eq!(response.status(), StatusCode::ACCEPTED);
}
#[tokio::test]
async fn compiler_diagnostic_path_survives_receipt_and_dedup() {
    let g = Gateway::new();
    let owner = g.clone();
    g.subscribe(Arc::new(move |event| {
        let gateway = owner.clone();
        if event.kind == "expression" {
            tokio::spawn(async move {
                gateway.finish_diagnostic(event.id, "rejected".into(), Some("range".into()),
                    Some("$.body.children[1].durationMs".into()));
            });
        } else { gateway.control_ack(event.epoch); }
        Ok(())
    }));
    let app = g.router();
    let session = json_response(app.clone().oneshot(request(&g, "/v1/sessions", Some(json!({}))))
        .await.unwrap()).await;
    let url = format!("/v1/sessions/{}/expressions", session["id"].as_str().unwrap());
    for _ in 0..2 {
        let response = app.clone().oneshot(request(&g, &url, Some(json!({
            "epoch": session["epoch"], "requestId": "bad-node", "body": {}
        })))).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(json_response(response).await["path"], "$.body.children[1].durationMs");
    }
}
#[tokio::test]
async fn browser_renderer_connection_is_bounded_and_released_on_disconnect() {
    let (g, _) = connected();
    let app = g.router();
    let first = app
        .clone()
        .oneshot(request(&g, "/v1/renderer/events", None))
        .await
        .unwrap();
    assert_eq!(first.status(), StatusCode::OK);
    assert_eq!(
        app.clone()
            .oneshot(request(&g, "/v1/renderer/events", None))
            .await
            .unwrap()
            .status(),
        StatusCode::TOO_MANY_REQUESTS
    );
    drop(first);
    assert_eq!(
        app.oneshot(request(&g, "/v1/renderer/events", None))
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
}
#[tokio::test]
async fn lease_refreshes_on_activity_and_expires_cleanly() {
    let (g, _) = connected();
    let app = g.router();
    let first = json_response(
        app.clone()
            .oneshot(request(&g, "/v1/sessions", Some(json!({}))))
            .await
            .unwrap(),
    )
    .await;
    g.expire_session_for_test();
    let path = format!("/v1/sessions/{}/expressions", first["id"].as_str().unwrap());
    assert_eq!(app.clone().oneshot(request(&g,&path,Some(json!({"epoch":first["epoch"],"requestId":"keepalive","body":{"type":"wait","durationMs":1}})))).await.unwrap().status(),StatusCode::ACCEPTED);
    assert_eq!(
        app.clone()
            .oneshot(request(&g, "/v1/sessions", Some(json!({}))))
            .await
            .unwrap()
            .status(),
        StatusCode::CONFLICT
    );
    g.expire_session_for_test();
    let second = json_response(
        app.oneshot(request(&g, "/v1/sessions", Some(json!({}))))
            .await
            .unwrap(),
    )
    .await;
    assert_ne!(first["id"], second["id"]);
}
#[tokio::test]
async fn cors_preflight_allows_only_explicit_origin_methods_and_headers_without_token() {
    let g = Gateway::new().with_test_origin("http://127.0.0.1:5173");
    let req = |origin: &str| {
        Request::builder()
            .method("OPTIONS")
            .uri("/v1/sessions")
            .header("host", "127.0.0.1:1234")
            .header("origin", origin)
            .header("access-control-request-method", "POST")
            .header(
                "access-control-request-headers",
                "authorization,content-type",
            )
            .body(Body::empty())
            .unwrap()
    };
    let response = g
        .router()
        .oneshot(req("http://127.0.0.1:5173"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        response.headers()["access-control-allow-origin"],
        "http://127.0.0.1:5173"
    );
    assert_eq!(
        g.router()
            .oneshot(req("https://other.example"))
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
}
#[tokio::test]
async fn capabilities_match_the_shared_typescript_manifest() {
    let (g, _) = connected();
    let response = g
        .router()
        .oneshot(request(&g, "/v1/capabilities", None))
        .await
        .unwrap();
    let expected: Value =
        serde_json::from_str(include_str!("../../src/contracts/capabilities.json")).unwrap();
    assert_eq!(json_response(response).await, expected);
}
#[tokio::test]
async fn revoked_session_closes_sse_and_releases_consumer_permits() {
    use http_body_util::BodyExt;
    let (g, _) = connected();
    for _ in 0..6 {
        let app = g.router();
        let session = json_response(
            app.clone()
                .oneshot(request(&g, "/v1/sessions", Some(json!({}))))
                .await
                .unwrap(),
        )
        .await;
        let path = format!("/v1/sessions/{}/events", session["id"].as_str().unwrap());
        let response = app.oneshot(request(&g, &path, None)).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let mut body = response.into_body();
        assert!(body.frame().await.is_some());
        g.revoke();
        let closed = body.frame().await.unwrap().unwrap().into_data().unwrap();
        assert!(String::from_utf8_lossy(&closed).contains("closed"));
        assert!(body.frame().await.is_none());
    }
}
fn request(g: &Gateway, path: &str, body: Option<Value>) -> Request<Body> {
    let mut b = Request::builder()
        .uri(path)
        .header("host", "127.0.0.1:12345")
        .header(
            "authorization",
            format!("Bearer {}", g.pairing()["token"].as_str().unwrap()),
        );
    if body.is_some() {
        b = b.method("POST").header("content-type", "application/json");
    }
    b.body(Body::from(body.map(|v| v.to_string()).unwrap_or_default()))
        .unwrap()
}
async fn json_response(response: axum::response::Response) -> Value {
    serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap()).unwrap()
}
fn connected() -> (Gateway, Arc<AtomicUsize>) {
    let g = Gateway::new();
    let clone = g.clone();
    let calls = Arc::new(AtomicUsize::new(0));
    let counter = calls.clone();
    g.subscribe(Arc::new(move |event| {
        if event.kind == "expression" {
            counter.fetch_add(1, Ordering::SeqCst);
            let gw = clone.clone();
            tokio::spawn(async move {
                gw.finish(event.id, "accepted".into(), None);
            });
        }
        Ok(())
    }));
    (g, calls)
}
#[tokio::test]
async fn auth_origin_host_and_single_controller() {
    let (g, _) = connected();
    let app = g.router();
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/v1/capabilities")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let mut req = request(&g, "/v1/capabilities", None);
    req.headers_mut()
        .insert("origin", "https://malicious.example".parse().unwrap());
    assert_eq!(
        app.clone().oneshot(req).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    let mut req = request(&g, "/v1/capabilities", None);
    req.headers_mut()
        .insert("host", "evil.example:80".parse().unwrap());
    assert_eq!(
        app.clone().oneshot(req).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.clone()
            .oneshot(request(&g, "/v1/sessions", Some(json!({}))))
            .await
            .unwrap()
            .status(),
        StatusCode::CREATED
    );
    assert_eq!(
        app.oneshot(request(&g, "/v1/sessions", Some(json!({}))))
            .await
            .unwrap()
            .status(),
        StatusCode::CONFLICT
    );
}
#[tokio::test]
async fn dedup_ack_cancel_and_stale_epoch() {
    let (g, calls) = connected();
    let app = g.router();
    let session = json_response(
        app.clone()
            .oneshot(request(&g, "/v1/sessions", Some(json!({}))))
            .await
            .unwrap(),
    )
    .await;
    let id = session["id"].as_str().unwrap();
    let path = format!("/v1/sessions/{id}/expressions");
    let command = json!({"epoch":session["epoch"],"requestId":"one","body":{"type":"morph","target":"wall","durationMs":10000}});
    let start = std::time::Instant::now();
    let response = app
        .clone()
        .oneshot(request(&g, &path, Some(command.clone())))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::ACCEPTED);
    assert!(start.elapsed() < std::time::Duration::from_secs(1));
    let first = json_response(response).await;
    let second = json_response(
        app.clone()
            .oneshot(request(&g, &path, Some(command.clone())))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(first, second);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    let response = app
        .clone()
        .oneshot(request(
            &g,
            &format!("/v1/sessions/{id}/cancel"),
            Some(json!({"epoch":session["epoch"]})),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let cancelled = json_response(response).await;
    assert_ne!(cancelled["epoch"], session["epoch"]);
    assert_eq!(
        app.oneshot(request(&g, &path, Some(command)))
            .await
            .unwrap()
            .status(),
        StatusCode::CONFLICT
    );
}
#[tokio::test]
async fn bounded_mailbox_deadline_and_body_limit() {
    let g = Gateway::new();
    g.subscribe(Arc::new(|_| Ok(())));
    let app = g.router();
    let s = json_response(
        app.clone()
            .oneshot(request(&g, "/v1/sessions", Some(json!({}))))
            .await
            .unwrap(),
    )
    .await;
    let path = format!("/v1/sessions/{}/expressions", s["id"].as_str().unwrap());
    let mut handles = Vec::new();
    for i in 0..4 {
        let app = app.clone();
        let req = request(
            &g,
            &path,
            Some(
                json!({"epoch":s["epoch"],"requestId":i.to_string(),"body":{"type":"wait","durationMs":1}}),
            ),
        );
        handles.push(tokio::spawn(async move { app.oneshot(req).await.unwrap() }));
    }
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    let response = app
        .clone()
        .oneshot(request(
            &g,
            &path,
            Some(json!({"epoch":s["epoch"],"requestId":"fifth","body":{}})),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    for h in handles {
        let response = h.await.unwrap();
        assert_eq!(response.status(), StatusCode::ACCEPTED);
        assert_eq!(json_response(response).await["status"], "pending");
    }
    let response = app
        .oneshot(request(
            &g,
            &path,
            Some(json!({"epoch":s["epoch"],"requestId":"large","body":{"x":"x".repeat(33000)}})),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
}
#[tokio::test]
async fn sse_reconnect_emits_gap_and_snapshot_without_animation_replay() {
    use http_body_util::BodyExt;
    let (g, _) = connected();
    let app = g.router();
    let s = json_response(
        app.clone()
            .oneshot(request(&g, "/v1/sessions", Some(json!({}))))
            .await
            .unwrap(),
    )
    .await;
    let path = format!("/v1/sessions/{}/expressions", s["id"].as_str().unwrap());
    let _=app.clone().oneshot(request(&g,&path,Some(json!({"epoch":s["epoch"],"requestId":"a","body":{"type":"wait","durationMs":10000}})))).await.unwrap();
    let mut req = request(
        &g,
        &format!("/v1/sessions/{}/events", s["id"].as_str().unwrap()),
        None,
    );
    req.headers_mut()
        .insert("last-event-id", "0".parse().unwrap());
    let response = app.oneshot(req).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let mut body = response.into_body();
    let first = body.frame().await.unwrap().unwrap().into_data().unwrap();
    let second = body.frame().await.unwrap().unwrap().into_data().unwrap();
    assert!(String::from_utf8_lossy(&first).contains("event: gap"));
    let snapshot = String::from_utf8_lossy(&second);
    assert!(snapshot.contains("snapshot"));
    assert!(snapshot.contains("\"animationsReplayed\":false"));
}
