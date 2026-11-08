use serde_json::{json, Value};
use std::collections::VecDeque;

pub fn keys(value: &Value, names: &[&str]) -> bool {
    value.as_object().is_some_and(|object| object.len() == names.len() && names.iter().all(|name| object.contains_key(*name)))
}
fn number(value: &Value, min: f64, max: f64) -> bool {
    value.as_f64().is_some_and(|number| number.is_finite() && number >= min && number <= max)
}
fn vector(value: &Value, names: &[&str], min: f64, max: f64) -> bool {
    value.is_null() || keys(value, names) && names.iter().all(|name| number(&value[*name], min, max))
}
pub fn validate(value: &Value, session: &str, now: u64) -> bool {
    if !keys(value, &["v", "sessionId", "seq", "capturedAt", "camera", "user", "turn", "summary"])
        || value["v"] != 1 || value["sessionId"] != session || value["seq"].as_u64().is_none()
        || !value["capturedAt"].as_u64().is_some_and(|at| at.abs_diff(now) <= 1500)
        || !["starting", "tracking", "absent", "denied", "error", "stopped", "stale"].iter().any(|item| value["camera"] == *item)
        || !["idle", "working", "waiting", "interrupted"].iter().any(|item| value["turn"] == *item)
        || !value["summary"].as_str().is_some_and(|text| text.len() <= 1600) { return false; }
    let user = &value["user"];
    if !keys(user, &["present", "quality", "position", "head", "facingScreen", "expression", "mouthMoving"])
        || !keys(&user["quality"], &["score", "basis"]) || !number(&user["quality"]["score"], 0., 1.)
        || !["tracking-stability", "unavailable"].iter().any(|basis| user["quality"]["basis"] == *basis)
        || !user["present"].is_boolean() { return false; }
    for name in ["facingScreen", "mouthMoving"] { if !user[name].is_null() && !user[name].is_boolean() { return false; } }
    if !vector(&user["position"], &["x", "y"], -1., 1.) || !vector(&user["head"], &["yaw", "pitch", "roll"], -180., 180.)
        || !vector(&user["expression"], &["smile", "browRaise", "eyesClosed", "mouthOpen"], 0., 1.) { return false; }
    user["present"] == true || ["position", "head", "facingScreen", "expression", "mouthMoving"].iter().all(|key| user[*key].is_null())
}
pub fn event_type(value: &Value) -> bool {
    ["user_arrived", "user_left", "looked_away", "looked_back", "expression_changed", "mouth_started", "mouth_stopped", "turn_changed"].iter().any(|kind| value == kind)
}
#[derive(Default)]
pub struct Observations { pub snapshot: Option<Value>, pub received_at: Option<u64>, pub events: VecDeque<Value>, pub cursor: u64 }
impl Observations {
    pub fn ingest(&mut self, value: Value, events: Vec<Value>, session: &str, now: u64) -> bool {
        if !validate(&value, session, now) || events.len() > 16 || self.snapshot.as_ref().is_some_and(|old| old["seq"].as_u64() >= value["seq"].as_u64()) { return false; }
        if events.iter().any(|event| !keys(event, &["type", "at"]) || !event_type(&event["type"]) || !event["at"].as_u64().is_some_and(|at| at.abs_diff(now) <= 5000)) { return false; }
        self.snapshot = Some(value); self.received_at = Some(now);
        for event in events { self.cursor += 1; self.events.push_back(json!({"id":self.cursor,"type":event["type"],"at":event["at"]})); }
        while self.events.len() > 64 { self.events.pop_front(); }
        true
    }
    pub fn read(&self, cursor: u64, now: u64) -> Value {
        let age = self.snapshot.as_ref().and_then(|value| value["capturedAt"].as_u64()).map(|at| now.saturating_sub(at));
        let stale = age.is_none_or(|age| age > 1500); let mut snapshot = self.snapshot.clone();
        if let Some(ref mut value) = snapshot {
            value["summary"] = json!(if stale { "Quan sát đã cũ; trạng thái người dùng chưa biết." } else if value["user"]["present"] == true { "Có người trong khung hình. Hướng đầu và nét mặt là ước lượng hình học." } else { "Chưa thấy khuôn mặt trong khung hình." });
            if stale { value["camera"] = json!("stale"); value["user"] = json!({"present":false,"quality":{"score":0,"basis":"unavailable"},"position":null,"head":null,"facingScreen":null,"expression":null,"mouthMoving":null}); }
        }
        json!({"snapshot":snapshot,"receivedAt":self.received_at,"ageMs":age,"stale":stale,"events":self.events.iter().filter(|event| event["id"].as_u64().unwrap_or(0)>cursor).collect::<Vec<_>>(),"cursor":self.cursor,"gap":self.events.front().is_some_and(|event| cursor.saturating_add(1)<event["id"].as_u64().unwrap_or(0))})
    }
}
