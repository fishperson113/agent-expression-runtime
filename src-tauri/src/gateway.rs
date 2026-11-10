//! Loopback-only, provider-independent integration gateway. No model SDK or API calls.
use axum::{
    extract::{DefaultBodyLimit, Path, Request, State},
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{
        sse::{Event, KeepAlive},
        IntoResponse, Response, Sse,
    },
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    convert::Infallible,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tokio::sync::{broadcast, oneshot, Semaphore};
use uuid::Uuid;
#[path = "live_gateway.rs"]
pub(crate) mod live;
type Bridge = Arc<dyn Fn(BridgeEvent) -> Result<(), String> + Send + Sync>;
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeEvent {
    pub kind: &'static str,
    pub id: String,
    pub epoch: String,
    pub record: Option<Value>,
}
struct Pending {
    reply: oneshot::Sender<Receipt>,
    session: String,
    epoch: String,
    seq: u64,
    feedback: Vec<String>,
}
struct Session {
    id: String,
    epoch: String,
    seq: u64,
    dedup: VecDeque<(String, Instant, Receipt)>,
    last_active: Instant,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    pub id: String,
    pub session: String,
    pub epoch: String,
    pub seq: u64,
    pub status: String,
    pub code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}
#[derive(Clone)]
pub struct Gateway {
    pub(crate) live: live::LiveState,
    token: Arc<String>,
    pub address: Arc<Mutex<String>>,
    session: Arc<Mutex<Option<Session>>>,
    bridge: Arc<Mutex<Option<Bridge>>>,
    pending: Arc<Mutex<HashMap<String, Pending>>>,
    events: broadcast::Sender<Value>,
    event_id: Arc<AtomicU64>,
    connections: Arc<Semaphore>,
    renderer_connections: Arc<Semaphore>,
    origins: Arc<Vec<String>>,
    control: Arc<Mutex<(Option<String>, Option<BridgeEvent>)>>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Command {
    epoch: String,
    request_id: String,
    kind: Option<String>,
    body: Value,
    track: Option<String>,
    policy: Option<String>,
    ttl_ms: Option<u64>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Cancel {
    epoch: String,
}
impl Gateway {
    pub fn with_host_token(token: String) -> Result<Self, String> {
        if token.len() < 32
            || token.len() > 128
            || !token
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return Err("pairing_token_requires_32_to_128_safe_characters".into());
        }
        let mut gateway = Self::new();
        gateway.token = Arc::new(token);
        Ok(gateway)
    }
    pub fn new() -> Self {
        let (events, _) = broadcast::channel(64);
        Self {
            live: live::LiveState::default(),
            token: Arc::new(format!(
                "{}{}",
                Uuid::new_v4().simple(),
                Uuid::new_v4().simple()
            )),
            address: Arc::default(),
            session: Arc::default(),
            bridge: Arc::default(),
            pending: Arc::default(),
            events,
            event_id: Arc::new(AtomicU64::new(0)),
            connections: Arc::new(Semaphore::new(4)),
            renderer_connections: Arc::new(Semaphore::new(1)),
            control: Arc::default(),
            origins: Arc::new(
                std::env::var("AER_ALLOWED_ORIGINS")
                    .unwrap_or_default()
                    .split(',')
                    .filter(|x| !x.is_empty())
                    .map(str::to_owned)
                    .collect(),
            ),
        }
    }
    #[cfg(test)]
    pub fn expire_session_for_test(&self) {
        if let Some(s) = self.session.lock().unwrap().as_mut() {
            s.last_active = Instant::now() - Duration::from_secs(1801);
        }
    }
    pub fn pairing(&self) -> Value {
        json!({"baseUrl":*self.address.lock().unwrap(),"token":self.token.as_str(),"protocolVersion":1,"instructionVersion":"1.1.0"})
    }
    #[cfg(test)]
    pub fn with_test_origin(mut self, origin: &str) -> Self {
        self.origins = Arc::new(vec![origin.to_owned()]);
        self
    }
    pub fn subscribe(&self, bridge: Bridge) {
        *self.control.lock().unwrap() = (None, None);
        *self.bridge.lock().unwrap() = Some(bridge);
        // A reloaded compiler has a fresh macro registry; require a fresh controller session.
        self.revoke();
    }
    fn watch_pending(&self, id: String) {
        let gateway = self.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(2)).await;
            let expired = gateway.pending.lock().unwrap().get(&id).map(|p| p.session.clone());
            if let Some(session) = expired { gateway.revoke_id(&session); }
        });
    }
    fn dispatch(&self, event: BridgeEvent) -> Result<(), String> {
        if event.kind == "expression" { self.watch_pending(event.id.clone()); }
        let control_epoch = (event.kind != "expression").then(|| event.epoch.clone());
        if event.kind != "expression" {
            let mut control = self.control.lock().unwrap();
            if control.0.is_some() {
                control.1 = Some(event);
                return Ok(());
            }
            control.0 = Some(event.epoch.clone());
        }
        let bridge = self.bridge.lock().unwrap().clone();
        let result = if let Some(bridge) = bridge {
            bridge(event)
        } else {
            Err("renderer_disconnected".into())
        };
        if result.is_err() {
            if let Some(epoch) = control_epoch {
                let mut control = self.control.lock().unwrap();
                if control.0.as_deref() == Some(&epoch) {
                    *control = (None, None);
                }
            }
        }
        result
    }
    pub fn control_ack(&self, epoch: String) {
        let next = {
            let mut control = self.control.lock().unwrap();
            if control.0.as_deref() != Some(&epoch) {
                return;
            }
            control.0 = None;
            control.1.take()
        };
        if let Some(next) = next {
            let _ = self.dispatch(next);
        }
    }
    fn publish(&self, receipt: &Receipt, status: &str, code: Option<&str>, request_id: Option<String>) {
        let id = self.event_id.fetch_add(1, Ordering::SeqCst) + 1;
        let _=self.events.send(json!({"id":id,"session":receipt.session,"epoch":receipt.epoch,"seq":receipt.seq,"expressionId":receipt.id,"requestId":request_id,"status":status,"code":code,"path":receipt.path}));
    }
    pub fn finish(&self, id: String, status: String, code: Option<String>) {
        self.finish_diagnostic(id, status, code, None);
    }
    pub fn finish_diagnostic(&self, id: String, status: String, code: Option<String>, path: Option<String>) {
        let pending = self.pending.lock().unwrap().remove(&id);
        if let Some(p) = pending {
            let current = self
                .session
                .lock()
                .unwrap()
                .as_ref()
                .map(|s| s.epoch.clone());
            let (status, code) = if current.as_deref() != Some(&p.epoch) {
                ("cancelled".to_owned(), Some("epoch_cancelled".to_owned()))
            } else {
                (status, code)
            };
            let receipt = Receipt {
                id,
                session: p.session,
                epoch: p.epoch,
                seq: p.seq,
                status: status.clone(),
                code: code.clone(),
                path,
            };
            let request_id = self.session.lock().unwrap().as_mut().and_then(|s| {
                s.dedup.iter_mut().find(|(_, _, r)| r.id == receipt.id).map(|(request, _, r)| {
                    *r = receipt.clone(); request.clone()
                })
            });
            self.publish(&receipt, &status, code.as_deref(), request_id.clone());
            if status == "accepted" {
                for feedback in p.feedback {
                    self.publish(&receipt, &feedback, None, request_id.clone());
                }
            }
            let _ = p.reply.send(receipt);
        }
    }
    pub fn feedback(&self, epoch: String, seq: u64, status: String) {
        if !["applied", "completed", "cancelled"].contains(&status.as_str()) {
            return;
        }
        {
            let mut pending = self.pending.lock().unwrap();
            if let Some(p) = pending
                .values_mut()
                .find(|p| p.epoch == epoch && p.seq == seq)
            {
                if p.feedback.len() < 2 {
                    p.feedback.push(status);
                }
                return;
            }
        }
        if let Some(s) = self.session.lock().unwrap().as_ref() {
            if s.epoch == epoch
                || (status == "cancelled"
                    && s.dedup
                        .iter()
                        .any(|(_, _, r)| r.epoch == epoch && r.seq == seq))
            {
                let receipt = Receipt {
                    id: format!("{}:{}:{seq}", s.id, epoch),
                    session: s.id.clone(),
                    epoch,
                    seq,
                    status: status.clone(),
                    code: None,
                    path: None,
                };
                let request_id = s.dedup.iter().find(|(_, _, r)| r.epoch == receipt.epoch && r.seq == receipt.seq).map(|(request, _, _)| request.clone());
                self.publish(&receipt, &status, None, request_id);
            }
        }
    }
    pub fn revoke(&self) {
        let mut slot = self.session.lock().unwrap();
        if let Some(session) = slot.take() {
            self.revoke_taken(session);
        }
    }
    fn revoke_id(&self, id: &str) -> bool {
        let mut slot = self.session.lock().unwrap();
        if !slot.as_ref().is_some_and(|s| s.id == id) {
            return false;
        }
        if let Some(session) = slot.take() {
            self.revoke_taken(session);
        }
        true
    }
    fn revoke_expired(&self) {
        let mut slot = self.session.lock().unwrap();
        if slot
            .as_ref()
            .is_some_and(|s| s.last_active.elapsed() >= Duration::from_secs(1800))
        {
            if let Some(session) = slot.take() {
                self.revoke_taken(session);
            }
        }
    }
    fn revoke_taken(&self, s: Session) {
        self.publish(
            &Receipt {
                id: String::new(),
                session: s.id.clone(),
                epoch: s.epoch.clone(),
                seq: s.seq,
                status: "closed".into(),
                code: None,
                path: None,
            },
            "closed",
            None,
            None,
        );
        let epoch = Uuid::new_v4().to_string();
        let _ = self.dispatch(BridgeEvent {
            kind: "closed",
            id: String::new(),
            epoch,
            record: None,
        });
        for (id, p) in self.pending.lock().unwrap().drain() {
            let _ = p.reply.send(Receipt {
                id,
                session: s.id.clone(),
                epoch: s.epoch.clone(),
                seq: p.seq,
                status: "cancelled".into(),
                code: Some("session_closed".into()),
                path: None,
            });
        }
    }
    pub fn router(&self) -> Router {
        Router::new()
            .route("/v1/capabilities", get(capabilities))
            .route("/v1/sessions", post(create_session))
            .route("/v1/sessions/{id}", axum::routing::delete(close_session))
            .route("/v1/sessions/{id}/expressions", post(expression))
            .route("/v1/sessions/{id}/cancel", post(cancel))
            .route("/v1/sessions/{id}/events", get(events))
            .route("/v1/renderer/events", get(renderer_events))
            .route("/v1/renderer/complete", post(renderer_complete))
            .route("/v1/renderer/feedback", post(renderer_feedback))
            .route("/v1/renderer/control-ack", post(renderer_control_ack))
            .route("/v1/sessions/{id}/observe", get(live::observe))
            .route("/v1/sessions/{id}/look", post(live::look))
            .route("/v1/sessions/{id}/render-output", post(live::render_output::inspect))
            .route("/v1/live/context", get(live::context))
            .layer(DefaultBodyLimit::max(32768))
            .layer(middleware::from_fn_with_state(self.clone(), authorize))
            .with_state(self.clone())
            .merge(live::channel_router(self.clone()))
    }
    pub async fn serve(self) -> Result<(), String> {
        // Select a browser-safe dynamic port, independent of a machine's custom ephemeral range.
        let first = (Uuid::new_v4().as_u128() % 16384) as u16;
        let mut listener = None;
        for offset in 0..16384u32 {
            let port = browser_port(first, offset);
            if let Ok(bound) =
                tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await
            {
                listener = Some(bound);
                break;
            }
        }
        let listener = listener.ok_or("bind_failed")?;
        *self.address.lock().unwrap() = format!(
            "http://{}",
            listener.local_addr().map_err(|_| "address_failed")?
        );
        axum::serve(listener, self.router())
            .await
            .map_err(|_| "gateway_stopped".into())
    }
}
pub(crate) fn browser_port(first: u16, offset: u32) -> u16 {
    49152 + ((u32::from(first) + offset * 7919) % 16384) as u16
}
fn error(status: StatusCode, code: &str) -> Response {
    (status, Json(json!({"status":"rejected","code":code}))).into_response()
}
async fn authorize(State(g): State<Gateway>, request: Request, next: Next) -> Response {
    if request.method() == axum::http::Method::OPTIONS {
        let headers = request.headers();
        let host = headers
            .get("host")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        let origin = headers
            .get("origin")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        let method = headers
            .get("access-control-request-method")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        let requested = headers
            .get("access-control-request-headers")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        if !(host.starts_with("127.0.0.1:") || host.starts_with("localhost:"))
            || !g.origins.iter().any(|v| v == origin)
            || !["GET", "POST", "DELETE"].contains(&method)
            || requested
                .split(',')
                .map(|v| v.trim().to_ascii_lowercase())
                .any(|v| {
                    !v.is_empty()
                        && !["authorization", "content-type", "last-event-id"].contains(&v.as_str())
                })
        {
            return error(StatusCode::FORBIDDEN, "preflight_denied");
        }
        let mut response = StatusCode::NO_CONTENT.into_response();
        response
            .headers_mut()
            .insert("access-control-allow-origin", origin.parse().unwrap());
        response.headers_mut().insert(
            "access-control-allow-methods",
            "GET, POST, DELETE".parse().unwrap(),
        );
        response.headers_mut().insert(
            "access-control-allow-headers",
            "Authorization, Content-Type, Last-Event-ID"
                .parse()
                .unwrap(),
        );
        response.headers_mut().insert(
            "vary",
            "Origin, Access-Control-Request-Method, Access-Control-Request-Headers"
                .parse()
                .unwrap(),
        );
        return response;
    }
    let headers = request.headers();
    let auth = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    // Equal-length constant-work comparison; credentials never appear in URLs or diagnostics.
    let expected = format!("Bearer {}", g.token);
    let diff = auth
        .as_bytes()
        .iter()
        .zip(expected.as_bytes())
        .fold(0u8, |d, (a, b)| d | (a ^ b));
    if auth.len() != expected.len() || diff != 0 {
        return error(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    let host = headers
        .get("host")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");
    if !host.starts_with("127.0.0.1:") && !host.starts_with("localhost:") {
        return error(StatusCode::FORBIDDEN, "host_denied");
    }
    let origin = headers
        .get("origin")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    if let Some(ref origin) = origin {
        if !g.origins.contains(origin) {
            return error(StatusCode::FORBIDDEN, "origin_denied");
        }
    }
    let mut response = next.run(request).await;
    if let Some(origin) = origin {
        if let Ok(value) = origin.parse() {
            response
                .headers_mut()
                .insert("access-control-allow-origin", value);
            response
                .headers_mut()
                .insert("vary", "Origin".parse().unwrap());
        }
    }
    response
}
async fn capabilities() -> Json<Value> {
    Json(
        serde_json::from_str(include_str!("../../src/contracts/capabilities.json"))
            .expect("bundled capability manifest"),
    )
}
async fn create_session(State(g): State<Gateway>) -> Response {
    g.revoke_expired();
    let mut slot = g.session.lock().unwrap();
    if slot.is_some() {
        return error(StatusCode::CONFLICT, "controller_active");
    }
    let id = Uuid::new_v4().to_string();
    let epoch = Uuid::new_v4().to_string();
    if g.dispatch(BridgeEvent {
        kind: "epoch",
        id: id.clone(),
        epoch: epoch.clone(),
        record: None,
    })
    .is_err()
    {
        return error(StatusCode::SERVICE_UNAVAILABLE, "renderer_disconnected");
    }
    *slot = Some(Session {
        id: id.clone(),
        epoch: epoch.clone(),
        seq: 0,
        dedup: VecDeque::new(),
        last_active: Instant::now(),
    });
    (
        StatusCode::CREATED,
        Json(json!({"id":id,"epoch":epoch,"v":1})),
    )
        .into_response()
}
async fn expression(
    State(g): State<Gateway>,
    Path(id): Path<String>,
    Json(command): Json<Command>,
) -> Response {
    if command.request_id.is_empty() || command.request_id.len() > 128 {
        return error(StatusCode::BAD_REQUEST, "request_id");
    }
    let (reply, receive) = oneshot::channel();
    let receipt;
    {
        let mut slot = g.session.lock().unwrap();
        let Some(s) = slot.as_mut().filter(|s| s.id == id) else {
            return error(StatusCode::NOT_FOUND, "session");
        };
        if command.epoch != s.epoch {
            return error(StatusCode::CONFLICT, "stale_epoch");
        }
        s.last_active = Instant::now();
        s.dedup
            .retain(|(_, at, _)| at.elapsed() < Duration::from_secs(60));
        if let Some((_, _, previous)) = s
            .dedup
            .iter()
            .find(|(request, _, _)| request == &command.request_id)
        {
            return (
                if previous.status == "pending" {
                    StatusCode::ACCEPTED
                } else if previous.status == "rejected" {
                    StatusCode::UNPROCESSABLE_ENTITY
                } else {
                    StatusCode::OK
                },
                Json(previous),
            )
                .into_response();
        }
        let mut pending = g.pending.lock().unwrap();
        // Pending decisions occupy bounded slots until a definitive result or session close.
        if pending.len() >= 4 {
            return error(StatusCode::TOO_MANY_REQUESTS, "gateway_full");
        }
        s.seq += 1;
        receipt = Receipt {
            id: format!("{}:{}:{}", s.id, s.epoch, s.seq),
            session: s.id.clone(),
            epoch: s.epoch.clone(),
            seq: s.seq,
            status: "pending".into(),
            code: None,
            path: None,
        };
        pending.insert(
            receipt.id.clone(),
            Pending {
                reply,
                session: s.id.clone(),
                epoch: s.epoch.clone(),
                seq: s.seq,
                feedback: Vec::new(),
            },
        );
        s.dedup
            .push_back((command.request_id, Instant::now(), receipt.clone()));
        while s.dedup.len() > 256 {
            s.dedup.pop_front();
        }
    }
    let kind = command.kind.unwrap_or_else(|| "program".into());
    let mut record =
        json!({"v":1,"epoch":receipt.epoch,"seq":receipt.seq,"kind":kind,"body":command.body});
    if kind == "program" {
        record["track"] = json!(command.track.unwrap_or_else(|| "body".into()));
        record["policy"] = json!(command.policy.unwrap_or_else(|| "replace".into()));
    } else if command.track.is_some() || command.policy.is_some() {
        g.finish(
            receipt.id.clone(),
            "rejected".into(),
            Some("unknown_field".into()),
        );
        return error(StatusCode::BAD_REQUEST, "unknown_field");
    }
    if let Some(ttl) = command.ttl_ms {
        record["ttlMs"] = json!(ttl);
    }
    if g.dispatch(BridgeEvent {
        kind: "expression",
        id: receipt.id.clone(),
        epoch: receipt.epoch.clone(),
        record: Some(record),
    })
    .is_err()
    {
        g.finish(
            receipt.id.clone(),
            "rejected".into(),
            Some("renderer_disconnected".into()),
        );
    }
    match tokio::time::timeout(Duration::from_millis(500), receive).await {
        Ok(Ok(result)) => (
            if result.status == "accepted" {
                StatusCode::ACCEPTED
            } else if result.status == "cancelled" {
                StatusCode::OK
            } else {
                StatusCode::UNPROCESSABLE_ENTITY
            },
            Json(result),
        )
            .into_response(),
        _ => {
            // The ACK may be delayed after renderer admission. Never claim rejection here.
            (
                StatusCode::ACCEPTED,
                Json(Receipt {
                    code: Some("admission_pending".into()),
                    ..receipt
                }),
            )
                .into_response()
        }
    }
}
async fn cancel(
    State(g): State<Gateway>,
    Path(id): Path<String>,
    Json(command): Json<Cancel>,
) -> Response {
    let mut slot = g.session.lock().unwrap();
    let Some(s) = slot.as_mut().filter(|s| s.id == id) else {
        return error(StatusCode::NOT_FOUND, "session");
    };
    if command.epoch != s.epoch {
        return error(StatusCode::CONFLICT, "stale_epoch");
    }
    s.last_active = Instant::now();
    s.epoch = Uuid::new_v4().to_string();
    s.seq = 0;
    // Dedup receipts remain session-scoped across cancellation.
    let epoch = s.epoch.clone();
    drop(slot);
    let _ = g.dispatch(BridgeEvent {
        kind: "epoch",
        id: String::new(),
        epoch: epoch.clone(),
        record: None,
    });
    let ids: Vec<_> = g.pending.lock().unwrap().keys().cloned().collect();
    for id in ids {
        g.finish(id, "rejected".into(), Some("stale_epoch".into()));
    }
    Json(json!({"id":id,"epoch":epoch,"status":"cancelled"})).into_response()
}
async fn close_session(State(g): State<Gateway>, Path(id): Path<String>) -> Response {
    if !g.revoke_id(&id) {
        return error(StatusCode::NOT_FOUND, "session");
    }
    StatusCode::NO_CONTENT.into_response()
}
async fn events(State(g): State<Gateway>, Path(id): Path<String>, headers: HeaderMap) -> Response {
    let mut receiver = g.events.subscribe();
    let snapshot = {
        let slot = g.session.lock().unwrap();
        let Some(s) = slot.as_ref().filter(|s| s.id == id) else {
            return error(StatusCode::NOT_FOUND, "session");
        };
        json!({"session":s.id,"epoch":s.epoch,"seq":s.seq,"status":"snapshot","animationsReplayed":false})
    };
    let Ok(permit) = g.connections.clone().try_acquire_owned() else {
        return error(StatusCode::TOO_MANY_REQUESTS, "sse_full");
    };
    let current = g.event_id.load(Ordering::SeqCst);
    let last = headers
        .get("last-event-id")
        .and_then(|h| h.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok());
    let stream = async_stream::stream! {let _permit=permit;if last.is_some_and(|n|n<current){yield Ok::<Event,Infallible>(Event::default().event("gap").id(current.to_string()).data(json!({"status":"gap","through":current}).to_string()));}yield Ok(Event::default().event("snapshot").id(current.to_string()).data(snapshot.to_string()));loop{match receiver.recv().await{Ok(value)=>{if value["session"]==id{yield Ok(Event::default().event("feedback").id(value["id"].to_string()).data(value.to_string()));if value["status"]=="closed" {break;}}},Err(broadcast::error::RecvError::Lagged(count))=>{if !g.session.lock().unwrap().as_ref().is_some_and(|s|s.id==id){break;}yield Ok(Event::default().event("gap").data(json!({"status":"gap","lost":count,"animationsReplayed":false}).to_string()));},Err(_)=>break}}};
    Sse::new(stream)
        .keep_alive(KeepAlive::default())
        .into_response()
}

#[cfg(feature = "desktop")]
#[tauri::command]
pub fn gateway_pairing(state: tauri::State<'_, Gateway>) -> Value {
    state.pairing()
}
async fn renderer_events(State(g): State<Gateway>) -> Response {
    let Ok(permit) = g.renderer_connections.clone().try_acquire_owned() else {
        return error(StatusCode::TOO_MANY_REQUESTS, "renderer_connected");
    };
    let (sender, mut receiver) = tokio::sync::mpsc::channel::<BridgeEvent>(4);
    let (control_sender, mut controls) = tokio::sync::mpsc::channel::<BridgeEvent>(1);
    g.subscribe(Arc::new(move |event| {
        if event.kind == "expression" {
            sender
                .try_send(event)
                .map_err(|_| "renderer_mailbox_full".into())
        } else {
            control_sender
                .try_send(event)
                .map_err(|_| "renderer_control_closed".into())
        }
    }));
    let stream = async_stream::stream! {let _permit=permit;yield Ok::<Event,Infallible>(Event::default().comment("connected"));loop {let event=tokio::select!{biased; control=controls.recv()=>control,record=receiver.recv()=>record};let Some(event)=event else{break;};yield Ok::<Event,Infallible>(Event::default().event("bridge").data(serde_json::to_string(&event).unwrap()));}};
    Sse::new(stream)
        .keep_alive(KeepAlive::default())
        .into_response()
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Completion {
    id: String,
    status: String,
    code: Option<String>,
    path: Option<String>,
}
async fn renderer_complete(State(g): State<Gateway>, Json(c): Json<Completion>) -> Response {
    if !["accepted", "rejected", "cancelled"].contains(&c.status.as_str()) {
        return error(StatusCode::BAD_REQUEST, "status");
    }
    g.finish_diagnostic(c.id, c.status, c.code, c.path);
    StatusCode::NO_CONTENT.into_response()
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Feedback {
    epoch: String,
    seq: u64,
    status: String,
}
async fn renderer_feedback(State(g): State<Gateway>, Json(f): Json<Feedback>) -> Response {
    g.feedback(f.epoch, f.seq, f.status);
    StatusCode::NO_CONTENT.into_response()
}
async fn renderer_control_ack(State(g): State<Gateway>, Json(c): Json<Cancel>) -> Response {
    g.control_ack(c.epoch);
    StatusCode::NO_CONTENT.into_response()
}
#[cfg(feature = "desktop")]
#[tauri::command]
pub fn gateway_subscribe(
    state: tauri::State<'_, Gateway>,
    on_event: tauri::ipc::Channel<BridgeEvent>,
) {
    state.subscribe(Arc::new(move |e| {
        on_event.send(e).map_err(|_| "ipc_closed".into())
    }));
}
#[cfg(feature = "desktop")]
#[tauri::command]
pub fn gateway_complete(
    state: tauri::State<'_, Gateway>,
    id: String,
    status: String,
    code: Option<String>,
    path: Option<String>,
) {
    state.finish_diagnostic(id, status, code, path);
}
#[cfg(feature = "desktop")]
#[tauri::command]
pub fn gateway_feedback(state: tauri::State<'_, Gateway>, epoch: String, seq: u64, status: String) {
    state.feedback(epoch, seq, status);
}
#[cfg(feature = "desktop")]
#[tauri::command]
pub fn gateway_revoke(state: tauri::State<'_, Gateway>) {
    state.revoke();
}
#[cfg(feature = "desktop")]
#[tauri::command]
pub fn gateway_control_ack(state: tauri::State<'_, Gateway>, epoch: String) {
    state.control_ack(epoch);
}
