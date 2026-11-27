// 认谱入门：用小曲子在真琴上认音符。浏览器和 node 测试共用。
// 五线谱用 VexFlow 4.2.3（MIT，https://github.com/0xfe/vexflow），从 jsDelivr 加载；加载不了就用这里自己画的简单五线谱。
// 复习用“记忆盒子”（Leitner 盒子，公开的记忆方法）：每个音一个盒子号 0–4，第一次就弹对升一格，弹错回到 0。
// 盒子号到 2，这个音就不再在琴键上亮出来，要自己看谱找；弹错一次马上亮出来。
(function (root) {
  const WHITE = [0, 2, 4, 5, 7, 9, 11];
  const whiteNo = m => { const o = Math.floor(m / 12), p = ((m % 12) + 12) % 12; let i = WHITE.indexOf(p); if (i < 0) i = WHITE.indexOf(p - 1); return o * 7 + i; };
  const LETTER = { 0: 'c', 2: 'd', 4: 'e', 5: 'f', 7: 'g', 9: 'a', 11: 'b' };
  const vfKey = m => LETTER[((m % 12) + 12) % 12] + '/' + (Math.floor(m / 12) - 1);
  const DUR = { 4: 'w', 3: 'hd', 2: 'h', 1.5: 'qd', 1: 'q', 0.5: '8' };
  const BOTTOM = { treble: whiteNo(64), bass: whiteNo(43) }; // 最下面一条线：高音谱号 E4，低音谱号 G2
  const posOf = (m, clef) => whiteNo(m) - BOTTOM[clef || 'treble']; // 0 = 第 1 线，1 = 第 1 间，-2 = 下加一线
  const CN = ['一', '二', '三', '四'];

  // 音在谱上的位置：“第 2 线上”“第 3 间”“下加一线上”
  function where(m, clef) {
    const p = posOf(m, clef);
    if (p >= 0 && p <= 8) return p % 2 === 0 ? `第 ${p / 2 + 1} 线上` : `第 ${(p + 1) / 2} 间`;
    if (p === -1) return '第 1 线下面';
    if (p === 9) return '第 5 线上面';
    if (p < -1) { const k = Math.floor(-p / 2); return -p % 2 === 0 ? `下加${CN[k - 1] || k}线上` : `下加${CN[k - 1] || k}线下面`; }
    const k = Math.floor((p - 8) / 2); return (p - 8) % 2 === 0 ? `上加${CN[k - 1] || k}线上` : `上加${CN[k - 1] || k}线上面`;
  }
  // 两个音在谱上差几格（一格 = 线到相邻的间）
  const stepsBetween = (a, b, clef) => posOf(b, clef) - posOf(a, clef);

  // —— 记忆盒子 ——
  const KEY = 'pianoEarRead1';
  const boxKey = (m, clef) => (clef || 'treble') + ':' + m;
  function load() { try { return JSON.parse(root.localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
  function save(b) { try { root.localStorage.setItem(KEY, JSON.stringify(b)); } catch (e) {} }
  const boxOf = (b, n) => b[boxKey(n.m, n.clef)] || 0;
  function record(b, n, ok) { const k = boxKey(n.m, n.clef); b[k] = ok ? Math.min(4, (b[k] || 0) + 1) : 0; }
  // 这个音要不要在琴键上亮出来
  function shown(ls, b, n, triedWrong) {
    if (triedWrong) return true;
    if (ls.show === 'key') return true;
    if (ls.show === 'none') return false;
    return boxOf(b, n) < 2; // fade
  }
  // 每日复习：挑一首“最没记牢的音”最多的小曲
  function pickReview(lessons, b, parse) {
    let best = null, bestScore = -1;
    lessons.forEach(ls => {
      const ns = parse(ls.jianpu); let s = 0, seen = 0;
      ns.forEach(n => { const k = boxKey(n.m, ls.clef); if (k in b) { seen++; s += 4 - b[k]; } });
      if (!seen) return;
      s = s / ns.length + Math.random() * 0.3;
      if (s > bestScore) { bestScore = s; best = ls; }
    });
    return best;
  }

  // —— 画谱 ——
  let vfLoad = null;
  function loadVF() {
    if (root.Vex && root.Vex.Flow) return Promise.resolve(root.Vex.Flow);
    if (!vfLoad) vfLoad = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/vexflow@4.2.3/build/cjs/vexflow-bravura.js';
      s.onload = () => root.Vex && root.Vex.Flow ? res(root.Vex.Flow) : rej(new Error('VexFlow 没有加载'));
      s.onerror = () => { vfLoad = null; rej(new Error('VexFlow 加载不了')); };
      document.head.appendChild(s);
    });
    return vfLoad;
  }
  const RED = '#c8102e', INK = '#141518', DONE = '#2e9e5b', BLUE = '#2f6fdb';
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, a) => { const e = document.createElementNS(NS, tag); Object.keys(a).forEach(k => e.setAttribute(k, a[k])); return e; };

  // notes: [{m, t, d, clef}]；cur：现在要弹的第几个；ghost：刚才弹错的音（蓝色画在谱上），label：它的音名
  let token = 0;
  function render(el, notes, cur, ghost) {
    if (!el || !notes.length) return Promise.resolve();
    const my = ++token;
    return loadVF().then(VF => { if (my === token) drawVF(VF, el, notes, cur, ghost); })
      .catch(() => { if (my === token) drawPlain(el, notes, cur, ghost); });
  }
  function drawVF(VF, el, notes, cur, ghost) {
    el.innerHTML = '';
    const clef = notes[0].clef || 'treble', S = 1.3;
    const MW = 150, first = 46, H = 120, groups = [];
    notes.forEach((n, i) => { const k = Math.floor(n.t / 4 + 1e-6); (groups[k] = groups[k] || []).push(Object.assign({ i }, n)); });
    const W = first + groups.length * MW + 10;
    const r = new VF.Renderer(el, VF.Renderer.Backends.SVG); r.resize(W * S, H * S);
    const ctx = r.getContext(); ctx.scale(S, S);
    let x = 4, curNote = null, curStave = null, curX = 0;
    groups.forEach((g, k) => {
      if (!g) return;
      const w = MW + (k === 0 ? first : 0), st = new VF.Stave(x, 8, w);
      if (k === 0) st.addClef(clef).addTimeSignature('4/4');
      if (k === groups.length - 1) st.setEndBarType(VF.Barline.type.END);
      st.setContext(ctx).draw();
      const ts = g.map(n => {
        const sn = new VF.StaveNote({ keys: [vfKey(n.m)], duration: DUR[n.d] || 'q', clef, auto_stem: true });
        if (n.d === 3 || n.d === 1.5) VF.Dot.buildAndAttach([sn], { all: true });
        const c = n.i === cur ? RED : n.i < cur ? DONE : INK;
        sn.setStyle({ fillStyle: c, strokeStyle: c });
        if (n.i === cur) { curNote = sn; curStave = st; }
        return sn;
      });
      const v = new VF.Voice({ num_beats: 4, beat_value: 4 }).setMode(VF.Voice.Mode.SOFT).addTickables(ts);
      const beams = VF.Beam.generateBeams(ts);
      new VF.Formatter().joinVoices([v]).format([v], w - (k === 0 ? first + 24 : 24));
      v.draw(ctx, st); beams.forEach(b => b.setContext(ctx).draw());
      x += w;
    });
    const svg = el.querySelector('svg');
    if (curNote && svg) {
      curX = curNote.getAbsoluteX();
      if (ghost && ghost.m !== notes[cur].m) drawGhost(svg, curStave, curX + 34, ghost, clef);
      // 当前这个音下面画一个小三角，眼睛好找
      const yb = curStave.getYForLine(4) + 30;
      svg.appendChild(svgEl('path', { d: `M${curX + 6} ${yb} l-6 9 h12 z`, fill: RED }));
      scrollTo(el, curX * S);
    }
  }
  // 弹错的音：蓝色空心符头 + 加线 + 音名
  function drawGhost(svg, st, x, g, clef) {
    const p = posOf(g.m, clef), y = st.getYForLine(4 - p / 2), gap = st.getSpacingBetweenLines();
    for (let q = -2; q >= p; q -= 2) svg.appendChild(svgEl('line', { x1: x - 9, x2: x + 9, y1: st.getYForLine(4 - q / 2), y2: st.getYForLine(4 - q / 2), stroke: BLUE, 'stroke-width': 1.3 }));
    for (let q = 10; q <= p; q += 2) svg.appendChild(svgEl('line', { x1: x - 9, x2: x + 9, y1: st.getYForLine(4 - q / 2), y2: st.getYForLine(4 - q / 2), stroke: BLUE, 'stroke-width': 1.3 }));
    svg.appendChild(svgEl('ellipse', { cx: x, cy: y, rx: gap * 0.62, ry: gap * 0.45, transform: `rotate(-20 ${x} ${y})`, fill: 'none', stroke: BLUE, 'stroke-width': 2.2 }));
    const t = svgEl('text', { x: x + 11, y: y + 4, 'font-size': 11, 'font-family': 'system-ui,sans-serif', fill: BLUE, 'font-weight': 700 });
    t.textContent = g.label || ''; svg.appendChild(t);
  }
  function scrollTo(el, px) {
    const box = el.scrollWidth > el.clientWidth ? el : el.parentElement; if (!box) return;
    try { box.scrollTo({ left: Math.max(0, px - box.clientWidth * 0.35), behavior: 'smooth' }); } catch (e) { box.scrollLeft = Math.max(0, px - box.clientWidth * 0.35); }
  }
  // VexFlow 加载不了时：自己画五条线、加线、符头（谱号用字代替）
  function drawPlain(el, notes, cur, ghost) {
    const clef = notes[0].clef || 'treble', gap = 10, top = 34, W = 70 + notes.length * 30, H = 124;
    const yOf = p => top + 4 * gap - p * gap / 2;
    let s = `<svg xmlns="${NS}" viewBox="0 0 ${W} ${H}" width="${W * 1.4}" height="${H * 1.4}">`;
    for (let i = 0; i < 5; i++) s += `<line x1="4" x2="${W - 4}" y1="${yOf(i * 2)}" y2="${yOf(i * 2)}" stroke="${INK}"/>`;
    s += `<text x="8" y="${yOf(4) + 5}" font-size="13" font-family="sans-serif" fill="${INK}">${clef === 'bass' ? '低音' : '高音'}</text>`;
    const head = (x, p, c, filled) => {
      let h = '';
      for (let q = -2; q >= p; q -= 2) h += `<line x1="${x - 10}" x2="${x + 10}" y1="${yOf(q)}" y2="${yOf(q)}" stroke="${c}"/>`;
      for (let q = 10; q <= p; q += 2) h += `<line x1="${x - 10}" x2="${x + 10}" y1="${yOf(q)}" y2="${yOf(q)}" stroke="${c}"/>`;
      return h + `<ellipse cx="${x}" cy="${yOf(p)}" rx="6.5" ry="4.6" transform="rotate(-20 ${x} ${yOf(p)})" fill="${filled ? c : 'none'}" stroke="${c}" stroke-width="2"/>`;
    };
    let cx = 0;
    notes.forEach((n, j) => {
      const p = posOf(n.m, clef), x = 60 + j * 30, c = j === cur ? RED : j < cur ? DONE : INK;
      s += head(x, p, c, n.d < 2);
      if (n.d < 4) s += `<line x1="${x + 6}" x2="${x + 6}" y1="${yOf(p)}" y2="${yOf(p) - 28}" stroke="${c}" stroke-width="1.4"/>`;
      if (j === cur) { cx = x; s += `<path d="M${x} ${yOf(-4) + 6} l-6 9 h12 z" fill="${RED}"/>`; }
    });
    if (ghost && notes[cur] && ghost.m !== notes[cur].m) s += head(cx + 16, posOf(ghost.m, clef), BLUE, false) + `<text x="${cx + 26}" y="${yOf(posOf(ghost.m, clef)) + 4}" font-size="11" fill="${BLUE}">${ghost.label || ''}</text>`;
    el.innerHTML = s + '</svg>';
    scrollTo(el, cx * 1.4);
  }

  const api = { where, posOf, stepsBetween, whiteNo, vfKey, load, save, boxOf, record, shown, pickReview, render, loadVF };
  if (typeof module !== 'undefined') module.exports = api; else root.NoteRead = api;
})(typeof window !== 'undefined' ? window : globalThis);
