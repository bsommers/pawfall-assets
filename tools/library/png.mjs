// Tiny PNG encoder + preview helpers (RGBA, no deps).
import { deflateSync, crc32 } from 'node:zlib';

export function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Horizontal strip of equally sized RGBA frames ({w,h,rgba}). */
export function stripOf(frames) {
  const w = frames[0].w, h = frames[0].h, W = w * frames.length, out = new Uint8ClampedArray(W * h * 4);
  frames.forEach((f, k) => { for (let y = 0; y < h; y++) out.set(f.rgba.subarray(y * w * 4, (y + 1) * w * 4), (y * W + k * w) * 4); });
  return { w: W, h, rgba: out };
}

/** Nearest-neighbour scale of an RGBA image over a checkerboard (so transparency reads). */
export function previewOf({ w, h, rgba }, maxSide = 256, minScale = 1) {
  const s = Math.max(minScale, Math.min(8, Math.floor(maxSide / Math.max(w, h)) || 1)), W = w * s, H = h * s, out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = (x / s) | 0, sy = (y / s) | 0, i = (sy * w + sx) * 4, a = rgba[i + 3] / 255, o = (y * W + x) * 4;
    const chk = ((x >> 3) + (y >> 3)) & 1 ? 0x58 : 0x44;
    out[o] = rgba[i] * a + chk * (1 - a); out[o + 1] = rgba[i + 1] * a + chk * (1 - a); out[o + 2] = rgba[i + 2] * a + chk * (1 - a); out[o + 3] = 255;
  }
  return encodePNG(W, H, out);
}

/** Waveform preview PNG for mono PCM (Float32Array in -1..1). */
export function waveformPNG(pcm, W = 256, H = 48) {
  const out = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { out[i * 4] = 0x1a; out[i * 4 + 1] = 0x1c; out[i * 4 + 2] = 0x24; out[i * 4 + 3] = 255; }
  const per = Math.max(1, Math.floor(pcm.length / W));
  for (let x = 0; x < W; x++) {
    let mn = 0, mx = 0;
    for (let j = x * per; j < Math.min(pcm.length, (x + 1) * per); j++) { const v = pcm[j]; if (v < mn) mn = v; if (v > mx) mx = v; }
    const y0 = Math.round((1 - Math.min(1, mx)) * (H / 2 - 1)), y1 = Math.round(H / 2 + Math.min(1, -mn) * (H / 2 - 1));
    for (let y = Math.min(y0, H / 2 | 0); y <= Math.max(y1, H / 2 | 0) && y < H; y++) { const o = (y * W + x) * 4; out[o] = 0xff; out[o + 1] = 0xb0; out[o + 2] = 0x3c; }
  }
  return encodePNG(W, H, out);
}

/** 16-bit mono WAV bytes from Float32 PCM. */
export function wavBytes(pcm, sr) {
  const b = Buffer.alloc(44 + pcm.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + pcm.length * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(pcm.length * 2, 40);
  for (let i = 0; i < pcm.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, pcm[i])) * 32767), 44 + i * 2);
  return b;
}
