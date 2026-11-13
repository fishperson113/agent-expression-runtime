const MAX_BYTES = 192 * 1024;
export function validCameraImage(value) {
  if (!value || Object.keys(value).sort().join() !== 'capturedAt,height,mediaTime,readAt,schemaVersion,url,width' || value.schemaVersion !== 1) return false;
  if (![value.width, value.height].every(n => Number.isInteger(n) && n > 0 && n <= 640) ||
    ![value.capturedAt, value.readAt, value.mediaTime].every(n => Number.isFinite(n) && n >= 0) ||
    value.readAt - value.capturedAt < 0 || value.readAt - value.capturedAt > 1500) return false;
  return validCameraJpeg(value.url, value.width, value.height);
}
export function validCameraJpeg(url, width, height) {
  if (typeof url !== 'string' || url.length > 23 + Math.ceil(MAX_BYTES / 3) * 4 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(url)) return false;
  const encoded = url.slice(23), bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > MAX_BYTES || bytes.toString('base64') !== encoded || bytes.length < 12 ||
    bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) return false;
  for (let at = 2; at + 4 < bytes.length;) {
    if (bytes[at++] !== 255) return false;
    while (bytes[at] === 255) at++;
    const marker = bytes[at++];
    if (marker === 218 || marker === 217 || at + 2 > bytes.length) return false;
    const length = bytes.readUInt16BE(at);
    if (length < 2 || at + length > bytes.length) return false;
    if ([192,193,194].includes(marker)) {
      if (length < 8) return false;
      const h = bytes.readUInt16BE(at + 3), w = bytes.readUInt16BE(at + 5);
      return w > 0 && h > 0 && w <= 640 && h <= 640 && (width === undefined || w === width && h === height);
    }
    at += length;
  }
  return false;
}
