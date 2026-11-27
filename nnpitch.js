// 多音识别：Spotify Basic Pitch 模型（Apache-2.0，见 model/NOTICE.md）在浏览器里流式运行。
// 每隔约 0.1 秒把最近 2 秒的声音（22050 Hz）送进模型，得到 88 个键每一帧（11.6 毫秒）“正在响”和“刚按下”的概率，
// 再按“这一步该弹哪几个音”打分：该弹的音门槛低，别的音门槛高，泛音和八度混淆不算错。
// NNCore 是纯计算，浏览器和 node 测试共用；NNListener 只在浏览器里用（加载 tfjs、接麦克风、跑模型）。
(function (root) {
  const SR = 22050, HOP = 256, N = 43844, NF = 172, LO = 21;
  const HARM = [12, 19, 24, 28, 31, 36]; // 泛音：高八度、高八度加五度……

  function NNCore(opt) {
    opt = opt || {};
    const K = opt.edge == null ? 6 : opt.edge; // 窗口最后几帧不准，往前取第 K 帧（约 70 毫秒）
    let sens = 0.7, onE, onX, frE, frX, gk, gAbs;
    const expect = new Set();
    let lastT = -1e9;
    const lastEmit = new Float64Array(128).fill(-1e9);
    const listeners = [];
    function setSens(v) {
      sens = Math.max(0, Math.min(1, v));
      onE = 0.62 - 0.38 * sens;   // 该弹的音：起音概率门槛 0.62 → 0.24（默认 0.35）
      onX = 0.8 - 0.25 * sens;    // 别的音：0.80 → 0.55（默认 0.63）
      frE = 0.42 - 0.24 * sens;   // 该弹的音：随后几帧“在响”的概率 0.42 → 0.18（默认 0.25）
      frX = 0.55 - 0.15 * sens;   // 别的音：0.55 → 0.40
      gk = 3.6 - 2 * sens;        // 音量门槛 = 底噪 × gk（默认 2.2，约高出 7 分贝）
      gAbs = 0.002 * Math.pow(10, -2 * sens);
    }
    setSens(opt.sens == null ? 0.7 : opt.sens);

    // fr, on: 172 行 × 88 列（Float32Array 平铺，行优先）。tEnd: 窗口最后一个采样的时间（秒）。
    // level(t): 返回 t 附近 60 毫秒里的 {rms, floor}，用来挡掉安静时模型自己“脑补”出的音。
    function feed(fr, on, tEnd, level) {
      const t0 = tEnd - N / SR, dt = HOP / SR, jEnd = NF - 1 - K;
      let j0 = Math.max(1, Math.floor((lastT - t0) / dt) + 1);
      const out = [];
      for (let j = j0; j <= jEnd; j++) {
        const t = t0 + j * dt;
        if (t <= lastT + 1e-6) continue;
        frame(fr, on, j, t, level, out);
      }
      lastT = Math.max(lastT, t0 + jEnd * dt);
      return out;
    }
    const at = (a, j, k) => a[j * 88 + k];
    function frame(fr, on, j, t, level, out) {
      let cand = null;
      for (let k = 0; k < 88; k++) {
        const o = at(on, j, k);
        if (o < 0.2 || o < at(on, j - 1, k) || o < at(on, j + 1, k)) continue; // 只看起音概率的峰
        const m = k + LO, isE = expect.has(m);
        if (o < (isE ? onE : onX)) continue;
        const f = Math.max(at(fr, j, k), at(fr, j + 1, k), at(fr, j + 2, k));
        if (f < (isE ? frE : frX)) continue;
        if (t - lastEmit[m] < 0.12) continue;
        (cand || (cand = [])).push({ m, o, f, isE, s: o + f, again: t - lastEmit[m] < 0.6 });
      }
      if (!cand) return;
      if (level) {
        // 音量要高出底噪；同一个键刚响过、或不是该弹的音，还要看到音量往上跳（真的又按了一下）
        const L = level(t);
        if (L) {
          if (L.rms < Math.max(gAbs, L.floor * gk)) return;
          const rise = L.rms / Math.max(L.prev, 1e-6);
          cand = cand.filter(c => !(c.again && rise < 1.25 && c.o < 0.85) && (c.isE || rise >= 1.1 || c.o >= 0.85));
          if (!cand.length) return;
        }
      }
      // 泛音、低八度错觉：旁边有更强的音，就当成那个音的泛音
      const strong = k => Math.max(at(fr, j, k), at(fr, j + 1, k), at(fr, j + 2, k));
      const keep = [];
      for (const c of cand) {
        if (!c.isE) {
          let harm = false;
          for (const d of HARM) {
            const b = c.m - d;
            if (b >= LO && (expect.has(b) ? strong(b - LO) >= 0.2 : strong(b - LO) >= Math.max(0.4, c.f * 0.8))) { harm = true; break; }
          }
          const up = c.m + 12; // 低八度错觉
          if (!harm && up < LO + 88 && expect.has(up) && strong(up - LO) >= 0.2) harm = true;
          if (harm) continue;
        }
        keep.push(c);
      }
      keep.sort((a, b) => (b.isE - a.isE) || (b.s - a.s));
      for (const c of keep) {
        lastEmit[c.m] = t;
        const ev = { type: 'note', midi: c.m, t, p: +c.o.toFixed(2), how: 'nn', expected: c.isE };
        out.push(ev);
        listeners.forEach(fn => fn(ev));
      }
    }
    return {
      feed, setSens,
      expect(ms) { expect.clear(); (ms || []).forEach(m => expect.add(m)); },
      on(fn) { listeners.push(fn); },
      reset() { lastT = -1e9; lastEmit.fill(-1e9); },
      get sens() { return sens; }
    };
  }

  // —— 浏览器：加载 tfjs + 模型，接麦克风，流式推理 ——
  const TFV = '4.22.0', CDN = 'https://cdn.jsdelivr.net/npm/@tensorflow/';
  function loadScript(src) {
    return new Promise((ok, bad) => { const s = document.createElement('script'); s.src = src; s.crossOrigin = 'anonymous'; s.onload = ok; s.onerror = () => bad(new Error('加载失败 ' + src.split('/').pop())); document.head.appendChild(s); });
  }
  let tfReady = null;
  function loadTf() {
    if (tfReady) return tfReady;
    tfReady = (async () => {
      if (!root.tf || !root.tf.loadGraphModel) {
        await loadScript(CDN + 'tfjs-core@' + TFV + '/dist/tf-core.min.js');
        await loadScript(CDN + 'tfjs-converter@' + TFV + '/dist/tf-converter.min.js');
        await loadScript(CDN + 'tfjs-backend-webgl@' + TFV + '/dist/tf-backend-webgl.min.js');
      }
      return root.tf;
    })();
    tfReady.catch(() => { tfReady = null; });
    return tfReady;
  }
  async function useWasm(tf) {
    if (!tf.findBackend || !tf.findBackend('wasm')) {
      await loadScript(CDN + 'tfjs-backend-wasm@' + TFV + '/dist/tf-backend-wasm.min.js');
      tf.wasm.setWasmPaths(CDN + 'tfjs-backend-wasm@' + TFV + '/dist/');
    }
    return tf.setBackend('wasm');
  }

  // 采集：AudioWorklet（老浏览器用 ScriptProcessor），带上声音时钟的帧号，好和 ctx.currentTime 对齐
  const WORKLET = `class Tap extends AudioWorkletProcessor{constructor(){super();this.b=new Float32Array(1024);this.n=0}
process(i){const x=i[0]&&i[0][0];if(x){for(let k=0;k<x.length;k++){this.b[this.n++]=x[k];if(this.n===1024){this.port.postMessage({d:this.b,f:currentFrame+k+1});this.b=new Float32Array(1024);this.n=0}}}return true}}
registerProcessor('pe-tap',Tap);`;
  async function tap(ctx, src, onChunk) {
    if (ctx.audioWorklet && root.AudioWorkletNode) {
      try {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
        await ctx.audioWorklet.addModule(url);
        const node = new AudioWorkletNode(ctx, 'pe-tap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
        node.port.onmessage = e => onChunk(e.data.d, e.data.f);
        const g = ctx.createGain(); g.gain.value = 0;
        src.connect(node); node.connect(g); g.connect(ctx.destination);
        return () => { try { src.disconnect(node); node.disconnect(); } catch (e) {} };
      } catch (e) { /* 退回 ScriptProcessor */ }
    }
    const sp = ctx.createScriptProcessor(2048, 1, 1), g = ctx.createGain(); g.gain.value = 0;
    sp.onaudioprocess = e => { const d = e.inputBuffer.getChannelData(0); onChunk(new Float32Array(d), Math.round(e.playbackTime * ctx.sampleRate)); };
    src.connect(sp); sp.connect(g); g.connect(ctx.destination);
    return () => { try { src.disconnect(sp); sp.disconnect(); } catch (e) {} };
  }

  // 重采样到 22050：先低通（Blackman 窗 sinc，截止 9.5 kHz），再线性插值
  function Resampler(inSr) {
    const r = inSr / SR, taps = inSr > 30000 ? 31 : 1, fc = 9500 / inSr, h = new Float32Array(taps);
    if (taps > 1) { let s = 0; for (let i = 0; i < taps; i++) { const n = i - (taps - 1) / 2, w = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / (taps - 1)) + 0.08 * Math.cos(4 * Math.PI * i / (taps - 1)); h[i] = (n === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * n) / (Math.PI * n)) * w; s += h[i]; } for (let i = 0; i < taps; i++) h[i] /= s; } else h[0] = 1;
    const hist = new Float32Array(taps); let hp = 0, pos = 0, prev = 0, cur = 0, inCount = 0;
    return function (x) {
      const out = [];
      for (let i = 0; i < x.length; i++) {
        hist[hp] = x[i]; hp = (hp + 1) % taps;
        let y = 0; for (let k = 0; k < taps; k++) y += h[k] * hist[(hp + k) % taps];
        prev = cur; cur = y; inCount++;
        // 输出样本 n 对应输入位置 n*r；当前输入位置是 inCount-1
        while (pos <= inCount - 1) { const fr = pos - (inCount - 2); out.push(prev + (cur - prev) * Math.max(0, Math.min(1, fr))); pos += r; }
      }
      return out;
    };
  }

  // 自检：喂一段合成的 A4（440 Hz，带泛音），看模型能不能认出来。有的手机显卡精度不够，算出来是乱的，就换别的算法
  async function selfTest(tf, model) {
    const x = new Float32Array(N);
    for (let i = 0; i < N; i++) { const t = i / SR; if (t < 0.3 || t > 1.7) continue;
      let v = 0; for (let h = 1; h <= 5; h++) v += Math.sin(2 * Math.PI * 440 * h * t) / h; x[i] = 0.2 * v * Math.exp(-(t - 0.3) * 1.5); }
    const xt = tf.tensor3d(x, [1, N, 1]); const r = model.execute(xt, ['Identity_1', 'Identity_2']);
    const fr = await r[0].data(); xt.dispose(); r.forEach(z => z.dispose());
    let a = 0, other = 0;
    for (let j = 60; j < 140; j++) for (let k = 0; k < 88; k++) { const v = fr[j * 88 + k]; if (k === 69 - LO) a = Math.max(a, v); else if (k !== 81 - LO && k !== 57 - LO) other = Math.max(other, v); }
    return { a, other, ok: a > 0.4 && other < a * 0.9 };
  }

  // 加载 TensorFlow.js 和模型，挑一个算得对又快的后端（显卡 webgl 优先，不行用 wasm）
  async function probe(modelUrl) {
    const t0 = performance.now(), url = modelUrl || 'model/model.json';
    const tf = await loadTf();
    let okB = false; try { okB = await tf.setBackend('webgl'); await tf.ready(); } catch (e) {}
    if (!okB && !(await useWasm(tf))) throw new Error('没有可用的计算后端');
    let model = await tf.loadGraphModel(url);
    const warm = async () => { const x = tf.zeros([1, N, 1]); const t = performance.now(); const r = model.execute(x, ['Identity_1', 'Identity_2']); await r[0].data(); x.dispose(); r.forEach(z => z.dispose()); return performance.now() - t; };
    await warm(); let ms = await warm();
    let test = await selfTest(tf, model);
    if ((!test.ok || ms > 400) && tf.getBackend() !== 'wasm') {
      const ms1 = ms, test1 = test, b1 = tf.getBackend();
      const back = async () => { await tf.setBackend(b1); model = await tf.loadGraphModel(url); await warm(); ms = ms1; test = test1; };
      try {
        await useWasm(tf); model = await tf.loadGraphModel(url);
        await warm(); ms = await warm(); test = await selfTest(tf, model);
        if (test1.ok && (!test.ok || ms > ms1)) await back();
      } catch (e) { if (test1.ok) await back(); }
    }
    if (!test.ok) throw new Error('模型自检没通过（' + tf.getBackend() + '，' + test.a.toFixed(2) + '/' + test.other.toFixed(2) + '）');
    return { tf, model, warm, stats: { backend: tf.getBackend(), loadMs: Math.round(performance.now() - t0), runMs: ms, test: test.a } };
  }

  // 离线跑一段声音（22050 Hz），和网页里实时一样每 cad 秒算一次。用来在手机上自测
  async function runOffline(p, audio, cad, expectAt, sens) {
    const core = NNCore({ sens: sens == null ? 0.7 : sens }), evs = [], tf = p.tf;
    core.on(e => { evs.push(e); });
    const nh = Math.ceil(audio.length / HOP), r = new Float32Array(nh), fl = new Float32Array(nh); let floor = 0.002;
    for (let h = 0; h < nh; h++) { let a = 0; for (let i = h * HOP; i < Math.min(audio.length, h * HOP + HOP); i++) a += audio[i] * audio[i]; r[h] = Math.sqrt(a / HOP);
      floor = r[h] < floor ? floor * 0.7 + r[h] * 0.3 : (r[h] < floor * 1.15 ? floor * 0.995 + r[h] * 0.005 : floor * 0.9995 + r[h] * 0.0005); fl[h] = floor; }
    let ms = 0, runs = 0;
    for (let tEnd = 0.6; tEnd <= audio.length / SR; tEnd += cad) {
      const e = Math.round(tEnd * SR), win = new Float32Array(N);
      const a0 = Math.max(0, e - N); win.set(audio.subarray(a0, e), N - (e - a0));
      if (expectAt) core.expect(expectAt(tEnd));
      const t1 = performance.now(), x = tf.tensor3d(win, [1, N, 1]), out = p.model.execute(x, ['Identity_1', 'Identity_2']);
      const [fr, on] = await Promise.all([out[0].data(), out[1].data()]); x.dispose(); out.forEach(z => z.dispose());
      ms += performance.now() - t1; runs++;
      const eh = Math.floor(e / HOP) - 1;
      core.feed(fr, on, tEnd, t => { const n = Math.round(t * SR / HOP); let mx = 0, pv = 0, pn = 0;
        for (let i = n; i < n + 6 && i <= eh; i++) if (i >= 0) mx = Math.max(mx, r[i]);
        for (let i = n - 6; i < n - 1; i++) if (i >= 0) { pv += r[i]; pn++; }
        return { rms: mx, prev: pn ? pv / pn : 0, floor: fl[Math.max(0, Math.min(eh, nh - 1))] }; });
    }
    return { evs, runMs: ms / runs };
  }
  // 合成一个像钢琴的音（几条泛音，快起慢衰）
  function synth(len, notes) {
    const a = new Float32Array(Math.round(len * SR));
    notes.forEach(({ m, t, g }) => { const f = 440 * Math.pow(2, (m - 69) / 12), i0 = Math.round(t * SR);
      for (let i = i0; i < a.length && i < i0 + 1.5 * SR; i++) { const u = (i - i0) / SR; let v = 0;
        for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * f * h * u * (1 + 0.0004 * h * h)) * Math.exp(-u * (1.2 + h * 0.8)) / h;
        a[i] += g * v * Math.min(1, u * 400); } });
    for (let i = 0; i < a.length; i++) a[i] += (Math.random() - 0.5) * 0.004;
    return a;
  }

  function NNListener(ctx, src, opt) {
    opt = opt || {};
    const core = NNCore({ sens: opt.sens, edge: opt.edge });
    const ring = new Float32Array(N); let total = 0, lastRun = 0, running = false, stopTap = null, model = null, tf = null;
    const rmsHop = new Float32Array(512); let floor = 0.002; // 每 256 个采样的音量，环形
    let hopAcc = 0, hopN = 0;
    let frameAt = 0; // 最新采样对应的声音时钟（秒）
    const stats = { backend: '', loadMs: 0, runMs: 0, runs: 0, slow: 0 };
    const rs = Resampler(ctx.sampleRate);
    function level(t) {
      const n = Math.round((t - (frameAt - total / SR)) * SR / HOP); // 第几个 hop
      const ok = i => i >= 0 && i < total / HOP && total / HOP - i < 512;
      let mx = 0, pv = 0, pn = 0;
      for (let i = n; i < n + 6; i++) if (ok(i)) mx = Math.max(mx, rmsHop[i % 512]);
      for (let i = n - 6; i < n - 1; i++) if (ok(i)) { pv += rmsHop[i % 512]; pn++; }
      return { rms: mx, prev: pn ? pv / pn : 0, floor };
    }
    function push(x, endFrame) {
      const y = rs(x);
      for (let i = 0; i < y.length; i++) {
        const v = y[i]; ring[total % N] = v; total++;
        hopAcc += v * v; hopN++;
        if (hopN === HOP) {
          const r = Math.sqrt(hopAcc / HOP), idx = total / HOP - 1;
          rmsHop[idx % 512] = r; hopAcc = 0; hopN = 0;
          floor = r < floor ? floor * 0.7 + r * 0.3 : (r < floor * 1.15 ? floor * 0.995 + r * 0.005 : floor * 0.9995 + r * 0.0005);
        }
      }
      frameAt = endFrame / ctx.sampleRate;
    }
    async function loop() {
      while (running) {
        if (total - lastRun < HOP * 4 || total < N / 2) { await new Promise(r => setTimeout(r, 20)); continue; }
        lastRun = total;
        const tEnd = frameAt, win = new Float32Array(N), s = total % N;
        win.set(ring.subarray(s), 0); win.set(ring.subarray(0, s), N - s);
        const t1 = performance.now();
        let fr, on;
        try {
          const x = tf.tensor3d(win, [1, N, 1]);
          const r = model.execute(x, ['Identity_1', 'Identity_2']);
          [fr, on] = await Promise.all([r[0].data(), r[1].data()]);
          x.dispose(); r.forEach(t => t.dispose());
        } catch (e) { running = false; opt.onFail && opt.onFail('模型运行出错：' + e.message); return; }
        const ms = performance.now() - t1;
        stats.runMs = stats.runs ? stats.runMs * 0.8 + ms * 0.2 : ms; stats.runs++;
        if (stats.runMs > 450 && stats.runs > 5) { stats.slow++; if (stats.slow > 10) { running = false; opt.onFail && opt.onFail('手机算得太慢（每次约 ' + Math.round(stats.runMs) + ' 毫秒）'); return; } } else stats.slow = 0;
        core.feed(fr, on, tEnd, level);
        await new Promise(r => setTimeout(r, Math.max(0, 70 - ms)));
      }
    }
    async function start() {
      const p = await probe(opt.modelUrl);
      tf = p.tf; model = p.model; Object.assign(stats, p.stats);
      if (stats.runMs > 700) throw new Error('手机算得太慢（每次约 ' + Math.round(stats.runMs) + ' 毫秒）');
      stopTap = await tap(ctx, src, push);
      running = true; loop();
    }
    return {
      start, core, stats,
      stop() { running = false; if (stopTap) stopTap(); },
      expect: ms => core.expect(ms), setSens: v => core.setSens(v), on: fn => core.on(fn),
      get running() { return running; }
    };
  }

  const api = { NNCore, NNListener, selfTest, probe, runOffline, synth, SR, HOP, N, NF };
  if (typeof module !== 'undefined') module.exports = api; else root.PeNN = api;
})(typeof window !== 'undefined' ? window : globalThis);
