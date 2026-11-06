#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri::{ipc::Channel, State};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
mod gateway;
#[cfg(test)]
mod gateway_tests;

#[derive(Clone, Serialize)]
struct Event {
    epoch: String,
    id: u64,
    kind: &'static str,
    data: Value,
}
#[derive(Default)]
struct Coordinator {
    generation: Arc<AtomicU64>,
    current: Mutex<String>,
    permits: Arc<Mutex<HashMap<(String, u64, bool), OwnedSemaphorePermit>>>,
}

#[tauri::command]
fn ack(state: State<'_, Coordinator>, epoch: String, id: u64, expression: bool) {
    state
        .permits
        .lock()
        .unwrap()
        .remove(&(epoch, id, expression));
}
#[tauri::command]
fn cancel_demo(state: State<'_, Coordinator>, epoch: String) {
    if *state.current.lock().unwrap() == epoch {
        state.generation.fetch_add(1, Ordering::SeqCst);
        state.permits.lock().unwrap().clear();
    }
}
#[tauri::command]
fn start_demo(
    state: State<'_, Coordinator>,
    epoch: String,
    on_content: Channel<Event>,
    on_expression: Channel<Event>,
) -> Result<(), String> {
    if epoch.len() > 128 {
        return Err("epoch too long".into());
    }
    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    *state.current.lock().unwrap() = epoch.clone();
    state.permits.lock().unwrap().clear();
    let authority = state.generation.clone();
    let permits = state.permits.clone();
    // Separate budgets. Expression never waits on its mailbox or content consumer.
    let content_budget = Arc::new(Semaphore::new(64));
    let expression_budget = Arc::new(Semaphore::new(4));
    tauri::async_runtime::spawn(async move {
        let words = "This is a scripted Rust transport demonstration. Content travels over its own Tauri Channel while expressions have a separate four record in flight budget. The provider is deliberately unconfigured. A real model adapter must preserve these independent paths and report its token and latency overhead separately.";
        let mut seq = 0u64;
        for (index, word) in words.split_whitespace().enumerate() {
            if authority.load(Ordering::SeqCst) != generation {
                break;
            }
            let permit = match tokio::time::timeout(
                std::time::Duration::from_secs(2),
                content_budget.clone().acquire_owned(),
            )
            .await
            {
                Ok(Ok(p)) => p,
                _ => break,
            };
            if authority.load(Ordering::SeqCst) != generation {
                break;
            }
            let id = index as u64;
            permits
                .lock()
                .unwrap()
                .insert((epoch.clone(), id, false), permit);
            if on_content
                .send(Event {
                    epoch: epoch.clone(),
                    id,
                    kind: "content",
                    data: json!(format!("{word} ")),
                })
                .is_err()
            {
                break;
            }
            if index % 12 == 0 {
                seq += 1;
                if let Ok(permit) = expression_budget.clone().try_acquire_owned() {
                    permits
                        .lock()
                        .unwrap()
                        .insert((epoch.clone(), seq, true), permit);
                    let target = ["sphere", "wall", "wave", "cloud"][((seq - 1) % 4) as usize];
                    let record = json!({"v":1,"epoch":epoch,"seq":seq,"kind":"program","track":"body","policy":"replace","body":{"type":"parallel","children":[{"type":"morph","target":target,"durationMs":900},{"type":"flow","field":"orbit","strength":0.35,"durationMs":1600}]}});
                    if on_expression
                        .send(Event {
                            epoch: epoch.clone(),
                            id: seq,
                            kind: "expression",
                            data: record,
                        })
                        .is_err()
                    {
                        permits.lock().unwrap().remove(&(epoch.clone(), seq, true));
                    }
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
        if authority.load(Ordering::SeqCst) == generation {
            let _ = on_content.send(Event {
                epoch: epoch.clone(),
                id: u64::MAX,
                kind: "done",
                data: Value::Null,
            });
        }
        permits.lock().unwrap().retain(|(e, _, _), _| e != &epoch);
    });
    Ok(())
}
fn main() {
    if std::env::args().any(|arg| arg == "--browser-gateway") {
        let token = std::env::var("AER_PAIRING_TOKEN")
            .expect("Set an ephemeral AER_PAIRING_TOKEN in the host environment");
        let gateway = gateway::Gateway::with_host_token(token)
            .expect("Invalid pairing credential configuration");
        tauri::async_runtime::block_on(async move {
            let server = gateway.clone();
            let task = tauri::async_runtime::spawn(async move { server.serve().await });
            for _ in 0..100 {
                if !gateway.address.lock().unwrap().is_empty() {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
            println!(
                "{}",
                serde_json::json!({"baseUrl":*gateway.address.lock().unwrap(),"mode":"browser-gateway"})
            );
            task.await
                .expect("Gateway task failed")
                .expect("Gateway failed");
        });
        return;
    }
    let gateway = gateway::Gateway::new();
    let server = gateway.clone();
    tauri::Builder::default()
        .manage(Coordinator::default())
        .manage(gateway)
        .setup(move |_| {
            tauri::async_runtime::spawn(async move {
                let _ = server.serve().await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_demo,
            cancel_demo,
            ack,
            gateway::gateway_pairing,
            gateway::gateway_subscribe,
            gateway::gateway_complete,
            gateway::gateway_feedback,
            gateway::gateway_revoke,
            gateway::gateway_control_ack
        ])
        .run(tauri::generate_context!())
        .expect("Tauri application failed");
}
