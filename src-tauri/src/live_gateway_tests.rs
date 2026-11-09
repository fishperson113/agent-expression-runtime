use super::*;

fn snapshot(seq: u64, at: u64) -> Value {
    json!({"v":1,"sessionId":"test","seq":seq,"capturedAt":at,"camera":"absent","turn":"idle","summary":"test",
        "user":{"present":false,"quality":{"score":0,"basis":"unavailable"},"position":null,"head":null,"facingScreen":null,"expression":null,"mouthMoving":null}})
}
#[test]
fn observation_rejects_pixels_wrong_sessions_old_sequence_and_stale_timestamps() {
    let mut store = observation::Observations::default();
    assert!(store.ingest(snapshot(1, 1000), vec![], "test", 1000));
    assert!(!store.ingest(snapshot(1, 1000), vec![], "test", 1000));
    assert!(!store.ingest(snapshot(2, 1000), vec![], "other", 1000));
    assert!(!store.ingest(snapshot(2, 1000), vec![], "test", 3000));
    let mut pixels = snapshot(2, 1000); pixels["pixels"] = json!("private");
    assert!(!store.ingest(pixels, vec![], "test", 1000));
    assert_eq!(store.read(0, 3000)["snapshot"]["camera"], "stale");
}
#[test]
fn independent_event_cursors_report_gaps_without_consuming_history() {
    let mut store = observation::Observations::default();
    for seq in 1..=70 { assert!(store.ingest(snapshot(seq, 1000), vec![json!({"type":"user_arrived","at":1000})], "test", 1000)); }
    let first = store.read(69, 1000); let second = store.read(69, 1000);
    assert_eq!(first, second); assert_eq!(first["events"].as_array().unwrap().len(), 1);
    assert_eq!(store.read(0, 1000)["gap"], true); assert_eq!(store.events.len(), 64);
}
#[test]
fn look_rejects_camera_payloads_and_bad_image_dimensions() {
    let state = LiveState::default();
    assert!(!receive(&state, json!({"type":"camera_frame","data":"private"})));
    assert!(!receive(&state, json!({"type":"look_result","id":"x","synthetic":false,"mimeType":"image/jpeg","data":"/9j/","width":480,"height":360})));
    assert!(!receive(&state, json!({"type":"look_result","id":"x","synthetic":true,"mimeType":"image/jpeg","data":"/9j/","width":999,"height":360})));
}
#[test]
fn recent_transport_does_not_turn_stale_measurements_fresh() {
    let mut store = observation::Observations::default(); let mut value = snapshot(1, 1000);
    value["camera"] = json!("stale");
    assert!(store.ingest(value, vec![], "test", 1000));
    assert_eq!(store.read(0, 1000)["stale"], true);
}

#[test]
fn structured_hands_survive_gateway_reads_and_expire_with_measurement() {
    let mut value = snapshot(1, 1000);
    value["hands"] = json!({"v":1,"trackingState":"tracked","coordinateSpace":"image-normalized",
        "landmarkSchema":"mediapipe-hand-21","zMeaning":"wrist-relative-image-width","mirrored":false,
        "sourceWidth":640,"sourceHeight":480,"entities":[{"detectionId":0,"handedness":"Left","confidence":0.9,
            "landmarks":vec![json!({"x":0.2,"y":0.5,"z":-0.1});21]}]});
    let mut store = observation::Observations::default();
    assert!(store.ingest(value.clone(), vec![], "test", 1000));
    assert_eq!(store.read(0, 1000)["snapshot"]["hands"], value["hands"]);
    assert!(store.read(0, 3000)["snapshot"].get("hands").is_none());
    value["hands"]["v"] = json!(2);
    assert!(!observation::validate(&value, "test", 1000));
    value["hands"]["v"] = json!(1); value["hands"]["entities"][0]["landmarks"][0]["x"] = json!("bad");
    assert!(!observation::validate(&value, "test", 1000));
}
