// Builds a rigged right hand (skinned glTF binary) from a signed-distance model.
// Units: centimetres while modelling, written to glTF in metres.
// Frame: x to the right, y up (back of the hand), z toward the player. Wrist at the origin, fingers toward -z.
// Usage: node build-hand.mjs <out.glb> [cellSizeCm]
import fs from 'node:fs';
import * as THREE from 'three';

const OUT = process.argv[2] || 'right-hand.glb';
const H = +(process.argv[3] || 0.15);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const D2R = Math.PI / 180;

// ---------- skeleton (bind pose) ----------
const FINGERS = [
  // name, mcp, spread (deg, + toward pinky), lengths, radius scale, bind flex (mcp, pip, dip)
  { name: 'index', mcp: V(-2.25, 0.12, -8.55), spread: -5, len: [4.4, 2.6, 2.05], rs: 1.0, flex: [8, 14, 8] },
  { name: 'middle', mcp: V(-0.25, 0.2, -9.0), spread: 0, len: [4.85, 3.0, 2.15], rs: 1.03, flex: [8, 14, 8] },
  { name: 'ring', mcp: V(1.72, 0.1, -8.6), spread: 5, len: [4.5, 2.8, 2.1], rs: 0.97, flex: [8, 14, 8] },
  { name: 'pinky', mcp: V(3.5, -0.08, -7.6), spread: 12, len: [3.55, 2.1, 1.9], rs: 0.84, flex: [8, 14, 8] },
];
const BASE_R = [0.9, 0.8, 0.7, 0.6]; // radius at mcp, pip, dip, tip
const UP = V(0, 1, 0);

function rotAbout(v, axis, ang) { return v.clone().applyAxisAngle(axis, ang); }
function frameFrom(dir, upHint) { // returns matrix with -z along dir, y toward upHint
  const z = dir.clone().negate().normalize();
  const x = new THREE.Vector3().crossVectors(upHint, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  return new THREE.Matrix4().makeBasis(x, y, z);
}

const chains = []; // each: {name, joints:[base, j1, j2, j3, tip], radii:[...], bones:[...], ups:[], dirs:[]}
for (const f of FINGERS) {
  const d0 = V(0, 0, -1).applyAxisAngle(UP, -f.spread * D2R);
  const side = new THREE.Vector3().crossVectors(d0, UP).normalize();
  let a = 0; const j = [f.mcp.clone()]; const dirs = [], ups = [];
  for (let k = 0; k < 3; k++) {
    a += f.flex[k] * D2R;
    const d = rotAbout(d0, side, -a); dirs.push(d);
    ups.push(rotAbout(UP, side, -a));
    j.push(j[k].clone().addScaledVector(d, f.len[k]));
  }
  const base = V(f.mcp.x * 0.5, -0.1, -0.9);
  chains.push({ name: f.name, joints: [base, ...j], radii: BASE_R.map(r => r * f.rs), dirs, ups, len: f.len, side,
    widths: [1.0, 0.55, 0.45], bones: [f.name + '1', f.name + '2', f.name + '3'] });
}
// thumb
{
  const cmc = V(-2.25, -0.65, -1.9);
  const dm = V(-0.56, -0.13, -0.82).normalize(), dp = V(-0.33, -0.12, -0.94).normalize(), dd = V(-0.18, -0.14, -0.97).normalize();
  const L = [4.3, 3.0, 2.5];
  const mcp = cmc.clone().addScaledVector(dm, L[0]), ip = mcp.clone().addScaledVector(dp, L[1]), tip = ip.clone().addScaledVector(dd, L[2]);
  const upHint = V(-0.62, 0.78, 0).normalize();
  const ups = [dm, dp, dd].map(d => upHint.clone().addScaledVector(d, -upHint.dot(d)).normalize());
  chains.push({ name: 'thumb', joints: [V(-1.0, -0.45, 0.1), cmc, mcp, ip, tip], radii: [1.12, 0.98, 0.9, 0.76], dirs: [dm, dp, dd], ups, len: L,
    widths: [1.5, 0.7, 0.5], bones: ['thumb1', 'thumb2', 'thumb3'] });
}
const thumb = chains[4];

// bones: forearm (root, at wrist) -> hand -> chains
const bones = []; // {name, parent, world: Matrix4}
const addBone = (name, parent, pos, rotM) => { const m = (rotM ? rotM.clone() : new THREE.Matrix4()).setPosition(pos); bones.push({ name, parent, world: m }); };
addBone('forearm', null, V(0, -0.2, 0.6));
addBone('hand', 'forearm', V(0, -0.2, 0.0));
for (const c of chains) {
  for (let k = 0; k < 3; k++) addBone(c.bones[k], k ? c.bones[k - 1] : 'hand', c.joints[k + 1], frameFrom(c.dirs[k], c.ups[k]));
  addBone(c.name + 'Tip', c.bones[2], c.joints[4], frameFrom(c.dirs[2], c.ups[2]));
}
const boneIndex = Object.fromEntries(bones.map((b, i) => [b.name, i]));

// ---------- SDF ----------
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smax = (a, b, k) => -smin(-a, -b, k);
function sdRoundCone(px, py, pz, a, b, r1, r2) {
  const bax = b.x - a.x, bay = b.y - a.y, baz = b.z - a.z;
  const l2 = bax * bax + bay * bay + baz * baz, rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  const pax = px - a.x, pay = py - a.y, paz = pz - a.z;
  const y = pax * bax + pay * bay + paz * baz, z = y - l2;
  const qx = pax * l2 - bax * y, qy = pay * l2 - bay * y, qz = paz * l2 - baz * y;
  const x2 = qx * qx + qy * qy + qz * qz, y2 = y * y * l2, z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}
function sdEllipsoid(px, py, pz, c, r) {
  const x = (px - c.x) / r.x, y = (py - c.y) / r.y, z = (pz - c.z) / r.z;
  const k0 = Math.sqrt(x * x + y * y + z * z);
  const x1 = x / r.x, y1 = y / r.y, z1 = z / r.z, k1 = Math.sqrt(x1 * x1 + y1 * y1 + z1 * z1);
  return k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -Math.min(r.x, r.y, r.z);
}
// local frame helpers for nails
const nailFrames = chains.map(c => {
  const o = c.joints[3], t = c.dirs[2], u = c.ups[2], s = new THREE.Vector3().crossVectors(t, u).normalize();
  return { o, t, u, s, L: c.len[2], r: c.radii[2] };
});
function nailRegion(n, px, py, pz) { // rounded box in (s,u,t); negative inside the nail area
  const dx = px - n.o.x, dy = py - n.o.y, dz = pz - n.o.z;
  const ls = dx * n.s.x + dy * n.s.y + dz * n.s.z, lu = dx * n.u.x + dy * n.u.y + dz * n.u.z, lt = dx * n.t.x + dy * n.t.y + dz * n.t.z;
  const isThumb = n === nailFrames[4];
  const t0 = n.L * (isThumb ? 0.36 : 0.34), t1 = n.L - 0.06, hw = n.r * (isThumb ? 0.62 : 0.58), rnd = Math.min(hw * 0.7, 0.32);
  const ct = (t0 + t1) / 2, ht = (t1 - t0) / 2;
  const qs = Math.abs(ls) - hw + rnd, qt = Math.abs(lt - ct) - ht + rnd;
  const d2 = Math.min(Math.max(qs, qt), 0) + Math.hypot(Math.max(qs, 0), Math.max(qt, 0)) - rnd;
  return Math.max(d2, n.r * 0.25 - lu); // only on the top side
}

const palmC = V(0.6, -0.3, -4.9), palmR = V(3.45, 1.05, 4.2);
const thenarA = thumb.joints[1].clone().add(V(0.5, -0.45, -0.6)), thenarB = thumb.joints[2].clone().add(V(0.75, -0.35, 0.75));
const hypoA = V(3.0, -0.75, -1.8), hypoB = V(3.85, -0.55, -6.6);
function sdWrist(px, py, pz) {
  const zz = Math.max(pz, 0), a = 2.72 + 0.035 * zz, b = 1.72 + 0.03 * zz, cy = -0.3;
  const ex = px / a, ey = (py - cy) / b, k0 = Math.hypot(ex, ey), k1 = Math.hypot(ex / a, ey / b);
  const e = k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -b;
  const z0 = -1.6, z1 = 13.0, zc = (z0 + z1) / 2, hz = (z1 - z0) / 2;
  const wx = e, wz = Math.abs(pz - zc) - hz;
  return Math.min(Math.max(wx, wz), 0) + Math.hypot(Math.max(wx, 0), Math.max(wz, 0));
}
function sdFinger(c, px, py, pz) {
  const j = c.joints, r = c.radii;
  let d = sdRoundCone(px, py, pz, j[1], j[2], r[0], r[1] * 0.94);
  d = smin(d, sdRoundCone(px, py, pz, j[2], j[3], r[1] * 0.95, r[2] * 0.95), 0.22);
  d = smin(d, sdEllipsoid(px, py, pz, j[2].clone().addScaledVector(c.ups[1], 0.06), V(r[1] * 1.04, r[1] * 0.98, r[1] * 1.04)), 0.3); // knuckle
  d = smin(d, sdEllipsoid(px, py, pz, j[3].clone().addScaledVector(c.ups[2], 0.04), V(r[2] * 1.0, r[2] * 0.95, r[2] * 1.0)), 0.25);
  const tipC = j[4].clone().addScaledVector(c.dirs[2], -r[3]);
  d = smin(d, sdRoundCone(px, py, pz, j[3], tipC, r[2] * 0.96, r[3]), 0.2);
  // fingertip pad, a little fuller underneath
  const padC = j[3].clone().addScaledVector(c.dirs[2], c.len[2] * 0.58).addScaledVector(c.ups[2], -r[2] * 0.22);
  d = smin(d, sdEllipsoid(px, py, pz, padC, V(r[2] * 0.78, r[2] * 0.74, r[2] * 0.82)), 0.22);
  return d;
}
function sdDistal(c, px, py, pz) {
  const j = c.joints, r = c.radii, tipC = j[4].clone().addScaledVector(c.dirs[2], -r[3]);
  return sdRoundCone(px, py, pz, j[3], tipC, r[2] * 0.96, r[3]);
}
function parts(px, py, pz) {
  // palm + wrist
  let h = sdEllipsoid(px, py, pz, palmC, palmR);
  for (let i = 0; i < 4; i++) {
    const c = chains[i], r = c.radii[0];
    h = smin(h, sdRoundCone(px, py, pz, c.joints[0], c.joints[1].clone().add(V(0, -0.05, 0.25)), r * 1.12, r * 1.02), 1.0);
    h = smin(h, sdEllipsoid(px, py, pz, c.joints[1].clone().add(V(0, 0.12, 0.2)), V(r * 1.05, r * 0.98, r * 1.0)), 0.45);
    // extensor tendon ridge on the back of the hand
    const tA = c.joints[1].clone().add(V(0, r * 0.88, 0.9)), tB = V(c.joints[1].x * 0.3, 1.0, -1.2);
    h = smin(h, sdRoundCone(px, py, pz, tA, tB, 0.2, 0.17), 0.55);
  }
  h = smin(h, sdRoundCone(px, py, pz, thenarA, thenarB, 1.38, 0.95), 1.0);
  h = smin(h, sdRoundCone(px, py, pz, hypoA, hypoB, 1.05, 0.9), 0.9);
  h = smin(h, sdWrist(px, py, pz), 1.6);
  // thumb metacarpal joins the palm softly
  h = smin(h, sdRoundCone(px, py, pz, thumb.joints[1], thumb.joints[2], thumb.radii[0], thumb.radii[1]), 1.1);
  const f = [];
  for (let i = 0; i < 5; i++) {
    const c = chains[i];
    let d = i === 4
      ? smin(sdRoundCone(px, py, pz, c.joints[2], c.joints[3], c.radii[1], c.radii[2]), smin(sdRoundCone(px, py, pz, c.joints[3], c.joints[4].clone().addScaledVector(c.dirs[2], -c.radii[3]), c.radii[2] * 0.97, c.radii[3]), sdEllipsoid(px, py, pz, c.joints[3].clone().addScaledVector(c.dirs[2], c.len[2] * 0.55).addScaledVector(c.ups[2], -c.radii[2] * 0.25), V(c.radii[2] * 0.85, c.radii[2] * 0.85, c.radii[2] * 0.9)), 0.3), 0.25)
      : sdFinger(c, px, py, pz);
    // nail: shell over the distal segment, limited to the nail area
    const nf = nailFrames[i];
    const nail = Math.max(sdDistal(c, px, py, pz) - 0.055, nailRegion(nf, px, py, pz));
    d = smin(d, nail, 0.03);
    f.push(d);
  }
  return { h, f };
}
function sdf(px, py, pz) {
  const { h, f } = parts(px, py, pz);
  let d = h;
  d = smin(d, f[0], 0.75); d = smin(d, f[1], 0.75); d = smin(d, f[2], 0.75); d = smin(d, f[3], 0.7);
  d = smin(d, f[4], 0.8);
  return d;
}

// ---------- surface nets ----------
const bb = new THREE.Box3();
for (const c of chains) for (const p of c.joints) bb.expandByPoint(p);
bb.expandByPoint(V(0, 0, 13)); bb.min.subScalar(1.6); bb.max.addScalar(1.6); bb.max.z = 13.2;
const nx = Math.ceil((bb.max.x - bb.min.x) / H), ny = Math.ceil((bb.max.y - bb.min.y) / H), nz = Math.ceil((bb.max.z - bb.min.z) / H);
console.log('grid', nx, ny, nz);
const ox = bb.min.x, oy = bb.min.y, oz = bb.min.z;
const field = new Float32Array((nx + 1) * (ny + 1) * (nz + 1));
const fi = (i, j, k) => (k * (ny + 1) + j) * (nx + 1) + i;
for (let k = 0; k <= nz; k++) for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) field[fi(i, j, k)] = sdf(ox + i * H, oy + j * H, oz + k * H);
const cellVert = new Int32Array(nx * ny * nz).fill(-1);
const ci = (i, j, k) => (k * ny + j) * nx + i;
let pos = [];
const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
  const v = corners.map(([a, b, c]) => field[fi(i + a, j + b, k + c)]);
  let mask = 0; for (let n = 0; n < 8; n++) if (v[n] < 0) mask |= 1 << n;
  if (mask === 0 || mask === 255) continue;
  let sx = 0, sy = 0, sz = 0, cnt = 0;
  for (const [a, b] of edges) {
    if ((v[a] < 0) === (v[b] < 0)) continue;
    const t = v[a] / (v[a] - v[b]), A = corners[a], B = corners[b];
    sx += A[0] + (B[0] - A[0]) * t; sy += A[1] + (B[1] - A[1]) * t; sz += A[2] + (B[2] - A[2]) * t; cnt++;
  }
  cellVert[ci(i, j, k)] = pos.length / 3;
  pos.push(ox + (i + sx / cnt) * H, oy + (j + sy / cnt) * H, oz + (k + sz / cnt) * H);
}
const quads = [];
for (let k = 1; k < nz; k++) for (let j = 1; j < ny; j++) for (let i = 1; i < nx; i++) {
  const s0 = field[fi(i, j, k)] < 0;
  // x edge (i,j,k)-(i+1,j,k): cells around share j-1..j, k-1..k
  if (i < nx) { const s1 = field[fi(i + 1, j, k)] < 0; if (s0 !== s1) { const q = [ci(i, j - 1, k - 1), ci(i, j, k - 1), ci(i, j, k), ci(i, j - 1, k)].map(c => cellVert[c]); quads.push(s0 ? q : q.slice().reverse()); } }
  if (j < ny) { const s1 = field[fi(i, j + 1, k)] < 0; if (s0 !== s1) { const q = [ci(i - 1, j, k - 1), ci(i - 1, j, k), ci(i, j, k), ci(i, j, k - 1)].map(c => cellVert[c]); quads.push(s0 ? q : q.slice().reverse()); } }
  if (k < nz) { const s1 = field[fi(i, j, k + 1)] < 0; if (s0 !== s1) { const q = [ci(i - 1, j - 1, k), ci(i, j - 1, k), ci(i, j, k), ci(i - 1, j, k)].map(c => cellVert[c]); quads.push(s0 ? q : q.slice().reverse()); } }
}
const nv = pos.length / 3; pos = Float32Array.from(pos);
console.log('verts', nv, 'quads', quads.length);
const grad = (x, y, z, e = 0.01) => {
  const gx = sdf(x + e, y, z) - sdf(x - e, y, z), gy = sdf(x, y + e, z) - sdf(x, y - e, z), gz = sdf(x, y, z + e) - sdf(x, y, z - e);
  return [gx / (2 * e), gy / (2 * e), gz / (2 * e)];
};
function project() {
  for (let v = 0; v < nv; v++) for (let it = 0; it < 3; it++) {
    const x = pos[3 * v], y = pos[3 * v + 1], z = pos[3 * v + 2], d = sdf(x, y, z), g = grad(x, y, z), gg = g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
    if (gg < 1e-8) break;
    pos[3 * v] -= d * g[0] / gg; pos[3 * v + 1] -= d * g[1] / gg; pos[3 * v + 2] -= d * g[2] / gg;
    if (Math.abs(d) < 1e-4) break;
  }
}
// neighbour lists for relaxation
const nb = Array.from({ length: nv }, () => new Set());
for (const q of quads) for (let a = 0; a < 4; a++) { nb[q[a]].add(q[(a + 1) % 4]); nb[q[(a + 1) % 4]].add(q[a]); }
project();
for (let pass = 0; pass < 2; pass++) {
  const np = new Float32Array(pos);
  for (let v = 0; v < nv; v++) { let sx = 0, sy = 0, sz = 0; for (const u of nb[v]) { sx += pos[3 * u]; sy += pos[3 * u + 1]; sz += pos[3 * u + 2]; } const n = nb[v].size; if (!n) continue; np[3 * v] = 0.5 * pos[3 * v] + 0.5 * sx / n; np[3 * v + 1] = 0.5 * pos[3 * v + 1] + 0.5 * sy / n; np[3 * v + 2] = 0.5 * pos[3 * v + 2] + 0.5 * sz / n; }
  pos = np; project();
}
// triangles, shorter diagonal
const tri = [];
const dist2 = (a, b) => { const dx = pos[3 * a] - pos[3 * b], dy = pos[3 * a + 1] - pos[3 * b + 1], dz = pos[3 * a + 2] - pos[3 * b + 2]; return dx * dx + dy * dy + dz * dz; };
for (const q of quads) {
  if (q.some(x => x < 0)) continue;
  if (dist2(q[0], q[2]) < dist2(q[1], q[3])) tri.push(q[0], q[1], q[2], q[0], q[2], q[3]);
  else tri.push(q[0], q[1], q[3], q[1], q[2], q[3]);
}
const nrm = new Float32Array(nv * 3);
for (let v = 0; v < nv; v++) { const g = grad(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2], 0.02); const l = Math.hypot(...g) || 1; nrm[3 * v] = g[0] / l; nrm[3 * v + 1] = g[1] / l; nrm[3 * v + 2] = g[2] / l; }
{ // make triangle winding agree with the outward normals (counter-clockwise front faces)
  let agree = 0;
  for (let t = 0; t < tri.length; t += 3) {
    const [a, b, c] = [tri[t], tri[t + 1], tri[t + 2]];
    const ux = pos[3 * b] - pos[3 * a], uy = pos[3 * b + 1] - pos[3 * a + 1], uz = pos[3 * b + 2] - pos[3 * a + 2];
    const vx = pos[3 * c] - pos[3 * a], vy = pos[3 * c + 1] - pos[3 * a + 1], vz = pos[3 * c + 2] - pos[3 * a + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    agree += Math.sign(fx * nrm[3 * a] + fy * nrm[3 * a + 1] + fz * nrm[3 * a + 2]);
  }
  console.log('winding agreement', (agree / (tri.length / 3)).toFixed(3));
  if (agree < 0) for (let t = 0; t < tri.length; t += 3) { const x = tri[t + 1]; tri[t + 1] = tri[t + 2]; tri[t + 2] = x; }
}

// ---------- skin weights ----------
function chainCoord(c, p) { // closest point on polyline: returns {d (surface distance), s (arc length)}
  let best = { d: 1e9, s: 0, r: 1 }, acc = 0;
  const pts = c.joints, rad = [c.radii[0] * 1.2, ...c.radii];
  for (let k = 0; k < 4; k++) {
    const a = pts[k], b = pts[k + 1], ab = b.clone().sub(a), L = ab.length();
    let t = p.clone().sub(a).dot(ab) / (L * L); t = Math.min(1, Math.max(0, t));
    const q = a.clone().addScaledVector(ab, t), r = rad[k] + (rad[k + 1] - rad[k]) * t;
    const d = p.distanceTo(q) - r;
    if (d < best.d) best = { d, s: acc + t * L, k, t };
    acc += L;
  }
  return best;
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const chainS = chains.map(c => { const s = [0]; for (let k = 0; k < 4; k++) s.push(s[k] + c.joints[k].distanceTo(c.joints[k + 1])); return s; });
const J = new Uint8Array(nv * 4), W = new Uint8Array(nv * 4), FING = new Float32Array(nv * 2), COL = new Uint8Array(nv * 4);
const toLin = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hex = h => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const SKIN = hex(0xdcab90), SKIN_BACK = hex(0xd29f84), FLUSH = hex(0xd88e82), NAIL = hex(0xedc7bf), NAIL_EDGE = hex(0xf5e4da), CREASE = hex(0xb57d6c);
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const p = new THREE.Vector3();
for (let v = 0; v < nv; v++) {
  p.set(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]);
  const coords = chains.map(c => chainCoord(c, p));
  const dmin = Math.min(...coords.map(c => c.d));
  const wch = coords.map(c => Math.exp(-(c.d - dmin) / 0.3));
  const sum = wch.reduce((a, b) => a + b, 0);
  const acc = new Map(); const add = (name, w) => acc.set(name, (acc.get(name) || 0) + w);
  let bestC = 0, bestFw = 0;
  chains.forEach((c, ci2) => {
    const w = wch[ci2] / sum; if (w < 1e-3) return;
    const S = chainS[ci2], s = coords[ci2].s;
    const shift = [0.25, 0.05, 0.0];
    const t = [1, 2, 3].map((k, n) => sstep(S[k] + shift[n] - c.widths[n], S[k] + shift[n] + c.widths[n], s));
    const wb = [1 - t[0], t[0] - t[1], t[1] - t[2], t[2]];
    add('hand', w * wb[0]); add(c.bones[0], w * wb[1]); add(c.bones[1], w * wb[2]); add(c.bones[2], w * wb[3]);
    const fw = ci2 === 4 ? w * (wb[1] * 0.15 + wb[2] + wb[3]) : w * (wb[1] + wb[2] + wb[3]);
    if (fw > bestFw) { bestFw = fw; bestC = ci2; }
  });
  // wrist blend
  const tw = sstep(-0.9, 1.8, p.z);
  for (const [k, w] of acc) acc.set(k, w * (1 - tw));
  add('forearm', tw);
  let list = [...acc.entries()].filter(e => e[1] > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const tot = list.reduce((a, e) => a + e[1], 0);
  let q = list.map(e => Math.round(e[1] / tot * 255)); q[0] += 255 - q.reduce((a, b) => a + b, 0);
  for (let n = 0; n < 4; n++) { J[4 * v + n] = n < list.length ? boneIndex[list[n][0]] : 0; W[4 * v + n] = n < list.length ? q[n] : 0; }
  // finger id for highlighting: 1 thumb .. 5 pinky
  const fid = bestC === 4 ? 1 : bestC + 2;
  FING[2 * v] = fid; FING[2 * v + 1] = Math.min(1, bestFw * 1.15);
  // colour
  const n = V(nrm[3 * v], nrm[3 * v + 1], nrm[3 * v + 2]);
  let col = mix(SKIN, SKIN_BACK, sstep(0.2, 0.9, n.y) * 0.8);
  const c = chains[bestC], cc = coords[bestC], S = chainS[bestC];
  const tipT = sstep(S[3], S[4], cc.s); col = mix(col, FLUSH, 0.35 * tipT + 0.12);
  for (let k = 1; k <= 3; k++) { // knuckle tint + faint crease on the back
    const g = Math.exp(-(((cc.s - S[k]) / (k === 1 ? 0.7 : 0.35)) ** 2)) * sstep(0.0, 0.6, n.y);
    col = mix(col, FLUSH, 0.35 * g);
    if (k > 1) col = mix(col, CREASE, 0.25 * Math.exp(-(((cc.s - S[k] + 0.05) / 0.12) ** 2)) * sstep(0.2, 0.7, n.y));
  }
  const nr = nailRegion(nailFrames[bestC], p.x, p.y, p.z);
  const nailT = sstep(0.03, -0.05, nr) * sstep(0.1, 0.5, n.dot(c.ups[2]));
  if (nailT > 0) {
    const edge = sstep(c.len[2] - 0.45, c.len[2] - 0.15, p.clone().sub(c.joints[3]).dot(c.dirs[2]));
    col = mix(col, mix(NAIL, NAIL_EDGE, edge), nailT);
  }
  // ambient occlusion from the distance field
  let occ = 0, wsum = 1;
  for (let s2 = 1; s2 <= 5; s2++) { const hh = 0.16 * s2; occ += (hh - sdf(p.x + n.x * hh, p.y + n.y * hh, p.z + n.z * hh)) * wsum; wsum *= 0.55; }
  const ao = Math.max(0.42, Math.min(1, 1 - 1.25 * occ));
  for (let k = 0; k < 3; k++) COL[4 * v + k] = Math.round(255 * Math.min(1, toLin(col[k]) * ao));
  COL[4 * v + 3] = 255;
}

// ---------- glTF writer ----------
const M = 0.01; // cm -> m
const posM = pos.map(x => x * M);
const bins = []; let off = 0; const views = [], accessors = [];
function addView(arr, target, stride) {
  const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
  const pad = (4 - (buf.length % 4)) % 4;
  views.push({ buffer: 0, byteOffset: off, byteLength: buf.length, ...(target ? { target } : {}), ...(stride ? { byteStride: stride } : {}) });
  bins.push(buf, Buffer.alloc(pad)); off += buf.length + pad; return views.length - 1;
}
function addAcc(arr, type, ctype, count, extra = {}) { const bv = addView(arr, extra.target); delete extra.target; accessors.push({ bufferView: bv, componentType: ctype, count, type, ...extra }); return accessors.length - 1; }
const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (let v = 0; v < nv; v++) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], posM[3 * v + k]); mx[k] = Math.max(mx[k], posM[3 * v + k]); }
const aPos = addAcc(posM, 'VEC3', 5126, nv, { min: mn, max: mx, target: 34962 });
const aNrm = addAcc(nrm, 'VEC3', 5126, nv, { target: 34962 });
const aCol = addAcc(COL, 'VEC4', 5121, nv, { normalized: true, target: 34962 });
const aJ = addAcc(J, 'VEC4', 5121, nv, { target: 34962 });
const aW = addAcc(W, 'VEC4', 5121, nv, { normalized: true, target: 34962 });
const aF = addAcc(FING, 'VEC2', 5126, nv, { target: 34962 });
const idx = nv < 65536 ? Uint16Array.from(tri) : Uint32Array.from(tri);
const aIdx = addAcc(idx, 'SCALAR', nv < 65536 ? 5123 : 5125, tri.length, { target: 34963 });
const ibm = new Float32Array(bones.length * 16);
bones.forEach((b, i) => { const w = b.world.clone(); w.elements[12] *= M; w.elements[13] *= M; w.elements[14] *= M; const inv = w.clone().invert(); ibm.set(inv.elements, i * 16); });
const aIbm = addAcc(ibm, 'MAT4', 5126, bones.length);
// nodes: 0 = root, 1 = mesh, 2.. = bones
const nodes = [{ name: 'RightHand', children: [1, 2] }, { name: 'HandMesh', mesh: 0, skin: 0 }];
const worldM = b => { const w = b.world.clone(); w.elements[12] *= M; w.elements[13] *= M; w.elements[14] *= M; return w; };
bones.forEach((b, i) => {
  const parent = b.parent ? bones[boneIndex[b.parent]] : null;
  const local = parent ? worldM(parent).invert().multiply(worldM(b)) : worldM(b);
  const t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); local.decompose(t, q, s);
  const kids = bones.map((c, k) => (c.parent === b.name ? k + 2 : -1)).filter(k => k >= 0);
  nodes.push({ name: b.name, translation: t.toArray(), rotation: q.toArray(), ...(kids.length ? { children: kids } : {}) });
});
const gltf = {
  asset: { version: '2.0', generator: 'piano-hand build-hand.mjs' },
  extras: { units: 'metres', note: 'Procedural right hand. Bones: forearm, hand, thumb1-3, index1-3, middle1-3, ring1-3, pinky1-3 (+ *Tip). Local -Z points along each finger, +Y toward the nail. _FINGER = (finger number 1-5, strength 0-1).' },
  scene: 0, scenes: [{ nodes: [0] }], nodes,
  meshes: [{ name: 'HandMesh', primitives: [{ attributes: { POSITION: aPos, NORMAL: aNrm, COLOR_0: aCol, JOINTS_0: aJ, WEIGHTS_0: aW, _FINGER: aF }, indices: aIdx, material: 0 }] }],
  materials: [{ name: 'Skin', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.58 } }],
  skins: [{ name: 'RightHandRig', joints: bones.map((_, i) => i + 2), inverseBindMatrices: aIbm, skeleton: 2 }],
  accessors, bufferViews: views, buffers: [{ byteLength: off }],
};
let json = Buffer.from(JSON.stringify(gltf)); json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const bin = Buffer.concat(bins);
const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
fs.writeFileSync(OUT, Buffer.concat([head, ch(json.length, 0x4e4f534a), json, ch(bin.length, 0x004e4942), bin]));
console.log('wrote', OUT, (12 + 16 + json.length + bin.length) / 1024 | 0, 'KB', 'tris', tri.length / 3, 'bones', bones.length);
