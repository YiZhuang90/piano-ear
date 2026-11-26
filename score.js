// 乐谱读取：MusicXML -> 音符事件；课程音符 -> 一步一步的“要弹的音”。浏览器和 node 测试共用。
// 时间单位都是四分音符（拍）。反复记号不展开，按谱面顺序弹一遍。
(function (root) {
  const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const WHITE = [0, 2, 4, 5, 7, 9, 11];
  const isWhite = m => WHITE.includes(((m % 12) + 12) % 12);
  // 白键编号：C4 = 28（C0 = 0），黑键算左边那个白键
  const whiteNo = m => { const o = Math.floor(m / 12), p = ((m % 12) + 12) % 12; let i = WHITE.indexOf(p); if (i < 0) i = WHITE.indexOf(p - 1); return o * 7 + i; };
  const whiteMidi = w => Math.floor(w / 7) * 12 + WHITE[((w % 7) + 7) % 7];

  function kids(el, name) { const out = []; for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (c.tagName === name) out.push(c); return out; }
  function kid(el, name) { for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (c.tagName === name) return c; return null; }
  const txt = (el, name, d) => { const k = el && kid(el, name); return k ? k.textContent.trim() : d; };

  function parseMusicXML(xml, DP) {
    const doc = new (DP || root.DOMParser)().parseFromString(xml, 'application/xml');
    const sp = doc.getElementsByTagName('score-partwise')[0];
    if (!sp) throw new Error('不是 MusicXML（score-partwise）');
    const title = txt(kid(sp, 'work') || sp, 'work-title', '') || txt(sp, 'movement-title', '');
    const out = { title, tempo: 0, measures: [], notes: [], words: [] };
    const parts = kids(sp, 'part');
    parts.forEach((part, pi) => {
      let div = 1, t = 0, beats = 4, beatType = 4, lastStart = 0;
      const open = {}; // 连音线：key -> 上一个音
      kids(part, 'measure').forEach((ms, mi) => {
        const n = +ms.getAttribute('number') || mi + 1;
        let pos = 0, maxPos = 0;
        for (let el = ms.firstElementChild; el; el = el.nextElementSibling) {
          const tag = el.tagName;
          if (tag === 'attributes') {
            const d = txt(el, 'divisions'); if (d) div = +d;
            const tm = kid(el, 'time'); if (tm) { beats = +txt(tm, 'beats', beats); beatType = +txt(tm, 'beat-type', beatType); }
          } else if (tag === 'direction') {
            el.querySelectorAll('words').forEach(w => { if (pi === 0 && w.textContent.trim()) out.words.push({ measure: n, text: w.textContent.trim() }); });
            const snd = kid(el, 'sound'); if (snd && snd.getAttribute('tempo') && !out.tempo) out.tempo = +snd.getAttribute('tempo');
          } else if (tag === 'sound' && el.getAttribute('tempo') && !out.tempo) out.tempo = +el.getAttribute('tempo');
          else if (tag === 'backup') pos -= +txt(el, 'duration', 0);
          else if (tag === 'forward') { pos += +txt(el, 'duration', 0); maxPos = Math.max(maxPos, pos); }
          else if (tag === 'note') {
            if (kid(el, 'grace')) continue;
            const dur = +txt(el, 'duration', 0), chord = !!kid(el, 'chord');
            const start = chord ? lastStart : pos;
            if (!chord) { lastStart = pos; pos += dur; maxPos = Math.max(maxPos, pos); }
            if (kid(el, 'rest')) continue;
            const p = kid(el, 'pitch'); if (!p) continue;
            const m = 12 * (+txt(p, 'octave') + 1) + STEP[txt(p, 'step')] + (+txt(p, 'alter', 0) || 0);
            const staff = +txt(el, 'staff', 1), voice = txt(el, 'voice', '1');
            const ties = el.querySelectorAll('tie');
            let tStart = false, tStop = false; ties.forEach(x => { if (x.getAttribute('type') === 'start') tStart = true; if (x.getAttribute('type') === 'stop') tStop = true; });
            const fg = el.querySelector('technical fingering');
            const key = pi + ':' + staff + ':' + m;
            if (tStop && open[key]) { open[key].d += dur / div; if (!tStart) delete open[key]; continue; }
            const ev = { m, t: t + start / div, d: dur / div, staff, voice, part: pi, measure: n };
            if (fg && +fg.textContent) ev.f = +fg.textContent;
            out.notes.push(ev);
            if (tStart) open[key] = ev;
          }
        }
        const nominal = beats * 4 / beatType, len = Math.max(maxPos / div, 0) || nominal;
        if (pi === 0) out.measures.push({ n, t, len, beats, beatType });
        t += len;
      });
    });
    out.notes.sort((a, b) => a.t - b.t || a.m - b.m);
    out.notes.forEach(e => { e.t = Math.round(e.t * 1000) / 1000; e.d = Math.round(e.d * 1000) / 1000; });
    return out;
  }

  // 指法：每只手按五指位走。一段音能放进 5 个白键就不挪手；放不下就换一个手位。
  // 优先 C 位、G 位（拇指或小指在 C/G 上）；右手拇指在最低音，左手拇指在最高音。
  function assignFingers(notes, hand) {
    const ws = notes.map(n => whiteNo(n.m));
    let i = 0, prev = null;
    while (i < notes.length) {
      let lo = ws[i], hi = ws[i], j = i + 1;
      while (j < notes.length && Math.max(hi, ws[j]) - Math.min(lo, ws[j]) <= 4) { lo = Math.min(lo, ws[j]); hi = Math.max(hi, ws[j]); j++; }
      const cands = []; for (let b = hi - 4; b <= lo; b++) cands.push(b);
      const pref = b => (b % 7 === 0 ? 0 : b % 7 === 4 ? 1 : 2); // 先 C 位，再 G 位
      const near = b => prev === null ? (hand === 'L' ? hi - b : b - lo) : Math.abs(b - prev);
      cands.sort((a, b) => (prev !== null && a === prev ? -1 : prev !== null && b === prev ? 1 : 0) || pref(a) - pref(b) || near(a) - near(b));
      const base = cands[0];
      for (let k = i; k < j; k++) {
        if (!notes[k].f) notes[k].f = hand === 'L' ? 5 - (ws[k] - base) : ws[k] - base + 1;
        notes[k].base = base; // 这个手位最左边的白键（右手拇指 / 左手小指）
      }
      prev = base; i = j;
    }
    return notes;
  }

  // 课程 -> 一步一步。hands: 要学生弹的手 'R' 'L' 或 'RL'；另一只手的音放进 auto（网页替你弹）。
  function buildSteps(events, { from, to, hands }) {
    const inRange = e => (from == null || e.measure >= from) && (to == null || e.measure <= to);
    const ev = events.filter(inRange);
    const play = [], auto = [];
    ev.forEach(e => (hands.includes(e.hand) ? play : auto).push(e));
    const steps = [];
    play.forEach(e => {
      const last = steps[steps.length - 1];
      if (last && Math.abs(last.t - e.t) < 1e-6) last.notes.push(e);
      else steps.push({ t: e.t, notes: [e], measure: e.measure });
    });
    steps.forEach((s, i) => { s.d = i + 1 < steps.length ? steps[i + 1].t - s.t : Math.max(...s.notes.map(n => n.d)); });
    return { steps, auto, t0: ev.length ? Math.min(...ev.map(e => e.t)) : 0 };
  }

  // 给只有学生声部的曲子配一个简单伴奏（不是拜厄原书的老师声部）：每小节选 I / IV / V7，低音 + 和弦
  function simpleAccomp(events, measures) {
    const CH = [{ root: 48, pcs: [0, 4, 7], up: [52, 55] }, { root: 43, pcs: [7, 11, 2, 5], up: [53, 59] }, { root: 41, pcs: [5, 9, 0], up: [53, 57] }];
    const out = [];
    measures.forEach(ms => {
      const inM = events.filter(e => e.t >= ms.t - 1e-6 && e.t < ms.t + ms.len - 1e-6);
      if (!inM.length) return;
      let best = CH[0], bs = -1;
      CH.forEach((c, ci) => {
        let s = 0; inM.forEach(e => { if (c.pcs.includes(((e.m % 12) + 12) % 12)) s += e.d * (Math.abs(e.t - ms.t) < 1e-6 ? 2 : 1); });
        s -= ci * 0.01; if (s > bs) { bs = s; best = c; }
      });
      const beat = ms.beatType === 8 ? 1.5 : 1, nb = Math.max(1, Math.round(ms.len / beat));
      for (let k = 0; k < nb; k++) {
        const tt = ms.t + k * beat;
        if (k === 0) out.push({ m: best.root, t: tt, d: beat * 0.95, hand: 'A', measure: ms.n });
        else best.up.forEach(m => out.push({ m, t: tt, d: beat * 0.8, hand: 'A', measure: ms.n, soft: true }));
      }
    });
    return out;
  }

  const api = { parseMusicXML, assignFingers, buildSteps, simpleAccomp, whiteNo, whiteMidi, isWhite };
  if (typeof module !== 'undefined') module.exports = api; else root.Score = api;
})(typeof window !== 'undefined' ? window : globalThis);
