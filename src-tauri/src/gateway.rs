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
    started: Instant,
    feedback: Vec<String>,
}
struct Session {
    id: String,
    epoch: String,
    seq: u64,
    dedup: VecDeque<(String, Instant, Receipt)>,
    created: Instant,
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
}
#[derive(Clone)]
pub struct Gateway {
    token: Arc<String>,
    pub address: Arc<Mutex<String>>,
    session: Arc<Mutex<Option<Session>>>,
    bridge: Arc<Mutex<Option<Bridge>>>,
    pending: Arc<Mutex<HashMap<String, Pending>>>,
    events: broadcast::Sender<Value>,
    event_id: Arc<AtomicU64>,
    connections: Arc<Semaphore>,
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
    pub fn new() -> Self {
        let (events, _) = broadcast::channel(64);
        Self {
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
    pub fn pairing(&self) -> Value {
        json!({"baseUrl":*self.address.lock().unwrap(),"token":self.token.as_str(),"protocolVersion":1,"instructionVersion":"1.0.0"})
    }
    pub fn subscribe(&self, bridge: Bridge) {
        *self.control.lock().unwrap() = (None, None);
        *self.bridge.lock().unwrap() = Some(bridge);
        // A reloaded compiler has a fresh macro registry; require a fresh controller session.
        self.revoke();
    }
    fn dispatch(&self, event: BridgeEvent) -> Result<(), String> {
        if event.kind != "expression" {
            let mut control = self.control.lock().unwrap();
            if control.0.is_some() {
                control.1 = Some(event);
                return Ok(());
            }
            control.0 = Some(event.epoch.clone());
        }
        let bridge = self
            .bridge
            .lock()
            .unwrap()
            .clone()
            .ok_or("renderer_disconnected")?;
        bridge(event)
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
    fn publish(&self, receipt: &Receipt, status: &str, code: Option<&str>) {
        let id = self.event_id.fetch_add(1, Ordering::SeqCst) + 1;
        let _=self.events.send(json!({"id":id,"session":receipt.session,"epoch":receipt.epoch,"seq":receipt.seq,"expressionId":receipt.id,"status":status,"code":code}));
    }
    pub fn finish(&self, id: String, status: String, code: Option<String>) {
        let pending = self.pending.lock().unwrap().remove(&id);
        if let Some(p) = pending {
            let current = self
                .session
                .lock()
                .unwrap()
                .as_ref()
                .map(|s| s.epoch.clone());
            let (status, code) = if current.as_deref() != Some(&p.epoch) {
                ("rejected".to_owned(), Some("stale_epoch".to_owned()))
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
            };
            if let Some(s) = self.session.lock().unwrap().as_mut() {
                for (_, _, r) in s.dedup.iter_mut() {
                    if r.id == receipt.id {
                        *r = receipt.clone();
                    }
                }
            }
            self.publish(&receipt, &status, code.as_deref());
            if status == "accepted" {
                for feedback in p.feedback {
                    self.publish(&receipt, &feedback, None);
                }
            }
            let _ = p.reply.send(receipt);
        }
    }
    pub fn feedback(&self, epoch: String, seq: u64, status: String) {
        if !["applied", "completed"].contains(&status.as_str()) {
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
            if s.epoch == epoch {
                let receipt = Receipt {
                    id: format!("{}:{seq}", s.id),
                    session: s.id.clone(),
                    epoch,
                    seq,
                    status: status.clone(),
                    code: None,
                };
                self.publish(&receipt, &status, None);
            }
        }
    }
    pub fn revoke(&self) {
        let previous = self.session.lock().unwrap().take();
        if let Some(s) = previous {
            let epoch = Uuid::new_v4().to_string();
            let _ = self.dispatch(BridgeEvent {
                kind: "closed",
                id: String::new(),
                epoch,
                record: None,
            });
            for (_, p) in self.pending.lock().unwrap().drain() {
                let _ = p.reply.send(Receipt {
                    id: String::new(),
                    session: s.id.clone(),
                    epoch: s.epoch.clone(),
                    seq: p.seq,
                    status: "rejected".into(),
                    code: Some("session_closed".into()),
                });
            }
        }
    }
    pub fn router(&self) -> Router {
        Router::new()
            .route("/v1/capabilities", get(capabilities))
            .route("/v1/sessions", post(create_session))
            .route("/v1/sessions/{id}/expressions", post(expression))
            .route("/v1/sessions/{id}/cancel", post(cancel))
            .route("/v1/sessions/{id}/events", get(events))
            .layer(DefaultBodyLimit::max(32768))
            .layer(middleware::from_fn_with_state(self.clone(), authorize))
            .with_state(self.clone())
    }
    pub async fn serve(self) -> Result<(), String> {
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .map_err(|_| "bind_failed")?;
        *self.address.lock().unwrap() = format!(
            "http://{}",
            listener.local_addr().map_err(|_| "address_failed")?
        );
        axum::serve(listener, self.router())
            .await
            .map_err(|_| "gateway_stopped".into())
    }
}
fn error(status: StatusCode, code: &str) -> Response {
    (status, Json(json!({"status":"rejected","code":code}))).into_response()
}
async fn authorize(State(g): State<Gateway>, request: Request, next: Next) -> Response {
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
        json!({"v":1,"instructionVersion":"1.0.0","shapes":["sphere","ring","wave","cloud"],"fields":["orbit","turbulence","pulse"],"tracks":["body"],"easing":["linear","smoothstep"],"limits":{"recordBytes":32768,"depth":16,"inputNodes":128,"expandedNodes":512,"macros":32,"params":8,"durationMs":10000,"queue":8,"inFlight":4,"recordsPerSecond":10,"pointSize":8,"ttlMs":5000},"feedbackBuffer":64,"dedupEntries":256,"dedupTtlMs":60000,"admissionDeadlineMs":500,"modelApiCalls":false}),
    )
}
async fn create_session(State(g): State<Gateway>) -> Response {
    let mut slot = g.session.lock().unwrap();
    if slot
        .as_ref()
        .is_some_and(|s| s.created.elapsed() < Duration::from_secs(1800))
    {
        return error(StatusCode::CONFLICT, "controller_active");
    }
    let id = Uuid::new_v4().to_string();
    let epoch = Uuid::new_v4().to_string();
    if g.dispatch(BridgeEvent {
        kind: "epoch",
        id: String::new(),
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
        created: Instant::now(),
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
        s.dedup
            .retain(|(_, at, _)| at.elapsed() < Duration::from_secs(60));
        if let Some((_, _, previous)) = s
            .dedup
            .iter()
            .find(|(request, _, _)| request == &command.request_id)
        {
            return (
                if previous.status == "pending" {
                    StatusCode::CONFLICT
                } else {
                    StatusCode::OK
                },
                Json(previous),
            )
                .into_response();
        }
        let mut pending = g.pending.lock().unwrap();
        pending.retain(|_, p| p.started.elapsed() < Duration::from_secs(1));
        if pending.len() >= 4 {
            return error(StatusCode::TOO_MANY_REQUESTS, "gateway_full");
        }
        s.seq += 1;
        receipt = Receipt {
            id: format!("{}:{}", s.id, s.seq),
            session: s.id.clone(),
            epoch: s.epoch.clone(),
            seq: s.seq,
            status: "pending".into(),
            code: None,
        };
        pending.insert(
            receipt.id.clone(),
            Pending {
                reply,
                session: s.id.clone(),
                epoch: s.epoch.clone(),
                seq: s.seq,
                started: Instant::now(),
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
            } else {
                StatusCode::UNPROCESSABLE_ENTITY
            },
            Json(result),
        )
            .into_response(),
        _ => {
            g.finish(
                receipt.id,
                "rejected".into(),
                Some("admission_timeout".into()),
            );
            error(StatusCode::SERVICE_UNAVAILABLE, "admission_timeout")
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
    s.epoch = Uuid::new_v4().to_string();
    s.seq = 0;
    s.dedup.clear();
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
async fn events(State(g): State<Gateway>, Path(id): Path<String>, headers: HeaderMap) -> Response {
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
    let mut receiver = g.events.subscribe();
    let current = g.event_id.load(Ordering::SeqCst);
    let last = headers
        .get("last-event-id")
        .and_then(|h| h.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok());
    let stream = async_stream::stream! {let _permit=permit;if last.is_some_and(|n|n<current){yield Ok::<Event,Infallible>(Event::default().event("gap").id(current.to_string()).data(json!({"status":"gap","through":current}).to_string()));}yield Ok(Event::default().event("snapshot").id(current.to_string()).data(snapshot.to_string()));loop{match receiver.recv().await{Ok(value)=>{if value["session"]==id{yield Ok(Event::default().event("feedback").id(value["id"].to_string()).data(value.to_string()));}},Err(broadcast::error::RecvError::Lagged(count))=>{yield Ok(Event::default().event("gap").data(json!({"status":"gap","lost":count,"animationsReplayed":false}).to_string()));},Err(_)=>break}}};
    Sse::new(stream)
        .keep_alive(KeepAlive::default())
        .into_response()
}

#[tauri::command]
pub fn gateway_pairing(state: tauri::State<'_, Gateway>) -> Value {
    state.pairing()
}
#[tauri::command]
pub fn gateway_subscribe(
    state: tauri::State<'_, Gateway>,
    on_event: tauri::ipc::Channel<BridgeEvent>,
) {
    state.subscribe(Arc::new(move |e| {
        on_event.send(e).map_err(|_| "ipc_closed".into())
    }));
}
#[tauri::command]
pub fn gateway_complete(
    state: tauri::State<'_, Gateway>,
    id: String,
    status: String,
    code: Option<String>,
) {
    state.finish(id, status, code);
}
#[tauri::command]
pub fn gateway_feedback(state: tauri::State<'_, Gateway>, epoch: String, seq: u64, status: String) {
    state.feedback(epoch, seq, status);
}
#[tauri::command]
pub fn gateway_revoke(state: tauri::State<'_, Gateway>) {
    state.revoke();
}
#[tauri::command]
pub fn gateway_control_ack(state: tauri::State<'_, Gateway>, epoch: String) {
    state.control_ack(epoch);
}
