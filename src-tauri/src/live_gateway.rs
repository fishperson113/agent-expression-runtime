use super::{error, Gateway};
use axum::{extract::{ws::{Message, WebSocket, WebSocketUpgrade}, Path, Query, State}, http::{HeaderMap, StatusCode}, response::{IntoResponse, Response}, routing::get, Json, Router};
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{sync::{Arc, Mutex}, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};
use tokio::sync::{mpsc, oneshot, Semaphore};
#[path = "live_observation.rs"]
pub mod observation;
#[cfg(test)]
#[path = "live_gateway_tests.rs"]
mod tests;

#[derive(Clone)]
pub struct LiveState { inner: Arc<Mutex<Inner>>, slot: Arc<Semaphore> }
#[derive(Default)]
struct Inner { session: String, observations: observation::Observations, sender: Option<mpsc::Sender<Value>>,
    look: Option<(String, oneshot::Sender<Value>)>, last_look: Option<Instant> }
impl Default for LiveState {
    fn default() -> Self { Self { inner: Arc::default(), slot: Arc::new(Semaphore::new(1)) } }
}
pub fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }
fn active(gateway: &Gateway, id: &str) -> bool {
    let mut session = gateway.session.lock().unwrap();
    if let Some(session) = session.as_mut().filter(|session| session.id == id && session.last_active.elapsed() < Duration::from_secs(1800)) {
        session.last_active = Instant::now(); true
    } else { false }
}
pub fn channel_router(gateway: Gateway) -> Router {
    Router::new().route("/v1/live/channel", get(channel)).with_state(gateway)
}
async fn channel(State(gateway): State<Gateway>, headers: HeaderMap, ws: WebSocketUpgrade) -> Response {
    let host = headers.get("host").and_then(|value| value.to_str().ok()).unwrap_or("");
    let origin = headers.get("origin").and_then(|value| value.to_str().ok()).unwrap_or("");
    if !(host.starts_with("127.0.0.1:") || host.starts_with("localhost:")) || !gateway.origins.iter().any(|allowed| allowed == origin) {
        return error(StatusCode::FORBIDDEN, "live_origin_denied");
    }
    let Ok(permit) = gateway.live.slot.clone().try_acquire_owned() else { return error(StatusCode::CONFLICT, "live_connected"); };
    ws.max_message_size(250000).max_frame_size(250000).on_upgrade(move |socket| async move {
        let _permit = permit; connection(socket, gateway).await;
    })
}
async fn hello(socket: &mut WebSocket, gateway: &Gateway) -> Option<String> {
    let Ok(Some(Ok(Message::Text(text)))) = tokio::time::timeout(Duration::from_secs(2), socket.recv()).await else { return None; };
    let value: Value = serde_json::from_str(text.as_str()).ok()?;
    if !observation::keys(&value, &["type", "token", "sessionId"]) || value["type"] != "hello" { return None; }
    let token = value["token"].as_str()?;
    let diff = token.bytes().zip(gateway.token.bytes()).fold(0u8, |difference, (a,b)| difference | (a^b));
    if token.len() != gateway.token.len() || diff != 0 { return None; }
    let session = value["sessionId"].as_str()?;
    if session.is_empty() || session.len() > 80 || !session.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_') { return None; }
    Some(session.to_string())
}
async fn connection(mut socket: WebSocket, gateway: Gateway) {
    let Some(session) = hello(&mut socket, &gateway).await else { return; };
    let (sender, mut outgoing) = mpsc::channel(4);
    { let mut inner = gateway.live.inner.lock().unwrap(); *inner = Inner { session, sender: Some(sender), ..Inner::default() }; }
    let _ = socket.send(Message::Text(json!({"type":"ready","lookMode":"synthetic-only"}).to_string().into())).await;
    let mut last = Instant::now() - Duration::from_secs(1);
    loop {
        tokio::select! {
            message = socket.recv() => {
                let Some(Ok(Message::Text(text))) = message else { break; };
                if text.len() > 250000 { break; }
                let Ok(value) = serde_json::from_str::<Value>(text.as_str()) else { break; };
                if value["type"] == "observation" {
                    if last.elapsed() < Duration::from_millis(60) { continue; } last = Instant::now();
                }
                if !receive(&gateway.live, value) { break; }
            }
            message = outgoing.recv() => {
                let Some(message) = message else { break; };
                if socket.send(Message::Text(message.to_string().into())).await.is_err() { break; }
            }
        }
    }
    *gateway.live.inner.lock().unwrap() = Inner::default();
}
fn receive(state: &LiveState, value: Value) -> bool {
    let mut inner = state.inner.lock().unwrap();
    if value["type"] == "observation" {
        if !observation::keys(&value, &["type", "snapshot", "events"]) || value.to_string().len() > 32768 { return false; }
        let Some(events) = value["events"].as_array() else { return false; };
        let session = inner.session.clone();
        return inner.observations.ingest(value["snapshot"].clone(), events.clone(), &session, now());
    }
    if value["type"] == "look_result" {
        if !observation::keys(&value, &["type", "id", "synthetic", "mimeType", "data", "width", "height"]) || value["synthetic"] != true || value["mimeType"] != "image/jpeg" { return false; }
        if !["width", "height"].iter().all(|key| value[*key].as_u64().is_some_and(|n| n > 0 && n <= 768)) { return false; }
        let Some(data) = value["data"].as_str().filter(|data| data.len() <= 220000) else { return false; };
        let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(data) else { return false; };
        if !bytes.starts_with(&[255,216,255]) || !bytes.ends_with(&[255,217]) { return false; }
        if inner.look.as_ref().is_some_and(|(id, _)| value["id"] == *id) {
            if let Some((_, reply)) = inner.look.take() { let _ = reply.send(value); }
        }
        return true;
    }
    false
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Cursor { #[serde(default)] cursor: u64 }
pub async fn observe(State(gateway): State<Gateway>, Path(id): Path<String>, Query(query): Query<Cursor>) -> Response {
    if !active(&gateway, &id) { return error(StatusCode::NOT_FOUND, "session_closed"); }
    read(&gateway, query.cursor)
}
fn read(gateway: &Gateway, cursor: u64) -> Response {
    let inner = gateway.live.inner.lock().unwrap();
    if cursor > inner.observations.cursor { return error(StatusCode::BAD_REQUEST, "live_cursor"); }
    Json(inner.observations.read(cursor, now())).into_response()
}
pub async fn context(State(gateway): State<Gateway>) -> Response { read(&gateway, 0) }
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Look { reason: String }
pub async fn look(State(gateway): State<Gateway>, Path(id): Path<String>, Json(request): Json<Look>) -> Response {
    if !active(&gateway, &id) { return error(StatusCode::NOT_FOUND, "session_closed"); }
    if request.reason.is_empty() || request.reason.len() > 240 || request.reason.chars().any(char::is_control) { return error(StatusCode::BAD_REQUEST, "look_reason"); }
    let (reply, receive) = oneshot::channel(); let request_id = uuid::Uuid::new_v4().to_string();
    {
        let mut inner = gateway.live.inner.lock().unwrap();
        if inner.look.is_some() || inner.last_look.is_some_and(|last| last.elapsed() < Duration::from_secs(5)) { return error(StatusCode::TOO_MANY_REQUESTS, "look_rate_limited"); }
        let Some(sender) = inner.sender.clone() else { return error(StatusCode::SERVICE_UNAVAILABLE, "live_disconnected"); };
        if sender.try_send(json!({"type":"look","id":request_id,"reason":request.reason,"synthetic":true})).is_err() { return error(StatusCode::SERVICE_UNAVAILABLE, "live_mailbox_full"); }
        inner.look = Some((request_id.clone(), reply)); inner.last_look = Some(Instant::now());
    }
    match tokio::time::timeout(Duration::from_secs(2), receive).await {
        Ok(Ok(value)) => Json(value).into_response(),
        _ => {
            let mut inner = gateway.live.inner.lock().unwrap();
            if inner.look.as_ref().is_some_and(|(id, _)| *id == request_id) { inner.look = None; }
            error(StatusCode::GATEWAY_TIMEOUT, "look_timeout")
        }
    }
}
