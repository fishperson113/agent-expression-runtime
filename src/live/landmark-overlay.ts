export function drawLandmarkOverlay(canvas: HTMLCanvasElement, points: { x: number; y: number }[], visible: boolean) {
  const context = canvas.getContext('2d');
  if (!context) return;
  if (canvas.width !== 640) canvas.width = 640;
  if (canvas.height !== 480) canvas.height = 480;
  context.clearRect(0, 0, 640, 480);
  if (!visible || !points.length) return;
  context.fillStyle = '#79e6d3';
  for (const point of points) context.fillRect(point.x * 640, point.y * 480, 2, 2);
}
