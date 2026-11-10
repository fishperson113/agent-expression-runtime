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

#[test]
fn tracked_hands_require_unique_ids_and_visible_primary_reference() {
    let mut value = snapshot(1, 1000);
    value["hands"] = json!({"v":1,"trackingState":"tracked","coordinateSpace":"image-normalized",
        "landmarkSchema":"mediapipe-hand-21","zMeaning":"wrist-relative-image-width","mirrored":false,
        "sourceWidth":640,"sourceHeight":480,"primaryTrackId":"hand_1_1",
        "entities":[{"detectionId":0,"trackId":"hand_1_1","handedness":"Left","confidence":0.9,
            "landmarks":vec![json!({"x":0.2,"y":0.5,"z":-0.1});21]}]});
    assert!(observation::validate(&value, "test", 1000));
    let mut store = observation::Observations::default();
    assert!(store.ingest(value.clone(), vec![], "test", 1000));
    assert_eq!(store.read(0, 1000)["snapshot"]["hands"], value["hands"]);
    value["hands"]["primaryTrackId"] = json!("hand_9_9");
    assert!(!observation::validate(&value, "test", 1000));
    value["hands"]["primaryTrackId"] = Value::Null;
    assert!(observation::validate(&value, "test", 1000));
    let mut duplicate = value["hands"]["entities"][0].clone(); duplicate["detectionId"] = json!(1);
    value["hands"]["entities"].as_array_mut().unwrap().push(duplicate);
    assert!(!observation::validate(&value, "test", 1000));
    value["hands"]["entities"] = json!([]); value["hands"]["trackingState"] = json!("lost");
    assert!(observation::validate(&value, "test", 1000));
}

#[test]
fn observation_json_preserves_finite_landmark_bits() {
    let numbers = [0.09523809523809523_f64, 0.19047619047619047, 0.38095238095238093,
        0.9523809523809523, -0.23809523809523814, f64::MIN_POSITIVE, f64::from_bits(1)];
    for number in numbers {
        let mut value = snapshot(1, 1000);
        value["hands"] = json!({"v":1,"trackingState":"tracked","coordinateSpace":"image-normalized",
            "landmarkSchema":"mediapipe-hand-21","zMeaning":"wrist-relative-image-width","mirrored":false,
            "sourceWidth":640,"sourceHeight":480,"entities":[{"detectionId":0,"handedness":"Left","confidence":0.9,
                "landmarks":vec![json!({"x":number,"y":0.5,"z":-0.1});21]}]});
        let decoded: Value = serde_json::from_str(&value.to_string()).unwrap();
        let mut store = observation::Observations::default();
        assert!(store.ingest(decoded, vec![], "test", 1000));
        let encoded = store.read(0, 1000).to_string();
        let returned: Value = serde_json::from_str(&encoded).unwrap();
        assert_eq!(returned["snapshot"]["hands"]["entities"][0]["landmarks"][0]["x"].as_f64().unwrap().to_bits(), number.to_bits());
    }
}

#[test]
fn old_discard_policy_has_a_deterministic_source_gap_counterexample() {
    let mut store = observation::Observations::default(); let mut last = None;
    for (seq, arrival) in [(528, 0_u64), (529, 40), (530, 100)] {
        if last.is_some_and(|at| arrival - at < 60) { continue; }
        last = Some(arrival);
        assert!(store.ingest(snapshot(seq, 1000 + arrival), vec![json!({"type":"expression_changed","at":1000+arrival,"sourceSeq":seq})], "test", 1000 + arrival));
    }
    let events = store.read(0, 1100)["events"].as_array().unwrap().clone();
    assert_eq!(events.iter().map(|event| event["sourceSeq"].as_u64().unwrap()).collect::<Vec<_>>(), vec![528, 530]);
    assert_eq!(events.iter().map(|event| event["id"].as_u64().unwrap()).collect::<Vec<_>>(), vec![1, 2]);
}

#[tokio::test(start_paused = true)]
async fn paced_burst_preserves_exact_events_and_sixty_ms_admission_spacing() {
    let mut pacer = ingress::ObservationPacer::new(); let mut store = observation::Observations::default();
    let start = tokio::time::Instant::now(); let mut admitted = Vec::new();
    for (seq, arrival) in [(528, 0_u64), (529, 40), (530, 100)] {
        tokio::time::sleep_until(start + Duration::from_millis(arrival)).await;
        let event = json!({"type":"expression_changed","at":1000+arrival,"sourceSeq":seq});
        let packet = snapshot(seq, 1000 + arrival);
        pacer.wait().await;
        let at = start.elapsed().as_millis() as u64; admitted.push(at);
        assert!(store.ingest(packet, vec![event.clone()], "test", 1000 + at));
        let read = store.read(seq - 528, 1000 + at);
        for field in ["type", "at", "sourceSeq"] { assert_eq!(read["events"][0][field], event[field]); }
        assert_eq!(read["snapshot"]["seq"], seq);
        assert_eq!(read["snapshot"]["capturedAt"], 1000 + arrival);
    }
    assert_eq!(admitted, vec![0, 60, 120]);
    let events = store.read(0, 1120)["events"].as_array().unwrap().clone();
    assert_eq!(events.iter().map(|event| event["sourceSeq"].as_u64().unwrap()).collect::<Vec<_>>(), vec![528, 529, 530]);
    assert_eq!(events.iter().map(|event| event["id"].as_u64().unwrap()).collect::<Vec<_>>(), vec![1, 2, 3]);
    assert!(!store.ingest(snapshot(530, 1120), vec![], "test", 1120));
    assert!(!store.ingest(snapshot(531, 1120), vec![], "other", 1120));
}

fn renderer_reply(id: &str, epoch: &str) -> Value {
    json!({"type":"render_output", "id":id, "epoch":epoch, "summary":{
        "frame":4,"contentFrame":4,"signature":42,"contextLost":false,"capturedAt":now(),"particles":2000,
        "color":"#a237c9","pointSize":2,"brightness":0.8,"parts":[{"id":"authored","kind":"curve","particles":2000,"bounds":{"min":[-1.0,-0.5,0.0],"max":[1.0,0.5,0.1]}}],
        "bounds":{"min":[-1.0,-0.5,0.0],"max":[1.0,0.5,0.1]}}})
}
#[test]
fn renderer_summary_rejects_camera_fields_unknown_fields_and_stale_render_time() {
    let state = LiveState::default(); let epoch = uuid::Uuid::new_v4().to_string();
    assert!(receive(&state, renderer_reply("unmatched", &epoch)));
    let mut value = renderer_reply("x", &epoch); value["summary"]["camera"] = json!("private");
    assert!(!receive(&state, value));
    let mut value = renderer_reply("x", &epoch); value["summary"]["capturedAt"] = json!(0);
    assert!(!receive(&state, value));
    let mut value = renderer_reply("x", &epoch); value["summary"]["bounds"]["min"] = json!([0,1]);
    assert!(!receive(&state, value));
}
#[tokio::test]
async fn renderer_capture_drops_a_reply_when_session_or_renderer_connection_changes() {
    use axum::{body::{to_bytes, Body}, http::Request};
    use tower::ServiceExt;
    for disconnect in [false, true] {
    let g = Gateway::new(); let owner = g.clone();
    g.subscribe(Arc::new(move |event| { owner.control_ack(event.epoch); Ok(()) }));
    let response = g.router().oneshot(Request::post("/v1/sessions").header("host","127.0.0.1:12345").header("Authorization", format!("Bearer {}",g.token))
        .header("Content-Type","application/json").body(Body::from("{}")).unwrap()).await.unwrap();
    let session: Value = serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
    let id = session["id"].as_str().unwrap().to_owned(); let epoch = session["epoch"].as_str().unwrap().to_owned();
    let (sender, mut outgoing) = mpsc::channel(4); g.live.inner.lock().unwrap().sender = Some(sender);
    let worker = g.clone();
    let pending = tokio::spawn(async move { render_output::inspect(State(worker), Path(id), Json(json!({}))).await });
    let request = outgoing.recv().await.unwrap(); assert_eq!(request["epoch"], epoch);
    if disconnect { g.live.inner.lock().unwrap().generation = uuid::Uuid::new_v4().to_string(); } else { g.revoke(); }
    assert!(receive(&g.live, renderer_reply(request["id"].as_str().unwrap(), &epoch)));
    assert_eq!(pending.await.unwrap().status(), StatusCode::CONFLICT);
    }
}
