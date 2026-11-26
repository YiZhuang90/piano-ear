// 用合成钢琴音（谐波 + 非谐性 + 衰减 + 击弦噪声 + 混响 + 底噪）离线测试 detector.js
const { PitchCore } = require('./detector.js');
const SR = 48000;
let seed = 12345; const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;

function synth(notes, total, o) {
  const out = new Float32Array(Math.ceil(total * SR));
  for (const n of notes) {
    const f0 = 440 * 2 ** ((n.midi - 69 + (o.detune || 0) / 100) / 12);
    const B = 0.0004, vel = n.vel;
    const start = Math.floor(n.t * SR), end = Math.min(out.length, Math.floor((n.t + n.dur + 0.06) * SR));
    const parts = [];
    for (let k = 1; k <= 12; k++) {
      const fk = k * f0 * Math.sqrt(1 + B * k * k);
      if (fk > SR / 2.2) break;
      let amp = (k === 1 ? (o.weakFund ? 0.35 : 1) : 1 / k ** 1.1) * (0.7 + 0.6 * rnd());
      parts.push({ w: 2 * Math.PI * fk / SR, amp, dec: 1.2 + 0.6 * k + f0 / 400, ph: rnd() * 6.28 });
    }
    for (let i = start; i < end; i++) {
      const tt = (i - start) / SR;
      const att = Math.min(1, tt / 0.004);
      let damp = 1;
      if (tt > n.dur) damp = Math.exp(-(tt - n.dur) / 0.015); // 制音器
      let s = 0;
      for (const p of parts) s += p.amp * Math.exp(-p.dec * tt) * Math.sin(p.w * (i - start) + p.ph);
      if (tt < 0.012) s += (rnd() - 0.5) * 0.6 * (1 - tt / 0.012); // 击弦噪声
      out[i] += 0.15 * vel * att * damp * s;
    }
  }
  if (o.reverb) { // 简单梳状混响
    const ds = [0.031, 0.047, 0.061].map(x => Math.floor(x * SR));
    for (let i = 0; i < out.length; i++) for (const dd of ds) if (i >= dd) out[i] += out[i - dd] * 0.25;
  }
  for (let i = 0; i < out.length; i++) out[i] += (rnd() - 0.5) * (o.noise || 0.002);
  return out;
}

const SONGS = {
  twinkle: [60,60,67,67,69,69,67,65,65,64,64,62,62,60],
  ode: [64,64,65,67,67,65,64,62,60,60,62,64,64,62,62],
  tigers: [60,62,64,60,60,62,64,60,64,65,67,64,65,67,67,69,67,65,64,60,60,55,60],
  scale: [55,57,59,60,62,64,65,67,69,71,72],
  chromatic: [60,61,62,63,64,65,66,67,68,69,70,71,72],
  wide: [48,52,55,60,64,67,72,76,79,84],
  repeat: [60,60,60,60,64,64,64,64,67,67,67,67]
};

function run(name, o) {
  const seq = SONGS[o.song]; const beat = o.beat || 0.5;
  let t = 0.4; const notes = [];
  for (const m of seq) {
    const vel = o.soft ? 0.12 : o.velVar ? 0.35 + 0.65 * rnd() : 0.8;
    const jitter = o.jitter ? (rnd() - 0.5) * 0.06 : 0;
    notes.push({ midi: m, t: t + jitter, dur: beat * (o.legato ? 1.05 : 0.85), vel });
    t += beat * (o.pause && rnd() < 0.3 ? 2 : 1);
  }
  const audio = synth(notes, t + 1, o);
  const det = PitchCore(SR, { refA4: o.refA4 || 440 });
  const got = []; det.on(e => got.push(e));
  const N = 2048, H = o.hop || 800;
  for (let i = 0; i + N <= audio.length; i += H) det.process(audio.subarray(i, i + N), (i + N) / SR);
  // 匹配：按顺序对齐，每个真音在 [t-0.02, t+0.25] 内找第一个检测
  let used = new Set(), hit = 0, wrong = 0, lat = [];
  for (const n of notes) {
    const k = got.findIndex((g, j) => !used.has(j) && g.t >= n.t - 0.02 && g.t <= n.t + 0.25);
    if (k >= 0) { used.add(k); if (got[k].midi === n.midi) { hit++; lat.push(got[k].t - n.t); } else wrong++; }
  }
  const extra = got.length - used.size;
  const ml = lat.length ? (lat.reduce((a, b) => a + b, 0) / lat.length * 1000).toFixed(0) : '-';
  const ok = hit === notes.length && extra === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name.padEnd(34)} 对 ${hit}/${notes.length} 错音 ${wrong} 多出 ${extra} 起音延迟 ${ml}ms`);
  if (!ok && process.env.V) console.log(' 真:', notes.map(n => n.midi + '@' + n.t.toFixed(2)).join(' '), '\n 测:', got.map(g => g.midi + '@' + g.t.toFixed(2) + g.how[0]).join(' '));
  return ok;
}

const cases = [
  ['小星星 标准', { song: 'twinkle' }],
  ['小星星 快 (0.3s/音)', { song: 'twinkle', beat: 0.3 }],
  ['小星星 连奏', { song: 'twinkle', legato: true }],
  ['欢乐颂 力度不均+抖动', { song: 'ode', velVar: true, jitter: true }],
  ['两只老虎 含 G3', { song: 'tigers' }],
  ['两只老虎 混响+噪声', { song: 'tigers', reverb: true, noise: 0.01 }],
  ['音阶 G3–C5 基频弱', { song: 'scale', weakFund: true }],
  ['半音阶 偏高 +30 音分', { song: 'chromatic', detune: 30 }],
  ['半音阶 偏高+30 校准后', { song: 'chromatic', detune: 30, refA4: 440 * 2 ** (30 / 1200) }],
  ['欢乐颂 30fps 帧率', { song: 'ode', hop: 1600 }],
  ['小星星 有停顿', { song: 'twinkle', pause: true }],
  ['很轻地弹 (力度 0.12)', { song: 'ode', soft: true }],
  ['大底噪 (噪声 0.03)', { song: 'tigers', noise: 0.03 }],
  ['宽音域 C3–C6', { song: 'wide' }],
  ['同音快速连击 0.25s', { song: 'repeat', beat: 0.25 }],
  ['同音连击+混响+力度不均', { song: 'repeat', beat: 0.3, reverb: true, velVar: true }],
];
// 误报测试：拍手/噪声爆发，不应出音
{
  const a = new Float32Array(SR * 3);
  for (let i = 0; i < a.length; i++) a[i] = (rnd() - 0.5) * 0.004;
  for (const c of [0.5, 1.2, 2.0]) for (let i = 0; i < 0.04 * SR; i++) a[Math.floor(c * SR) + i] += (rnd() - 0.5) * 0.8 * Math.exp(-i / (0.01 * SR));
  const det = PitchCore(SR); let n = 0; det.on(() => n++);
  for (let i = 0; i + 2048 <= a.length; i += 800) det.process(a.subarray(i, i + 2048), (i + 2048) / SR);
  console.log((n === 0 ? 'PASS' : 'FAIL') + ' 拍手三次（不应识别出音）'.padEnd(36) + ' 误报 ' + n);
}
let pass = 0;
for (const [n, o] of cases) if (run(n, o)) pass++;
console.log(`\n${pass}/${cases.length} 通过`);
