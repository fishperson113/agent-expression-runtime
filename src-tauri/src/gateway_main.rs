#[path = "gateway.rs"]
mod gateway;
#[cfg(test)]
#[path = "gateway_tests.rs"]
mod gateway_tests;

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let token = std::env::var("AER_PAIRING_TOKEN")
        .expect("Set an ephemeral AER_PAIRING_TOKEN in the host environment");
    let gateway = gateway::Gateway::with_host_token(token)
        .expect("Invalid pairing credential configuration");
    let server = gateway.clone();
    let task = tokio::spawn(async move { server.serve().await });
    for _ in 0..100 {
        if !gateway.address.lock().unwrap().is_empty() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    println!("{}", serde_json::json!({
        "baseUrl": *gateway.address.lock().unwrap(), "mode": "browser-gateway"
    }));
    task.await.expect("Gateway task failed").expect("Gateway failed");
}
