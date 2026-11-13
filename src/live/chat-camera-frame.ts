export type ChatCameraFrame = { schemaVersion: 1; url: string; width: number; height: number;
  capturedAt: number; readAt: number; mediaTime: number };

export async function encodeChatFrame(video: HTMLVideoElement) {
  const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.max(1, Math.round(video.videoWidth * scale)), height = Math.max(1, Math.round(video.videoHeight * scale));
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  try {
    const context = canvas.getContext('2d'); if (!context) return null;
    context.drawImage(video, 0, 0, width, height);
    const blob = await new Promise<Blob | null>(resolve => {
      const timer = setTimeout(() => resolve(null), 500);
      canvas.toBlob(value => { clearTimeout(timer); resolve(value); }, 'image/jpeg', 0.65);
    });
    if (!blob || blob.type !== 'image/jpeg' || blob.size > 192 * 1024) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
    return { url: 'data:image/jpeg;base64,' + btoa(binary), width, height };
  } finally { canvas.width = 0; canvas.height = 0; }
}
