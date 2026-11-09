use tokio::time::{sleep_until, Duration, Instant};

/// Pace ingestion without dropping the exact packet already read from the socket.
/// The connection holds at most that one packet and reads no successor while waiting.
pub struct ObservationPacer { next: Instant }
impl ObservationPacer {
    pub fn new() -> Self { Self { next: Instant::now() } }
    pub async fn wait(&mut self) {
        sleep_until(self.next).await;
        self.next = Instant::now() + Duration::from_millis(60);
    }
}
