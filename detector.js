// 单音钢琴音高 + 起音检测（YIN + 能量起音）。浏览器和 node 测试共用。
function PitchCore(sr, opt) {
  opt = opt || {};
  const fmin = opt.fmin || 90, fmax = opt.fmax || 1300;
  const tauMin = Math.floor(sr / fmax), tauMax = Math.ceil(sr / fmin);
  let refA4 = opt.refA4 || 440;
  // 灵敏度 0–1：越高，越轻的声音也算。门限 = 底噪 × K + 绝对下限；音高置信度也随之放宽。
  let sens = opt.sens == null ? 0.7 : opt.sens, K, absGate, clar;
  function setSens(v) {
    sens = Math.max(0, Math.min(1, v));
    K = 4 - 2.6 * sens;                          // 4 → 1.4（起音还要能量突涨、音高稳定，噪声过不了）
    absGate = 0.004 * Math.pow(10, -2.2 * sens); // 0.004 → 0.000025（旧版固定 0.004）
    clar = 0.8 - 0.08 * sens;                    // 0.80 → 0.72
  }
  setSens(sens);
  let d = null;
  const hist = [];          // 最近帧 rms
  let lastOnset = -1, pending = null, floor = 0.002, cur = null, riseAt = -1, last = null;
  let stable = { midi: -1, n: 0 };
  const listeners = [];

  function yin(buf) {
    const N = buf.length, W = Math.min(N - tauMax - 1, 1024);
    if (W < 256) return null;
    if (!d || d.length < tauMax + 2) d = new Float32Array(tauMax + 2);
    let run = 0; d[0] = 1;
    for (let tau = 1; tau <= tauMax; tau++) {
      let s = 0;
      for (let i = 0; i < W; i++) { const x = buf[i] - buf[i + tau]; s += x * x; }
      run += s;
      d[tau] = run > 0 ? s * tau / run : 1;
    }
    let tau = -1;
    for (let t = tauMin; t <= tauMax; t++) {
      if (d[t] < 0.15) { while (t + 1 <= tauMax && d[t + 1] < d[t]) t++; tau = t; break; }
    }
    if (tau < 0) { // 没过阈值：取全局最小，低置信度
      let best = 1;
      for (let t = tauMin; t <= tauMax; t++) if (d[t] < best) { best = d[t]; tau = t; }
      if (best > 0.35) return null;
    }
    const a = d[tau - 1], b = d[tau], c = tau + 1 <= tauMax ? d[tau + 1] : b;
    const den = a + c - 2 * b;
    const shift = den !== 0 ? 0.5 * (a - c) / den : 0;
    return { f: sr / (tau + shift), clarity: 1 - b };
  }

  // 110 Hz 高通（两级），去掉电源嗡声、空调和碰桌子的低频；最低的键 F3 是 175 Hz，不受影响
  const hp = (() => {
    const w = 2 * Math.PI * 110 / sr, q = Math.SQRT1_2, al = Math.sin(w) / (2 * q), cw = Math.cos(w), a0 = 1 + al;
    return { b0: (1 + cw) / 2 / a0, b1: -(1 + cw) / a0, b2: (1 + cw) / 2 / a0, a1: -2 * cw / a0, a2: (1 - al) / a0 };
  })();
  let fb = null;
  function highpass(buf) {
    if (!fb || fb.length !== buf.length) fb = new Float32Array(buf.length);
    fb.set(buf);
    for (let pass = 0; pass < 2; pass++) {
      let x1 = fb[0], x2 = fb[0], y1 = 0, y2 = 0;
      for (let i = 0; i < fb.length; i++) {
        const x = fb[i], y = hp.b0 * x + hp.b1 * x1 + hp.b2 * x2 - hp.a1 * y1 - hp.a2 * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = y; fb[i] = y;
      }
    }
    return fb;
  }

  function toMidi(f) { return 69 + 12 * Math.log2(f / refA4); }

  function emit(ev) { listeners.forEach(fn => fn(ev)); }

  function finish() {
    const p = pending; pending = null;
    if (!p || p.est.length < 2) return;
    const m = p.est.map(e => e.m).sort((x, y) => x - y);
    const med = m[Math.floor(m.length / 2)];
    const near = m.filter(x => Math.abs(x - med) < 0.5);
    if (near.length < Math.max(2, m.length * 0.5)) return;
    const avg = near.reduce((s, x) => s + x, 0) / near.length;
    const midi = Math.round(avg);
    // 同一个音 0.2 秒内又“起音”一次、而且没更响：是回声或琴体余振，不算新的一下
    if (last && midi === last.midi && p.t - last.t < 0.2 && p.peak < last.peak * 1.3) return;
    last = { midi, t: p.t, peak: p.peak };
    cur = midi; stable = { midi, n: 99 };
    emit({ type: 'note', midi, cents: Math.round((avg - midi) * 100), t: p.t, level: p.peak, how: p.how });
  }

  function process(raw, t) {
    const full = highpass(raw);
    const buf = full.subarray(96); // 去掉滤波器起步那几毫秒
    let e = 0;
    for (let i = 0; i < buf.length; i++) e += buf[i] * buf[i];
    const rms = Math.sqrt(e / buf.length);
    const past = hist.slice(-6);
    const minPast = past.length ? Math.min.apply(null, past) : rms;
    const prev = past.length ? past[past.length - 1] : rms;
    hist.push(rms); if (hist.length > 40) hist.shift();
    // 底噪：比底噪还安静就较快往下跟；只略高一点就很慢往上跟（琴音的余音不会把底噪抬高）
    if (rms < floor) floor = floor * 0.7 + rms * 0.3;
    else if (rms < floor * 1.15) floor = floor * 0.995 + rms * 0.005;
    floor = Math.max(floor, 0.00005);
    const gate = floor * K + absGate;

    let onset = false;
    // 能量在涨：记下来。轻声的起音会摊在两三帧里，涨的那帧可能还没过门限，所以 60 毫秒内过门限都算
    if (rms > prev * 1.12 && rms > minPast * 1.7) riseAt = t;
    if (rms > gate && riseAt >= 0 && t - riseAt < 0.06 && (lastOnset < 0 || t - lastOnset > 0.11)) { onset = true; riseAt = -1; }

    const p = rms > gate * 0.6 ? yin(buf) : null;
    const m = p && p.clarity > clar ? toMidi(p.f) : null;

    if (onset) {
      if (pending) finish();
      lastOnset = t;
      pending = { t, est: [], peak: rms, how: 'onset' };
      stable = { midi: -1, n: 0 };
    }
    if (pending) {
      pending.peak = Math.max(pending.peak, rms);
      const age = t - pending.t;
      if (m !== null && age >= 0.025) pending.est.push({ m });
      if (age > 0.13 || pending.est.length >= 6) finish();
    } else if (m !== null && rms > gate) {
      // 连奏：能量没明显跳，但出现了持续的新音高
      const r = Math.round(m);
      if (Math.abs(m - r) < 0.35 && r !== cur) {
        if (r === stable.midi) stable.n++; else stable = { midi: r, n: 1 };
        if (stable.n >= 4 && t - lastOnset > 0.15) {
          lastOnset = t; cur = r;
          emit({ type: 'note', midi: r, cents: Math.round((m - r) * 100), t, level: rms, how: 'legato' });
        }
      } else if (r === cur) stable = { midi: -1, n: 0 };
    }
    if (rms < gate * 0.5) { cur = null; stable = { midi: -1, n: 0 }; }
    return { rms, gate, floor, f: p ? p.f : 0, clarity: p ? p.clarity : 0, midi: m };
  }

  return {
    process,
    on(fn) { listeners.push(fn); },
    setRef(a) { refA4 = a; },
    setSens,
    get sens() { return sens; },
    get refA4() { return refA4; }
  };
}
if (typeof module !== 'undefined') module.exports = { PitchCore };
