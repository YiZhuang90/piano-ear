// 分辨人声和钢琴：Google 的 YAMNet 声音分类模型（Apache-2.0，见 model/yamnet/NOTICE.md）。
// 每隔约 0.3 秒看最近 0.96 秒的声音，给出“像说话/唱歌”和“像钢琴/键盘”的分数。
// 这里只留了 31 个和判断有关的类别（说话、小孩说话、唱歌、哼歌、口哨……音乐、钢琴、电钢琴、键盘……）。
// 特征（对数梅尔谱）照 YAMNet 原版 features.py 算：16 kHz，25 ms 窗，10 ms 步长，64 个梅尔带，125–7500 Hz。
(function (root) {
  const SR = 16000, WIN = 400, HOP = 160, NFFT = 512, NB = 257, NM = 64, FR = 96, NS = (FR - 1) * HOP + WIN; // 15600
  const NV = 22; // 前 22 类是人声，后 9 类是音乐/键盘（顺序见 model/yamnet/classes.json）
  let MEL = null, HANN = null, COS = null, SIN = null, REV = null;
  function init() {
    if (MEL) return;
    HANN = new Float32Array(WIN); for (let i = 0; i < WIN; i++) HANN[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / WIN);
    const mel = f => 1127 * Math.log(1 + f / 700), lo = mel(125), hi = mel(7500);
    const edges = []; for (let i = 0; i < NM + 2; i++) edges.push(lo + (hi - lo) * i / (NM + 1));
    MEL = new Float32Array(NB * NM);
    for (let b = 1; b < NB; b++) {
      const m = mel(b * (SR / 2) / (NB - 1));
      for (let k = 0; k < NM; k++) {
        const l = (m - edges[k]) / (edges[k + 1] - edges[k]), u = (edges[k + 2] - m) / (edges[k + 2] - edges[k + 1]);
        MEL[b * NM + k] = Math.max(0, Math.min(l, u));
      }
    }
    COS = new Float32Array(NFFT / 2); SIN = new Float32Array(NFFT / 2);
    for (let i = 0; i < NFFT / 2; i++) { COS[i] = Math.cos(2 * Math.PI * i / NFFT); SIN[i] = -Math.sin(2 * Math.PI * i / NFFT); }
    REV = new Uint16Array(NFFT); const bits = Math.log2(NFFT);
    for (let i = 0; i < NFFT; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); REV[i] = r; }
  }
  function fft(re, im) {
    for (let i = 0; i < NFFT; i++) { const j = REV[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= NFFT; size <<= 1) {
      const half = size >> 1, step = NFFT / size;
      for (let s = 0; s < NFFT; s += size) for (let k = 0; k < half; k++) {
        const c = COS[k * step], d = SIN[k * step], a = s + k, b = a + half;
        const tr = re[b] * c - im[b] * d, ti = re[b] * d + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
  // x: 15600 个 16 kHz 采样 → 96×64 对数梅尔谱
  function logmel(x) {
    init();
    const out = new Float32Array(FR * NM), re = new Float32Array(NFFT), im = new Float32Array(NFFT), mag = new Float32Array(NB);
    for (let f = 0; f < FR; f++) {
      re.fill(0); im.fill(0);
      for (let i = 0; i < WIN; i++) re[i] = x[f * HOP + i] * HANN[i];
      fft(re, im);
      for (let b = 0; b < NB; b++) mag[b] = Math.hypot(re[b], im[b]);
      for (let k = 0; k < NM; k++) { let s = 0; for (let b = 1; b < NB; b++) { const w = MEL[b * NM + k]; if (w) s += mag[b] * w; } out[f * NM + k] = Math.log(s + 0.001); }
    }
    return out;
  }
  // 22050 Hz → 16000 Hz（加窗 sinc，截止 7.6 kHz）
  function to16k(x) {
    const r = 22050 / SR, n = Math.floor((x.length - 16) / r), y = new Float32Array(n), fc = 7600 / 22050, H = 8;
    for (let i = 0; i < n; i++) {
      const p = i * r + H, p0 = Math.floor(p); let s = 0, ws = 0;
      for (let k = p0 - H + 1; k <= p0 + H; k++) {
        const d = p - k, w = 0.5 + 0.5 * Math.cos(Math.PI * d / H), h = d === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * d) / (Math.PI * d);
        s += x[k] * h * w; ws += h * w;
      }
      y[i] = s / ws;
    }
    return y;
  }
  // 用模型给一段 22050 Hz 的声音（至少 0.96 秒多一点）的最后 0.975 秒打分
  async function classify(tf, model, x22) {
    const need = Math.ceil(NS * 22050 / SR) + 20;
    const seg = x22.length > need ? x22.subarray(x22.length - need) : x22;
    let y = to16k(seg); if (y.length < NS) { const z = new Float32Array(NS); z.set(y, NS - y.length); y = z; } else y = y.subarray(y.length - NS);
    const t = tf.tensor3d(logmel(y), [1, FR, NM]);
    const r = model.execute(t); const s = await r.data(); t.dispose(); r.dispose();
    let voice = 0, keys = 0; for (let i = 0; i < s.length; i++) { if (i < NV) voice = Math.max(voice, s[i]); else keys = Math.max(keys, s[i]); }
    return { voice, keys, scores: s };
  }
  const api = { logmel, to16k, classify, NS, SR, NV };
  if (typeof module !== 'undefined') module.exports = api; else root.PeVoice = api;
})(typeof window !== 'undefined' ? window : globalThis);
