// 单音钢琴音高 + 起音检测（YIN + 能量起音）。浏览器和 node 测试共用。
function PitchCore(sr, opt) {
  opt = opt || {};
  const fmin = opt.fmin || 90, fmax = opt.fmax || 1300;
  const tauMin = Math.floor(sr / fmax), tauMax = Math.ceil(sr / fmin);
  let refA4 = opt.refA4 || 440;
  let d = null;
  const hist = [];          // 最近帧 rms
  let lastOnset = -1, pending = null, floor = 0.002, cur = null;
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
    cur = midi; stable = { midi, n: 99 };
    emit({ type: 'note', midi, cents: Math.round((avg - midi) * 100), t: p.t, level: p.peak, how: p.how });
  }

  function process(buf, t) {
    let e = 0;
    for (let i = 0; i < buf.length; i++) e += buf[i] * buf[i];
    const rms = Math.sqrt(e / buf.length);
    const past = hist.slice(-6);
    const minPast = past.length ? Math.min.apply(null, past) : rms;
    const prev = past.length ? past[past.length - 1] : rms;
    hist.push(rms); if (hist.length > 40) hist.shift();
    // 安静时慢慢更新底噪
    if (rms < floor * 2.5) floor = floor * 0.95 + rms * 0.05;
    floor = Math.max(floor, 0.0005);
    const gate = floor * 4 + 0.004;

    let onset = false;
    if (rms > gate && rms > prev * 1.12 && rms > minPast * 1.7 && (lastOnset < 0 || t - lastOnset > 0.11)) onset = true;

    const p = rms > gate * 0.6 ? yin(buf) : null;
    const m = p && p.clarity > 0.8 ? toMidi(p.f) : null;

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
    return { rms, gate, f: p ? p.f : 0, clarity: p ? p.clarity : 0, midi: m };
  }

  return {
    process,
    on(fn) { listeners.push(fn); },
    setRef(a) { refA4 = a; },
    get refA4() { return refA4; }
  };
}
if (typeof module !== 'undefined') module.exports = { PitchCore };
