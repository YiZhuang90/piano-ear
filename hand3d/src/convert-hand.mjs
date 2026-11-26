// Converts the WebXR "generic-hand" right.glb (MIT, @webxr-input-profiles/assets) into the rig layout piano-hand.js uses:
// a bone hierarchy (forearm > hand > finger chains) named thumb1-3, index1-3 ... with *Tip ends, wrist at the origin,
// fingers along -Z, back of the hand +Y. Adds COLOR_0 (skin tone, darker in creases) and _FINGER (finger number, strength).
// Optional smoothing: one Loop-style subdivision step (midpoints, then Laplacian smoothing), skin weights carried over.
// node convert-hand.mjs <generic-hand/right.glb> <out.glb> [subdiv=1]
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const [src, out, subArg] = process.argv.slice(2);
const SUB = +(subArg ?? 1);
const buf = fs.readFileSync(src);
const g = await new Promise((r, j) => new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', r, j));
g.scene.updateMatrixWorld(true);
const mesh = g.scene.getObjectByProperty('isSkinnedMesh', true);
const oldBones = mesh.skeleton.bones;
const W0 = {}; oldBones.forEach(b => (W0[b.name] = b.matrixWorld.clone()));

// old -> new axes: X->Y (back of hand up), Y->Z (fingers away), Z->X (thumb to the left)
const R = new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1);
const wristPos = new THREE.Vector3().setFromMatrixPosition(W0.wrist).applyMatrix4(R);
const T = new THREE.Matrix4().makeTranslation(-wristPos.x, -wristPos.y, -wristPos.z).multiply(R);

const FN = { thumb: 'thumb', index: 'index-finger', middle: 'middle-finger', ring: 'ring-finger', pinky: 'pinky-finger' };
const bones = []; // {name, old, parent}
const add = (name, old, parent) => { bones.push({ name, old, parent }); return bones.length - 1; };
const iForearm = add('forearm', null, -1);
const iHand = add('hand', 'wrist', iForearm);
for (const [k, o] of Object.entries(FN)) {
  if (k === 'thumb') {
    let p = add('thumb1', 'thumb-metacarpal', iHand); p = add('thumb2', 'thumb-phalanx-proximal', p);
    p = add('thumb3', 'thumb-phalanx-distal', p); add('thumbTip', 'thumb-tip', p);
  } else {
    let p = add(k + '0', o + '-metacarpal', iHand); p = add(k + '1', o + '-phalanx-proximal', p); p = add(k + '2', o + '-phalanx-intermediate', p);
    p = add(k + '3', o + '-phalanx-distal', p); add(k + 'Tip', o + '-tip', p);
  }
}
const world = bones.map(b => (b.old ? T.clone().multiply(W0[b.old]) : new THREE.Matrix4()));
// re-orthonormalise (R is a proper rotation, so only float noise)
world.forEach(m => { const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); m.decompose(p, q, s); m.compose(p, q.normalize(), new THREE.Vector3(1, 1, 1)); });
const oldIndex = Object.fromEntries(oldBones.map((b, i) => [b.name, i]));
const remap = oldBones.map(b => bones.findIndex(n => n.old === b.name));

// geometry
const G = mesh.geometry;
let pos = Array.from(G.attributes.position.array), nrm = Array.from(G.attributes.normal.array);
let J = Array.from(G.attributes.skinIndex.array).map(j => remap[j]), Wt = Array.from(G.attributes.skinWeight.array);
let idx = Array.from(G.index.array);
const v = new THREE.Vector3(), n3 = new THREE.Matrix3().setFromMatrix4(R);
for (let i = 0; i < pos.length / 3; i++) {
  v.fromArray(pos, 3 * i).applyMatrix4(mesh.matrixWorld).applyMatrix4(T); v.toArray(pos, 3 * i);
  v.fromArray(nrm, 3 * i).applyMatrix3(n3).normalize(); v.toArray(nrm, 3 * i);
}
// weld duplicate positions (UV seams) so smoothing does not tear the surface
function weld() {
  const key = i => pos.slice(3 * i, 3 * i + 3).map(x => Math.round(x * 1e5)).join(',');
  const map = new Map(), rep = [];
  for (let i = 0; i < pos.length / 3; i++) { const k = key(i); if (!map.has(k)) map.set(k, i); rep.push(map.get(k)); }
  const keep = [...new Set(rep)], ni = new Map(keep.map((o, k) => [o, k]));
  const pick = (a, w) => keep.flatMap(o => a.slice(w * o, w * o + w));
  pos = pick(pos, 3); nrm = pick(nrm, 3); J = pick(J, 4); Wt = pick(Wt, 4);
  idx = idx.map(i => ni.get(rep[i]));
}
weld();
// skin weights as sparse maps for blending
let SW = Array.from({ length: pos.length / 3 }, (_, i) => { const m = new Map(); for (let k = 0; k < 4; k++) if (Wt[4 * i + k] > 0) m.set(J[4 * i + k], (m.get(J[4 * i + k]) || 0) + Wt[4 * i + k]); return m; });
const mixW = (list) => { const m = new Map(); for (const [w, s] of list) for (const [j, x] of w) m.set(j, (m.get(j) || 0) + x * s); return m; };
// close the open wrist with a fan, so the see-through hand shows no hollow tube
function capHoles() {
  const half = new Map();
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) half.set(idx[t + e] + '_' + idx[t + (e + 1) % 3], 1);
  const next = new Map();
  for (const k of half.keys()) { const [a, b] = k.split('_').map(Number); if (!half.has(b + '_' + a)) next.set(a, b); }
  const seen = new Set(); let n = 0;
  for (const s0 of next.keys()) {
    if (seen.has(s0)) continue;
    const loop = []; let c = s0; while (!seen.has(c) && next.has(c)) { seen.add(c); loop.push(c); c = next.get(c); }
    if (loop.length < 3) continue;
    const ctr = new THREE.Vector3(); loop.forEach(i => ctr.add(new THREE.Vector3().fromArray(pos, 3 * i))); ctr.multiplyScalar(1 / loop.length);
    const ci = pos.length / 3; pos.push(...ctr.toArray()); nrm.push(0, 0, 1);
    SW.push(mixW(loop.map(i => [SW[i], 1 / loop.length])));
    for (let k = 0; k < loop.length; k++) idx.push(loop[(k + 1) % loop.length], loop[k], ci);
    n++;
  }
  console.log('capped holes:', n);
}
capHoles();
// the source mesh stops 2 cm past the wrist; stretch that stub into a short forearm (about 10 cm) that the renderer fades out
for (let i = 2; i < pos.length; i += 3) if (pos[i] > 0) pos[i] *= 5;

function subdivide() { // Loop subdivision (simplified boundary handling)
  const nv = pos.length / 3, P = i => new THREE.Vector3().fromArray(pos, 3 * i);
  const edgeMid = new Map(), opp = new Map(), nb = Array.from({ length: nv }, () => new Set());
  const ek = (a, b) => (a < b ? a + '_' + b : b + '_' + a);
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = idx[t + e], b = idx[t + (e + 1) % 3], c = idx[t + (e + 2) % 3];
    nb[a].add(b); nb[b].add(a);
    const k = ek(a, b); if (!opp.has(k)) opp.set(k, []); opp.get(k).push(c);
  }
  const NP = [], NSW = [];
  for (let i = 0; i < nv; i++) { // even vertices
    const ns = [...nb[i]], n = ns.length, beta = n > 3 ? 3 / (8 * n) : 3 / 16;
    const boundary = ns.some(j => opp.get(ek(i, j)).length < 2);
    if (boundary) { NP.push(P(i)); NSW.push(SW[i]); continue; }
    const p = P(i).multiplyScalar(1 - n * beta); ns.forEach(j => p.addScaledVector(P(j), beta)); NP.push(p);
    NSW.push(mixW([[SW[i], 1 - n * beta], ...ns.map(j => [SW[j], beta])]));
  }
  for (const [k, cs] of opp) { // odd vertices
    const [a, b] = k.split('_').map(Number);
    let p, w;
    if (cs.length === 2) { p = P(a).add(P(b)).multiplyScalar(3 / 8).addScaledVector(P(cs[0]), 1 / 8).addScaledVector(P(cs[1]), 1 / 8); w = mixW([[SW[a], 3 / 8], [SW[b], 3 / 8], [SW[cs[0]], 1 / 8], [SW[cs[1]], 1 / 8]]); }
    else { p = P(a).add(P(b)).multiplyScalar(0.5); w = mixW([[SW[a], 0.5], [SW[b], 0.5]]); }
    edgeMid.set(k, NP.length); NP.push(p); NSW.push(w);
  }
  const NI = [];
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]], ab = edgeMid.get(ek(a, b)), bc = edgeMid.get(ek(b, c)), ca = edgeMid.get(ek(c, a));
    NI.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  pos = NP.flatMap(p => p.toArray()); SW = NSW; idx = NI;
}
for (let s = 0; s < SUB; s++) subdivide();
const nv = pos.length / 3;
// normals
nrm = new Array(nv * 3).fill(0);
for (let t = 0; t < idx.length; t += 3) {
  const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]].map(i => new THREE.Vector3().fromArray(pos, 3 * i));
  const fn = b.clone().sub(a).cross(c.clone().sub(a));
  for (const i of [idx[t], idx[t + 1], idx[t + 2]]) { nrm[3 * i] += fn.x; nrm[3 * i + 1] += fn.y; nrm[3 * i + 2] += fn.z; }
}
for (let i = 0; i < nv; i++) { v.fromArray(nrm, 3 * i).normalize(); v.toArray(nrm, 3 * i); }
// top-4 skin weights
const JO = new Uint8Array(nv * 4), WO = new Uint8Array(nv * 4);
SW.forEach((m, i) => {
  const top = [...m].sort((x, y) => y[1] - x[1]).slice(0, 4), s = top.reduce((a, x) => a + x[1], 0) || 1;
  let acc = 0; top.forEach(([j, x], k) => { JO[4 * i + k] = j; const q = k === top.length - 1 ? 255 - acc : Math.round(255 * x / s); WO[4 * i + k] = q; acc += q; });
});
// finger number + strength, from the skin weights
const fingerOf = bones.map(b => { const m = b.name.match(/^(thumb|index|middle|ring|pinky)(\d|Tip)$/); return m ? { f: ['thumb', 'index', 'middle', 'ring', 'pinky'].indexOf(m[1]) + 1, seg: m[2] } : null; });
const FING = new Float32Array(nv * 2);
SW.forEach((m, i) => {
  const per = [0, 0, 0, 0, 0, 0];
  for (const [j, x] of m) { const fo = fingerOf[j]; if (!fo) continue; const segW = fo.seg === '0' ? 0 : fo.f === 1 && fo.seg === '1' ? 0.35 : 1; per[fo.f] += x * segW; }
  let best = 1; for (let f = 2; f <= 5; f++) if (per[f] > per[best]) best = f;
  FING[2 * i] = per[best] > 0.02 ? best : 0; FING[2 * i + 1] = Math.min(1, per[best]);
});
// skin colour: a warm tone, slightly lighter on the back of the hand, darker under the fingers (cheap occlusion)
const COL = new Uint8Array(nv * 4);
const hex = h => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const SKIN = hex(0xe2b49a), PALM = hex(0xd99c88);
for (let i = 0; i < nv; i++) {
  const ny = nrm[3 * i + 1], t = Math.min(1, Math.max(0, 0.5 - ny * 0.5));
  const c = SKIN.map((x, k) => x + (PALM[k] - x) * t);
  for (let k = 0; k < 3; k++) COL[4 * i + k] = Math.round(255 * c[k]);
  COL[4 * i + 3] = 255;
}

// ---- write GLB ----
const posF = Float32Array.from(pos), nrmF = Float32Array.from(nrm);
const bins = []; let off = 0; const views = [], accessors = [];
function addView(arr, target) { const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength); const pad = (4 - (b.length % 4)) % 4; views.push({ buffer: 0, byteOffset: off, byteLength: b.length, ...(target ? { target } : {}) }); bins.push(b, Buffer.alloc(pad)); off += b.length + pad; return views.length - 1; }
function addAcc(arr, type, ctype, count, extra = {}) { const t = extra.target; delete extra.target; accessors.push({ bufferView: addView(arr, t), componentType: ctype, count, type, ...extra }); return accessors.length - 1; }
const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], posF[3 * i + k]); mx[k] = Math.max(mx[k], posF[3 * i + k]); }
const aPos = addAcc(posF, 'VEC3', 5126, nv, { min: mn, max: mx, target: 34962 });
const aNrm = addAcc(nrmF, 'VEC3', 5126, nv, { target: 34962 });
const aCol = addAcc(COL, 'VEC4', 5121, nv, { normalized: true, target: 34962 });
const aJ = addAcc(JO, 'VEC4', 5121, nv, { target: 34962 });
const aW = addAcc(WO, 'VEC4', 5121, nv, { normalized: true, target: 34962 });
const aF = addAcc(FING, 'VEC2', 5126, nv, { target: 34962 });
const I = nv < 65536 ? Uint16Array.from(idx) : Uint32Array.from(idx);
const aIdx = addAcc(I, 'SCALAR', nv < 65536 ? 5123 : 5125, idx.length, { target: 34963 });
const ibm = new Float32Array(bones.length * 16); world.forEach((m, i) => ibm.set(m.clone().invert().elements, 16 * i));
const aIbm = addAcc(ibm, 'MAT4', 5126, bones.length);
const nodes = [{ name: 'RightHand', children: [1, 2] }, { name: 'HandMesh', mesh: 0, skin: 0 }];
bones.forEach((b, i) => {
  const local = b.parent < 0 ? world[i].clone() : world[b.parent].clone().invert().multiply(world[i]);
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); local.decompose(p, q, s);
  const kids = bones.map((c, k) => (c.parent === i ? k + 2 : -1)).filter(k => k >= 0);
  nodes.push({ name: b.name, translation: p.toArray(), rotation: q.normalize().toArray(), ...(kids.length ? { children: kids } : {}) });
});
const gltf = {
  asset: { version: '2.0', generator: 'piano-hand convert-hand.mjs', copyright: 'Hand mesh: WebXR Input Profiles generic-hand, MIT License, Copyright (c) 2019 Amazon' },
  extras: { units: 'metres', source: 'https://github.com/immersive-web/webxr-input-profiles (packages/assets/profiles/generic-hand)', license: 'MIT', note: 'Bones: forearm, hand, thumb1-3, index0-3, middle0-3, ring0-3, pinky0-3 (+ *Tip). Local -Z along each finger, +Y toward the nail. _FINGER = (finger 1-5, strength 0-1).' },
  scene: 0, scenes: [{ nodes: [0] }], nodes,
  meshes: [{ name: 'HandMesh', primitives: [{ attributes: { POSITION: aPos, NORMAL: aNrm, COLOR_0: aCol, JOINTS_0: aJ, WEIGHTS_0: aW, _FINGER: aF }, indices: aIdx, material: 0 }] }],
  materials: [{ name: 'Skin', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.55 } }],
  skins: [{ name: 'RightHandRig', joints: bones.map((_, i) => i + 2), inverseBindMatrices: aIbm, skeleton: 2 }],
  buffers: [{ byteLength: off }], bufferViews: views, accessors,
};
let json = Buffer.from(JSON.stringify(gltf)); json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const bin = Buffer.concat(bins);
const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
fs.writeFileSync(out, Buffer.concat([head, ch(json.length, 0x4e4f534a), json, ch(bin.length, 0x004e4942), bin]));
console.log(out, (fs.statSync(out).size / 1024).toFixed(0) + ' KB', nv, 'verts', idx.length / 3, 'tris', bones.length, 'bones');
const tip = n => { const i = bones.findIndex(b => b.name === n); return new THREE.Vector3().setFromMatrixPosition(world[i]).toArray().map(x => (x * 100).toFixed(1)).join(','); };
console.log('tips cm:', ['thumbTip', 'indexTip', 'middleTip', 'ringTip', 'pinkyTip', 'index1', 'middle1', 'pinky1', 'thumb1'].map(n => n + '(' + tip(n) + ')').join(' '));
