// Offline preview: poses the GLB with HandRig and rasterises it over an HTML-like keyboard into a PNG.
// node preview.mjs <right-hand.glb> <out.png> [anchor] [actions...]   actions: hl:F, press:F, shift:A, t:seconds
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PNG } from 'pngjs';
import { HandRig } from './piano-hand.js';

const [glbPath, outPath, anchorArg, ...acts] = process.argv.slice(2);
const buf = fs.readFileSync(glbPath);
const gltf = await new Promise((res, rej) => new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
const rig = new HandRig(gltf.scene, JSON.parse(process.env.POSE || '{}'));
const NW = 12, LOW = 53, HIGH = 72, WHITE = [0, 2, 4, 5, 7, 9, 11];
const env = process.env;
const kbW = +(env.KBW || 351), kbH = +(env.KBH || 130), extra = +(env.EXTRA || 66), SS = 3;
const s = kbW / NW, tilt = Math.acos(Math.min(0.87, Math.max(0.5, kbH / (s * 5.6)))), L = kbH / (s * Math.cos(tilt));
rig.setKeyLength(L);
rig.moveTo(+(anchorArg ?? 4), { instant: true });
rig.update(0.016);
for (const a of acts) {
  const [k, v] = a.split(':');
  if (k === 'hl') rig.highlight(+v);
  if (k === 'press') rig.press(+v);
  if (k === 'shift') rig.moveTo(+v);
  if (k === 't') { const n = Math.round(+v / 0.008); for (let i = 0; i < n; i++) rig.update(0.008); }
}
rig.root.updateMatrixWorld(true);
const W = kbW * SS, Hh = (kbH + extra) * SS, px = s * SS;
const img = new Float32Array(W * Hh * 3), zb = new Float32Array(W * Hh).fill(-1e9);
const isW = m => WHITE.includes(m % 12);
const whites = []; for (let m = LOW; m <= HIGH; m++) if (isW(m)) whites.push(m);
const srgb = h => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255].map(x => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
const fill = (x0, y0, x1, y1, col) => { for (let y = Math.max(0, y0 | 0); y < Math.min(Hh, y1); y++) for (let x = Math.max(0, x0 | 0); x < Math.min(W, x1); x++) img.set(col, 3 * (y * W + x)); };
fill(0, 0, W, Hh, srgb(0x2b2420));
const target = env.TARGET ? +env.TARGET : null;
whites.forEach((m, i) => fill(i * px + SS, 0, (i + 1) * px - SS, kbH * SS, srgb(m === target ? 0xffd9df : 0xf6f4ef)));
for (let m = LOW; m <= HIGH; m++) if (!isW(m)) { const cx = (whites.indexOf(m - 1) + 1) * px, w = px * 0.62; fill(cx - w / 2, 0, cx + w / 2, kbH * 0.6 * SS, srgb(0x16171a)); }
// camera mapping
const up = new THREE.Vector3(0, Math.sin(tilt), -Math.cos(tilt)), fwd = new THREE.Vector3(0, -Math.cos(tilt), -Math.sin(tilt));
const toScr = p => [p.x * px, -p.dot(up) * px, -p.dot(fwd)];
const mesh = rig.mesh, g = mesh.geometry, nv = g.attributes.position.count, idx = g.index.array, col = g.attributes.color;
const P = new Float32Array(nv * 3), S3 = new Float32Array(nv * 3), N = new Float32Array(nv * 3);
const v = new THREE.Vector3();
for (let i = 0; i < nv; i++) { mesh.getVertexPosition(i, v); v.applyMatrix4(mesh.matrixWorld); P.set([v.x, v.y, v.z], 3 * i); S3.set(toScr(v), 3 * i); }
for (let t = 0; t < idx.length; t += 3) {
  const [a, b, cc] = [idx[t], idx[t + 1], idx[t + 2]];
  const ux = P[3 * b] - P[3 * a], uy = P[3 * b + 1] - P[3 * a + 1], uz = P[3 * b + 2] - P[3 * a + 2];
  const wx = P[3 * cc] - P[3 * a], wy = P[3 * cc + 1] - P[3 * a + 1], wz = P[3 * cc + 2] - P[3 * a + 2];
  const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
  for (const k of [a, b, cc]) { N[3 * k] += nx; N[3 * k + 1] += ny; N[3 * k + 2] += nz; }
}
for (let i = 0; i < nv; i++) { const l = Math.hypot(N[3 * i], N[3 * i + 1], N[3 * i + 2]) || 1; N[3 * i] /= l; N[3 * i + 1] /= l; N[3 * i + 2] /= l; }
const Ld = new THREE.Vector3(-4, 12, 6).normalize(), view = fwd.clone().negate();
const Hv = Ld.clone().add(view).normalize();
const tintF = rig.tint;
const fid = g.attributes._finger;
function shade(i0, i1, i2, w0, w1, w2) {
  let nx = N[3 * i0] * w0 + N[3 * i1] * w1 + N[3 * i2] * w2, ny = N[3 * i0 + 1] * w0 + N[3 * i1 + 1] * w1 + N[3 * i2 + 1] * w2, nz = N[3 * i0 + 2] * w0 + N[3 * i1 + 2] * w1 + N[3 * i2 + 2] * w2;
  const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  const ndl = Math.max(0, nx * Ld.x + ny * Ld.y + nz * Ld.z), hemi = 0.5 + 0.5 * ny, spec = Math.pow(Math.max(0, nx * Hv.x + ny * Hv.y + nz * Hv.z), 30) * 0.12;
  const rim = Math.pow(1 - Math.max(0, nx * view.x + ny * view.y + nz * view.z), 3) * 0.18;
  const out = [];
  const f = Math.round(fid.getX(i0)), fs2 = fid.getY(i0) * w0 + fid.getY(i1) * w1 + fid.getY(i2) * w2, T = tintF[f] || { w: 0 };
  for (let k = 0; k < 3; k++) {
    let alb = (col.getComponent(i0, k) * w0 + col.getComponent(i1, k) * w1 + col.getComponent(i2, k) * w2);
    const ta = T.w * Math.min(1, Math.max(0, (fs2 - 0.15) / 0.7));
    if (ta > 0) alb = alb + ([T.x, T.y, T.z][k] - alb) * ta * 0.72;
    out.push(alb * (0.42 * hemi + 0.95 * ndl) + spec + rim * alb);
  }
  return out;
}
for (let t = 0; t < idx.length; t += 3) {
  const i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2];
  const ax = S3[3 * i0], ay = S3[3 * i0 + 1], az = S3[3 * i0 + 2], bx = S3[3 * i1], by = S3[3 * i1 + 1], bz = S3[3 * i1 + 2], cx = S3[3 * i2], cy = S3[3 * i2 + 1], cz = S3[3 * i2 + 2];
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax); if (Math.abs(area) < 1e-9) continue;
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(Hh - 1, Math.ceil(Math.max(ay, by, cy)));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const qx = x + 0.5, qy = y + 0.5;
    const w0 = ((bx - qx) * (cy - qy) - (by - qy) * (cx - qx)) / area, w1 = ((cx - qx) * (ay - qy) - (cy - qy) * (ax - qx)) / area, w2 = 1 - w0 - w1;
    if (w0 < 0 || w1 < 0 || w2 < 0) continue;
    const z = az * w0 + bz * w1 + cz * w2, o = y * W + x;
    if (z <= zb[o]) continue; zb[o] = z;
    const fade = Math.min(1, Math.max(0, (Hh - y) / (46 * SS)));
    const cl = shade(i0, i1, i2, w0, w1, w2);
    for (let k = 0; k < 3; k++) img[3 * o + k] = img[3 * o + k] * (1 - fade) + cl[k] * fade;
  }
}
// downsample + tone
const OW = kbW, OH = kbH + extra, png = new PNG({ width: OW, height: OH });
const enc = x => { x = Math.max(0, Math.min(1, x)); return Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)); };
for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) for (let k = 0; k < 3; k++) {
  let a = 0; for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) a += img[3 * ((y * SS + j) * W + x * SS + i) + k];
  png.data[4 * (y * OW + x) + k] = enc(a / (SS * SS));
  png.data[4 * (y * OW + x) + 3] = 255;
}
fs.writeFileSync(outPath, PNG.sync.write(png));
const tips = [1, 2, 3, 4, 5].map(f => { const p = rig.tipWorld(f); return `${f}:(${p.x.toFixed(2)},${p.y.toFixed(2)},${(p.z / L).toFixed(2)}L)`; });
console.log('L', L.toFixed(2), 'tilt', (tilt / Math.PI * 180).toFixed(1), tips.join(' '));
console.log('fingers', JSON.stringify(rig.to.fingers, (k, x) => (typeof x === 'number' ? +x.toFixed(1) : x)));
