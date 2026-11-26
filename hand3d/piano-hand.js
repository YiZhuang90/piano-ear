// piano-hand.js — a rigged 3D right hand that plays a keyboard drawn in HTML.
// Needs three.js (r160+). Import map: { "three": ".../three.module.js", "three/addons/": ".../examples/jsm/" }
//
//   import { PianoHand } from './piano-hand.js';
//   const hand = await PianoHand.create({ container, whiteKeys: 12, keyboardHeight: () => kb.clientHeight });
//   hand.moveTo(4);        // thumb on white key 4 (0 = leftmost), fingers 2-5 on the next four keys
//   hand.highlight(3);     // the finger to play next lifts a little and turns red
//   hand.press(3);         // finger strikes (green flash); press(3, { color: 'miss' }) for orange
//   hand.play(5, { delay: 0.5, duration: 0.4 }); // scheduled strike with anticipation, for demos
//
// Hand model: WebXR Input Profiles "generic-hand" (MIT, Copyright (c) 2019 Amazon), re-rigged by src/convert-hand.mjs.
//
// Keyboard space ("key units"): one white key is 1 wide. x = 0 is the left edge of the leftmost white key,
// y is up from the key tops, z points toward the player with z = 0 at the back of the keys.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const KEY_CM = 2.35;          // width of one white key
const D2R = Math.PI / 180;
export const FINGERS = { 1: 'thumb', 2: 'index', 3: 'middle', 4: 'ring', 5: 'pinky' };
const COLORS = { next: 0xc8102e, ok: 0x16a06a, miss: 0xe2833b };

// Resting "holding a ball" shape and how the hand sits on the keys. Angles in degrees, lengths in key units.
// Based on common teaching advice (flowkey, MusicRadar, "Fundamentals of Piano Practice"): wrist about level with the
// knuckles and a little above the keys, fingers gently rounded ("holding a ball"), fingertip pads just in front of the
// black keys, thumb fairly straight and resting on its side near the front of its key, hand slightly turned in.
export const DEFAULT_POSE = {
  wristX: 3.3, wristY: 1.7, pitch: -2, yaw: 4, roll: -3, wristFlex: 0,
  tipZ: 0.6, thumbZ: 0.88,                 // middle fingertip / thumb tip depth as a fraction of the key length
  tipY: { 1: 0.15, 2: 0.07, 3: 0.07, 4: 0.07, 5: 0.07 },
  curl: { 1: [2, 6], 2: [26, 10], 3: [28, 11], 4: [26, 10], 5: [22, 9] }, // second and third joint
  twist: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  start: { 1: [15, 20], 2: [0, 25], 3: [0, 25], 4: [0, 25], 5: [0, 25] },  // [abduction, first joint] guesses
  lift: [18, 9, 2], press: [9, 5, 1], thumbLift: [8, 6, 3], thumbPress: [8, 5, 2],
  shiftLift: 0.55, readyLift: 0.55,
};

const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _v = new THREE.Vector3();
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smoother = t => t * t * t * (t * (t * 6 - 15) + 10);

class Spring { // critically damped (or a little under) second-order follower
  constructor(w = 20, z = 1) { this.x = 0; this.v = 0; this.t = 0; this.w = w; this.z = z; }
  step(dt) { const a = this.w * this.w * (this.t - this.x) - 2 * this.z * this.w * this.v; this.v += a * dt; this.x += this.v * dt; }
}

// Pose logic only: no renderer, so it also runs in Node for tests and previews.
export class HandRig {
  constructor(model, pose = {}) {
    this.P = { ...DEFAULT_POSE, ...pose };
    this.root = new THREE.Group();
    this.model = model; model.scale.setScalar(100 / KEY_CM); // metres -> key units
    this.root.add(model);
    this.bones = {}; this.mesh = null;
    model.traverse(o => { if (o.isBone) { this.bones[o.name] = o; o.userData.bindQ = o.quaternion.clone(); } if (o.isSkinnedMesh) this.mesh = o; });
    this.keyLength = 6.4; // a real white key is about 15 cm, 6.4 key widths
    this.cache = new Map();
    this.from = null; this.to = null; this.shiftT = 1; this.shiftDur = 0.5;
    this.ready = {}; this.pressS = {}; this.flash = {};
    for (let f = 1; f <= 5; f++) { this.ready[f] = new Spring(11, 0.95); this.pressS[f] = new Spring(42, 0.72); this.flash[f] = { c: new THREE.Color(), a: 0 }; }
    this.drop = new Spring(16, 0.7); this.rollS = new Spring(14, 0.8);
    this.highlighted = null; this.time = 0; this.events = [];
    this.tint = Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, 0, 0));
    this.moveTo(4, { instant: true });
  }
  chain(f) { const n = FINGERS[f]; return [n + '1', n + '2', n + '3', n + 'Tip'].map(k => this.bones[k]); }
  setBone(b, flex, abd = 0, twist = 0) {
    _e.set(-flex * D2R, -abd * D2R, twist * D2R, 'YXZ');
    b.quaternion.copy(b.userData.bindQ).multiply(_q.setFromEuler(_e));
  }
  placeHand(x, y, z, extraRoll = 0) {
    const P = this.P;
    this.root.position.set(x, y, z);
    this.root.rotation.set(P.pitch * D2R, P.yaw * D2R, (P.roll + extraRoll) * D2R, 'YXZ');
    this.setBone(this.bones.hand, P.wristFlex);
  }
  setFinger(f, abd, flex1, flex2, flex3) {
    const [b1, b2, b3] = this.chain(f), tw = this.P.twist[f];
    this.setBone(b1, flex1, abd, tw); this.setBone(b2, flex2); this.setBone(b3, flex3);
  }
  tipWorld(f, out = new THREE.Vector3()) { const t = this.chain(f)[3]; t.updateWorldMatrix(true, false); return out.setFromMatrixPosition(t.matrixWorld); }
  setKeyLength(L) { if (Math.abs(L - this.keyLength) < 1e-3) return; this.keyLength = L; this.cache.clear(); const a = this.to ? this.to.anchor : 4; this.from = this.to = this.solve(a); }
  // Solve the resting pose with the thumb on white key `anchor`: each fingertip over the middle of its key, touching it.
  solve(anchor) {
    const key = anchor + ':' + this.keyLength.toFixed(3);
    if (this.cache.has(key)) return this.cache.get(key);
    const P = this.P, sol = { anchor, fingers: {} };
    this.placeHand(anchor + P.wristX, P.wristY, 8);
    this.root.updateMatrixWorld(true);
    for (const f of [2, 3, 4, 5, 1]) {
      const [c2, c3] = P.curl[f];
      const tgt = [anchor + f - 0.5, P.tipY[f]];
      // fingers: abduction + first joint reach x and y. Thumb: also its middle joint, to reach tipZ[1] of the key length.
      const n = f === 1 && P.thumbZ ? 3 : 2; if (n === 3) tgt.push(P.thumbZ * this.keyLength - sol.dz);
      let x = [...P.start[f], c2];
      const lo = [-40, -30, -10], hi = [40, 90, 80];
      const err = q => { this.setFinger(f, q[0], q[1], n === 3 ? q[2] : c2, c3); const p = this.tipWorld(f); return [p.x - tgt[0], p.y - tgt[1], p.z - tgt[2]].slice(0, n); };
      let e = err(x), lam = 0.01;
      for (let it = 0; it < 60; it++) { // damped least squares on a numeric Jacobian
        const c0 = Math.hypot(...e); if (c0 < 2e-4) break;
        const Jm = []; // Jm[i][k] = d e_i / d x_k
        for (let k = 0; k < n; k++) { const q = x.slice(); q[k] += 0.25; const ek = err(q); ek.forEach((v, i) => { (Jm[i] ||= [])[k] = (v - e[i]) / 0.25; }); }
        const A = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => Jm.reduce((s, r) => s + r[a] * r[b], 0) + (a === b ? lam : 0)));
        const g = Array.from({ length: n }, (_, a) => -Jm.reduce((s, r, i) => s + r[a] * e[i], 0));
        for (let i = 0; i < n; i++) { for (let r = i + 1; r < n; r++) { const m = A[r][i] / A[i][i]; for (let k = i; k < n; k++) A[r][k] -= m * A[i][k]; g[r] -= m * g[i]; } }
        const d = new Array(n).fill(0); for (let i = n - 1; i >= 0; i--) { let s2 = g[i]; for (let k = i + 1; k < n; k++) s2 -= A[i][k] * d[k]; d[i] = s2 / A[i][i]; }
        const m = Math.max(...d.map(Math.abs)), sc = m > 10 ? 10 / m : 1;
        const xn = x.map((v, k) => clamp(v + d[k] * sc, lo[k], hi[k])), en = err(xn);
        if (Math.hypot(...en) < c0) { x = xn; e = en; lam = Math.max(1e-4, lam * 0.5); } else lam *= 4;
      }
      sol.fingers[f] = [x[0], x[1], n === 3 ? x[2] : c2, c3];
      if (f === 3) sol.dz = P.tipZ * this.keyLength - this.tipWorld(3).z;
    }
    sol.hand = [anchor + P.wristX, P.wristY, 8 + sol.dz]; // sliding along z does not change x or y
    this.cache.set(key, sol);
    return sol;
  }
  moveTo(anchor, { instant = false } = {}) {
    if (this.to && this.to.anchor === anchor && !instant) return;
    const next = this.solve(anchor);
    if (instant || !this.to) { this.from = this.to = next; this.shiftT = 1; return; }
    this.from = this.currentBase(); this.to = next; this.shiftT = 0;
    this.shiftDur = 0.42 + 0.05 * Math.min(6, Math.abs(next.anchor - this.from.anchor));
  }
  currentBase() {
    const s = smoother(clamp(this.shiftT, 0, 1)), A = this.from, B = this.to, lerp = (a, b) => a + (b - a) * s;
    const out = { anchor: B.anchor, hand: A.hand.map((x, i) => lerp(x, B.hand[i])), fingers: {} };
    for (let f = 1; f <= 5; f++) out.fingers[f] = A.fingers[f].map((x, i) => lerp(x, B.fingers[f][i]));
    return out;
  }
  highlight(f) { this.highlighted = f || null; for (let k = 1; k <= 5; k++) this.ready[k].t = k === this.highlighted ? this.P.readyLift : 0; }
  press(f, { color = 'ok', hold = 0.16 } = {}) {
    if (!FINGERS[f]) return;
    const s = this.pressS[f]; s.t = 1;
    this.events.push({ at: this.time + hold, fn: () => { s.t = 0; } });
    this.drop.t = 0.11; this.events.push({ at: this.time + hold * 0.8, fn: () => { this.drop.t = 0; } });
    this.rollS.t = -(f - 3) * 0.8; this.events.push({ at: this.time + hold, fn: () => { this.rollS.t = 0; } });
    if (color) { this.flash[f].c.set(COLORS[color] ?? color); this.flash[f].a = 1; }
  }
  // A strike scheduled ahead of time, with the finger lifting first: for demonstrations.
  play(f, { delay = 0, duration = 0.3, color = 'ok' } = {}) {
    const at = this.time + delay;
    this.events.push({ at: at - 0.16, fn: () => { this.ready[f].t = 1; } });
    this.events.push({ at, fn: () => { this.ready[f].t = f === this.highlighted ? this.P.readyLift : 0; this.press(f, { color, hold: clamp(duration * 0.7, 0.1, 0.35) }); } });
  }
  update(dt) {
    dt = Math.min(dt, 0.1); this.time += dt;
    this.events.sort((a, b) => a.at - b.at);
    while (this.events.length && this.events[0].at <= this.time) this.events.shift().fn();
    const n = Math.max(1, Math.ceil(dt / (1 / 240))), h = dt / n;
    for (let i = 0; i < n; i++) { for (let f = 1; f <= 5; f++) { this.ready[f].step(h); this.pressS[f].step(h); } this.drop.step(h); this.rollS.step(h); }
    if (this.shiftT < 1) this.shiftT = Math.min(1, this.shiftT + dt / this.shiftDur);
    this.apply();
    // colours: next finger pulses red, a strike flashes green (or orange)
    for (let f = 1; f <= 5; f++) {
      const T = this.tint[f], fl = this.flash[f];
      fl.a *= Math.exp(-dt / 0.22);
      const base = f === this.highlighted ? 0.78 + 0.12 * Math.sin(this.time * 5.5) : 0;
      if (fl.a > 0.12) T.set(fl.c.r, fl.c.g, fl.c.b, Math.min(1, fl.a + 0.3)); else if (base > 0) { _v.set(0.784, 0.063, 0.18); T.set(_v.x, _v.y, _v.z, base); } else T.w = 0;
    }
  }
  apply() {
    const P = this.P, B = this.currentBase(), s = clamp(this.shiftT, 0, 1), t = this.time;
    const arc = Math.sin(Math.PI * smoother(s)) * P.shiftLift;
    const breathe = 0.018 * Math.sin(t * 2 * Math.PI * 0.21);
    this.placeHand(B.hand[0], B.hand[1] + arc + breathe - this.drop.x, B.hand[2], this.rollS.x);
    for (let f = 1; f <= 5; f++) {
      const [abd, f1, f2, f3] = B.fingers[f];
      let r = this.ready[f].x + arc * 0.5, p = this.pressS[f].x;
      // neighbours move a little with the striking finger
      for (const g of [f - 1, f + 1]) if (FINGERS[g]) p += 0.12 * this.pressS[g].x;
      const L = f === 1 ? P.thumbLift : P.lift, Q = f === 1 ? P.thumbPress : P.press;
      const drift = 0.5 * Math.sin(t * 1.3 + f * 1.7);
      this.setFinger(f, abd, f1 - r * L[0] + p * Q[0] + drift, f2 - r * L[1] + p * Q[1], f3 - r * L[2] + p * Q[2]);
    }
    this.root.updateMatrixWorld(true);
  }
}

// Skin material with a per-finger tint taken from the _finger attribute (finger number, strength).
// Semi-transparent: keys and labels show through, the finger to play turns nearly opaque. The forearm stub fades out.
function makeSkinMaterial(rig, opacity) {
  const m = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.5, metalness: 0, sheen: 0.55, sheenRoughness: 0.55, sheenColor: new THREE.Color(0xffc7b0), specularIntensity: 0.4, transparent: true, opacity, depthWrite: false });
  m.onBeforeCompile = sh => {
    sh.uniforms.uTint = { value: rig.tint };
    sh.vertexShader = 'attribute vec2 _finger;\nvarying vec2 vFinger;\nvarying float vArm;\n' + sh.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFinger = _finger;')
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\nvArm = transformed.z;');
    sh.fragmentShader = 'uniform vec4 uTint[6];\nvarying vec2 vFinger;\nvarying float vArm;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
      int fi = int(vFinger.x + 0.5);
      vec4 tn = vec4(0.0);
      if (fi == 1) tn = uTint[1]; else if (fi == 2) tn = uTint[2]; else if (fi == 3) tn = uTint[3]; else if (fi == 4) tn = uTint[4]; else if (fi == 5) tn = uTint[5];
      float ta = tn.a * smoothstep(0.15, 0.85, vFinger.y);
      diffuseColor.rgb = mix(diffuseColor.rgb, tn.rgb, ta * 0.85);
      diffuseColor.a = mix(diffuseColor.a, 0.95, ta) * smoothstep(0.075, 0.012, vArm);`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += tn.rgb * ta * 0.4;');
  };
  return m;
}

export class PianoHand {
  static async create(opts) {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 not available');
    const url = opts.glbUrl || new URL('./right-hand.glb', import.meta.url).href;
    const gltf = await new GLTFLoader().loadAsync(url);
    const hand = new PianoHand(opts, gltf.scene, c);
    // draw one frame and make sure every shader compiled, so the caller can fall back if not
    hand.rig.update(0.016); hand.renderer.render(hand.scene, hand.camera);
    const bad = hand.renderer.info.programs.find(p => p.diagnostics && !p.diagnostics.runnable);
    if (bad) { hand.dispose(); throw new Error('shader failed to compile'); }
    return hand;
  }
  constructor({ container, whiteKeys = 12, keyboardHeight, labels = true, pose, shadows = true, maxPixelRatio = 2, keyLength = 6.4, opacity = 0.5 }, model, canvas) {
    this.container = container; this.prefL = keyLength; this.NW = whiteKeys; this.kbH = keyboardHeight || (() => container.clientHeight);
    this.rig = new HandRig(model, pose);
    const mat = makeSkinMaterial(this.rig, opacity);
    const depthMat = new THREE.MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    depthMat.onBeforeCompile = sh => { // depth pre-pass, so only the front surface of the see-through hand is drawn
      sh.vertexShader = 'varying float vArm;\n' + sh.vertexShader.replace('#include <skinning_vertex>', '#include <skinning_vertex>\nvArm = transformed.z;');
      sh.fragmentShader = 'varying float vArm;\n' + sh.fragmentShader.replace('void main() {', 'void main() {\n if (vArm > 0.03) discard;');
    };
    const skinned = []; model.traverse(o => { if (o.isSkinnedMesh) skinned.push(o); });
    for (const o of skinned) {
      o.material = mat; o.castShadow = true; o.frustumCulled = false; o.renderOrder = 2;
      const pre = new THREE.SkinnedMesh(o.geometry, depthMat); pre.bind(o.skeleton, o.bindMatrix); pre.frustumCulled = false; pre.renderOrder = 1;
      o.parent.add(pre);
    }
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPixelRatio));
    r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.NeutralToneMapping; r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = shadows; r.shadowMap.type = THREE.PCFSoftShadowMap;
    canvas.className = 'ph-canvas';
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none',
      maskImage: 'linear-gradient(to bottom,#000 calc(100% - 56px),transparent calc(100% - 6px))', webkitMaskImage: 'linear-gradient(to bottom,#000 calc(100% - 56px),transparent calc(100% - 6px))' });
    container.appendChild(canvas);
    const sc = this.scene = new THREE.Scene();
    sc.add(this.rig.root);
    sc.add(new THREE.HemisphereLight(0xfff4ea, 0x6b5a52, 1.25));
    const key = this.key = new THREE.DirectionalLight(0xffffff, 2.3);
    key.castShadow = shadows; key.shadow.mapSize.set(1024, 1024); key.shadow.radius = 4; key.shadow.bias = -0.0005; key.shadow.normalBias = 0.02;
    const sCam = key.shadow.camera; sCam.left = -9; sCam.right = 9; sCam.top = 9; sCam.bottom = -9; sCam.near = 0.5; sCam.far = 60;
    sc.add(key, key.target);
    const rim = new THREE.DirectionalLight(0xffe2d0, 0.7); rim.position.set(6, 4, -6); sc.add(rim);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShadowMaterial({ opacity: 0.14 }));
    this.ground.rotation.x = -Math.PI / 2; this.ground.receiveShadow = true; sc.add(this.ground);
    try { // soft studio reflections
      import('three/addons/environments/RoomEnvironment.js').then(({ RoomEnvironment }) => {
        const pm = new THREE.PMREMGenerator(r); sc.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; sc.environmentIntensity = 0.45; pm.dispose();
      }).catch(() => {});
    } catch (e) {}
    this.camera = new THREE.OrthographicCamera(0, 1, 0, -1, 0.1, 400);
    this.badges = [];
    if (labels) {
      if (!document.getElementById('ph-style')) {
        const st = document.createElement('style'); st.id = 'ph-style';
        st.textContent = '.ph-badge{position:absolute;left:0;top:0;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;display:grid;place-items:center;background:rgba(20,21,24,.72);color:#fff;font:700 12px/1 system-ui,sans-serif;pointer-events:none;transition:background .15s,color .15s;will-change:transform}.ph-badge.on{background:#fff;color:#c8102e;box-shadow:0 0 0 3px rgba(200,16,46,.55)}';
        document.head.appendChild(st);
      }
      for (let f = 1; f <= 5; f++) { const b = document.createElement('i'); b.className = 'ph-badge'; b.textContent = f; container.appendChild(b); this.badges[f] = b; }
    }
    this.visible = true; this.last = performance.now();
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(container);
    this.resize();
    const loop = now => { this.raf = requestAnimationFrame(loop); this.frame(now); };
    this.raf = requestAnimationFrame(loop);
  }
  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight; if (!w || !h) return;
    const s = w / this.NW, kbH = this.kbH();
    // tilt the view so the HTML keys read as keys about prefL white-key widths long; the key plane lines up exactly
    const tilt = Math.acos(clamp(kbH / (s * this.prefL), 0.5, 0.87)), L = kbH / (s * Math.cos(tilt));
    this.rig.setKeyLength(L); this.L = L; this.s = s;
    const cam = this.camera, d = 60;
    cam.position.set(0, d * Math.cos(tilt), d * Math.sin(tilt)); cam.up.set(0, 1, 0); cam.lookAt(0, 0, 0);
    cam.left = 0; cam.right = this.NW; cam.top = 0; cam.bottom = -h / s; cam.updateProjectionMatrix();
    const cx = this.NW / 2;
    this.key.position.set(cx - 4, 12, L + 6); this.key.target.position.set(cx, 0, L * 0.6);
    this.ground.position.set(cx, 0, L / 2);
    this.renderer.setSize(w, h, false);
    this.dirty = true;
  }
  frame(now) {
    const dt = (now - this.last) / 1000; this.last = now;
    if (!this.visible || document.hidden || !this.container.offsetParent) return;
    this.rig.update(dt);
    this.renderer.render(this.scene, this.camera);
    if (this.badges.length) {
      const w = this.container.clientWidth, h = this.container.clientHeight;
      for (let f = 1; f <= 5; f++) {
        const tip = this.rig.tipWorld(f, _v); tip.y += 1.15; tip.z += 0.15; tip.project(this.camera);
        const b = this.badges[f]; b.style.transform = `translate(${((tip.x + 1) / 2 * w).toFixed(1)}px,${((1 - tip.y) / 2 * h).toFixed(1)}px)`;
        b.classList.toggle('on', f === this.rig.highlighted);
      }
    }
  }
  // Move the canvas and finger numbers into a new container (for pages that rebuild their keyboard).
  attach(container) {
    if (container === this.container) return;
    this.ro.unobserve(this.container); this.container = container;
    container.appendChild(this.renderer.domElement); this.badges.forEach(b => b && container.appendChild(b));
    this.ro.observe(container); this.resize();
  }
  moveTo(anchor, o) { this.rig.moveTo(anchor, o); }
  highlight(f) { this.rig.highlight(f); }
  press(f, o) { this.rig.press(f, o); }
  play(f, o) { this.rig.play(f, o); }
  show() { this.visible = true; this.renderer.domElement.hidden = false; this.badges.forEach(b => b && (b.hidden = false)); }
  hide() { this.visible = false; this.renderer.domElement.hidden = true; this.badges.forEach(b => b && (b.hidden = true)); }
  dispose() { cancelAnimationFrame(this.raf); this.ro.disconnect(); this.renderer.dispose(); this.renderer.domElement.remove(); this.badges.forEach(b => b && b.remove()); }
}
