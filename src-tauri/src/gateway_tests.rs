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
    let command = json!({"epoch":session["epoch"],"requestId":"one","body":{"type":"morph","target":"ring","durationMs":10000}});
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
        assert_eq!(h.await.unwrap().status(), StatusCode::SERVICE_UNAVAILABLE);
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
