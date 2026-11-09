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
    let mut fields = vec!["v", "sessionId", "seq", "capturedAt", "camera", "user", "turn", "summary"];
    if value.get("hands").is_some() { fields.push("hands"); if !hands(&value["hands"]) { return false; } }
    if !keys(value, &fields)
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
fn hands(value: &Value) -> bool {
    let tracked = value.get("primaryTrackId").is_some();
    let mut fields = vec!["v", "trackingState", "coordinateSpace", "landmarkSchema", "zMeaning", "mirrored", "sourceWidth", "sourceHeight", "entities"];
    if tracked { fields.push("primaryTrackId"); }
    if !keys(value, &fields)
        || value["v"] != 1 || value["coordinateSpace"] != "image-normalized" || value["landmarkSchema"] != "mediapipe-hand-21"
        || value["zMeaning"] != "wrist-relative-image-width" || value["mirrored"] != false { return false; }
    if !["tracked", "lost", "unavailable", "error"].iter().any(|state| value["trackingState"] == *state) { return false; }
    if !["sourceWidth", "sourceHeight"].iter().all(|key| value[*key].as_u64().is_some_and(|n| (1..=16384).contains(&n))) { return false; }
    let Some(entities) = value["entities"].as_array() else { return false; };
    if entities.len() > 2 || (value["trackingState"] == "tracked") != !entities.is_empty() { return false; }
    let mut ids = Vec::new(); let mut tracks = Vec::new();
    for entity in entities {
        let mut fields = vec!["detectionId", "handedness", "confidence", "landmarks"];
        if tracked { fields.push("trackId"); }
        if !keys(entity, &fields)
            || !entity["detectionId"].as_u64().is_some_and(|id| id <= 1 && !ids.contains(&id))
            || !["Left", "Right", "Unknown"].iter().any(|name| entity["handedness"] == *name)
            || !number(&entity["confidence"], 0., 1.) { return false; }
        ids.push(entity["detectionId"].as_u64().unwrap());
        if tracked {
            let Some(id) = entity["trackId"].as_str() else { return false; };
            if !track_id(id) || tracks.contains(&id) { return false; } tracks.push(id);
        }
        if !entity["landmarks"].as_array().is_some_and(|points| points.len() == 21 && points.iter().all(|point|
            keys(point, &["x", "y", "z"]) && ["x", "y", "z"].iter().all(|key| number(&point[*key], -4., 4.)))) { return false; }
    }
    !tracked || value["primaryTrackId"].is_null() || value["primaryTrackId"].as_str().is_some_and(|id| tracks.contains(&id))
}
fn track_id(id: &str) -> bool {
    let parts: Vec<_> = id.split('_').collect();
    id.len() <= 64 && parts.len() == 3 && parts[0] == "hand" && parts[1..].iter().all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
}
pub fn event_type(value: &Value) -> bool {
    ["user_arrived", "user_left", "looked_away", "looked_back", "expression_changed", "mouth_started", "mouth_stopped", "turn_changed"].iter().any(|kind| value == kind)
}
fn hand_event_type(value: &Value) -> bool {
    ["hand_appeared", "hand_lost", "hand_motion_started", "hand_motion_stopped"].iter().any(|kind| value == kind)
}
fn source_event(value: &Value, now: u64, snapshot_seq: u64) -> bool {
    let hand = hand_event_type(&value["type"]);
    let mut fields = if hand { vec!["type", "at", "eventVersion", "trackId", "sourceSeq", "observationSeq", "evidenceStartSeq", "stateRevision", "sourceGeneration"] } else { vec!["type", "at"] };
    if !hand && value.get("sourceSeq").is_some() { fields.push("sourceSeq"); }
    if !keys(value, &fields) || !number(&value["at"], 0., 9007199254740991.) || (value["at"].as_f64().unwrap_or(f64::INFINITY) - now as f64).abs() > 5000. { return false; }
    if value.get("sourceSeq").is_some() && !value["sourceSeq"].as_u64().is_some_and(|seq| seq <= 9007199254740991) { return false; }
    if !hand { return event_type(&value["type"]); }
    value["eventVersion"] == 1 && value["trackId"].as_str().is_some_and(|id| !id.is_empty() && id.len() <= 64 && id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-'))
        && ["observationSeq", "evidenceStartSeq", "stateRevision", "sourceGeneration"].iter().all(|key| value[*key].as_u64().is_some_and(|seq| seq <= 9007199254740991))
        && value["evidenceStartSeq"].as_u64() <= value["observationSeq"].as_u64() && value["observationSeq"].as_u64().unwrap() <= snapshot_seq
}
#[derive(Default)]
pub struct Observations { pub snapshot: Option<Value>, pub received_at: Option<u64>, pub events: VecDeque<Value>, pub cursor: u64, pub source_seq: Option<u64> }
impl Observations {
    pub fn ingest(&mut self, value: Value, events: Vec<Value>, session: &str, now: u64) -> bool {
        if !validate(&value, session, now) || events.len() > 16 || self.snapshot.as_ref().is_some_and(|old| old["seq"].as_u64() >= value["seq"].as_u64()) { return false; }
        let mut source_seq = self.source_seq;
        for event in &events {
            if !source_event(event, now, value["seq"].as_u64().unwrap()) { return false; }
            if let Some(seq) = event["sourceSeq"].as_u64() {
                if source_seq.is_some_and(|previous| seq <= previous) { return false; } source_seq = Some(seq);
            }
        }
        self.source_seq = source_seq;
        self.snapshot = Some(value); self.received_at = Some(now);
        for mut event in events { self.cursor += 1; event["id"] = json!(self.cursor); self.events.push_back(event); }
        while self.events.len() > 64 { self.events.pop_front(); }
        true
    }
    pub fn read(&self, cursor: u64, now: u64) -> Value {
        let age = self.snapshot.as_ref().and_then(|value| value["capturedAt"].as_u64()).map(|at| now.saturating_sub(at));
        let stale = age.is_none_or(|age| age > 1500) || self.snapshot.as_ref().is_some_and(|value| value["camera"] == "stale"); let mut snapshot = self.snapshot.clone();
        if let Some(ref mut value) = snapshot {
            value["summary"] = json!(if stale { "Quan sát đã cũ; trạng thái người dùng chưa biết." } else if value["user"]["present"] == true { "Có người trong khung hình. Hướng đầu và nét mặt là ước lượng hình học." } else { "Chưa thấy khuôn mặt trong khung hình." });
            if stale { value.as_object_mut().unwrap().remove("hands"); value["camera"] = json!("stale"); value["user"] = json!({"present":false,"quality":{"score":0,"basis":"unavailable"},"position":null,"head":null,"facingScreen":null,"expression":null,"mouthMoving":null}); }
        }
        json!({"snapshot":snapshot,"receivedAt":self.received_at,"ageMs":age,"stale":stale,"events":self.events.iter().filter(|event| event["id"].as_u64().unwrap_or(0)>cursor).collect::<Vec<_>>(),"cursor":self.cursor,"gap":self.events.front().is_some_and(|event| cursor.saturating_add(1)<event["id"].as_u64().unwrap_or(0))})
    }
}

#[cfg(test)]
mod hand_event_tests {
    use super::*;
    fn snapshot(seq: u64) -> Value {
        json!({"v":1,"sessionId":"test","seq":seq,"capturedAt":1000,"camera":"absent","turn":"idle","summary":"",
            "user":{"present":false,"quality":{"score":0,"basis":"unavailable"},"position":null,"head":null,"facingScreen":null,"expression":null,"mouthMoving":null}})
    }
    fn hand() -> Value {
        json!({"type":"hand_motion_started","at":1000,"eventVersion":1,"trackId":"hand_1_1","sourceSeq":77,
            "observationSeq":12,"evidenceStartSeq":10,"stateRevision":3,"sourceGeneration":1})
    }
    #[test]
    fn hand_metadata_survives_with_independent_delivery_cursor() {
        let mut store = Observations::default(); let expected = hand();
        assert!(store.ingest(snapshot(12), vec![json!({"type":"user_arrived","at":1000}), expected.clone()], "test", 1000));
        let read = store.read(1, 1000); let event = &read["events"][0];
        for (key, value) in expected.as_object().unwrap() { assert_eq!(&event[key], value); }
        assert_eq!(event["id"], 2); assert_eq!(event["sourceSeq"], 77);
        assert!(!store.ingest(snapshot(13), vec![hand()], "test", 1000)); assert_eq!(store.cursor, 2);
    }
    #[test]
    fn malformed_hand_versions_evidence_and_unknown_fields_fail_closed() {
        for (field, invalid) in [("eventVersion", json!(2)), ("trackId", json!("bad id")), ("evidenceStartSeq", json!(13)),
            ("observationSeq", json!(14)), ("stateRevision", json!(-1)), ("sourceGeneration", json!(1.5)), ("sourceSeq", json!(9007199254740992u64)), ("pixels", json!("forbidden"))] {
            let mut event = hand(); event[field] = invalid;
            assert!(!Observations::default().ingest(snapshot(12), vec![event], "test", 1000));
        }
        let mut missing = hand(); missing.as_object_mut().unwrap().remove("sourceSeq");
        assert!(!Observations::default().ingest(snapshot(12), vec![missing], "test", 1000));
    }
}
