// 儿童版：给还不识字的孩子用。文字换成声音、颜色和图标。
// 用的都是现成的免费东西：浏览器自带的朗读（speechSynthesis），系统自带的表情图标，
// 音效用网页自己合成（Web Audio），不下载任何素材。课程、判断对错都还是大人版那一套（window.__pe）。
(function () {
  const $ = id => document.getElementById(id);
  const P = () => window.__pe;
  const KEY = 'pianoEarKids';
  // 指法用颜色：1 拇指红、2 食指橙、3 中指绿、4 无名指蓝、5 小指紫
  const FC = ['', '#e03131', '#f08c00', '#2f9e44', '#1c7ed6', '#9c36b5'];
  const CN = ['', '红色', '橙色', '绿色', '蓝色', '紫色'];
  const FN = ['', '拇指', '食指', '中指', '无名指', '小指'];
  const SYL = { 0: '哆', 2: '来', 4: '咪', 5: '发', 7: '嗦', 9: '啦', 11: '西' };
  const syl = m => { const p = ((m % 12) + 12) % 12, s = SYL[p] || ('升' + SYL[p - 1]); return (m >= 72 ? '高音' : m < 60 ? '低音' : '') + s; };
  // 地图上的图：每关一个，儿歌和入门每首一个
  const LV_E = { L0: '🎹', Lx: '🎵', L1: '🐣', L2: '🐥', L3: '👐', L4: '🥁', L5: '🔄', L6: '🎓' };
  const LS_E = { k2: '⚫⚫', k3: '⚫⚫⚫', c: '🏠', warm: '🖐️', warmH: '🦒', warmL: '🤚', hc: '🥯', ml: '🐑', od: '🎉', jb: '🔔', tw: '⭐', tg: '🐯', free: '🎈' };
  const MAP_ORDER = ['L0', 'Lx', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6'];

  let kids = false, voiceOn = true, holdCue = false, resetN = 0, lastKey = '', lastMissSay = 0, micAsked = false;
  let speakingUntil = 0, fxUntil = 0, tok = 0;
  try { const v = localStorage.getItem(KEY + 'Voice'); if (v === '0') voiceOn = false; } catch (e) {}

  // —— 朗读 ——
  const synth = window.speechSynthesis;
  let zh = null;
  const pickVoice = () => { if (!synth) return; const v = synth.getVoices() || []; zh = v.find(x => /^zh[-_]CN/i.test(x.lang)) || v.find(x => /^zh/i.test(x.lang) && !/HK|TW/i.test(x.lang)) || v.find(x => /^(zh|cmn)/i.test(x.lang)) || null; };
  if (synth) { pickVoice(); try { synth.addEventListener('voiceschanged', pickVoice); } catch (e) {} }
  function say(text, done) {
    const my = ++tok;
    let fired = false;
    const fin = () => { if (fired) return; fired = true; if (my === tok) { speakingUntil = performance.now() + 250; if (done) done(); } };
    if (!kids || !voiceOn || !synth || !window.SpeechSynthesisUtterance) { setTimeout(fin, 250); return; }
    try { synth.cancel(); } catch (e) {}
    const est = 700 + text.length * 280;
    speakingUntil = performance.now() + est;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN'; if (zh) u.voice = zh; u.rate = 0.95; u.pitch = 1.15;
    u.onend = fin; u.onerror = fin;
    setTimeout(fin, est + 1500);
    try { synth.speak(u); } catch (e) { fin(); }
  }
  // 说话和放音效时，麦克风听到的“不是要弹的音”先不算错
  window.__peGate = (m, need) => kids && performance.now() < Math.max(speakingUntil, fxUntil) && !need.includes(m);

  // —— 音效（自己合成，不用素材） ——
  function beep(freqs, gap, dur, vol) {
    const pe = P(); if (!pe) return;
    let c; try { c = pe.getCtx(); } catch (e) { return; }
    const t0 = c.currentTime + 0.01;
    freqs.forEach((f, i) => {
      const o = c.createOscillator(), g = c.createGain(), t = t0 + i * gap;
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.05);
    });
    fxUntil = Math.max(fxUntil, performance.now() + (freqs.length * gap + dur) * 1000 + 120);
  }
  const chime = () => beep([2093, 2637], 0.07, 0.16, 0.1);          // 弹对：叮咚
  const fanfare = () => beep([1047, 1319, 1568, 2093], 0.12, 0.35, 0.12); // 弹完

  // —— 页面上的东西 ——
  function el(tag, attrs, html) { const e = document.createElement(tag); Object.assign(e, attrs || {}); if (html != null) e.innerHTML = html; return e; }
  let bar, handBox, playOv, mapOv, doneOv, parentBtn, built = false;
  function build() {
    if (built) return; built = true;
    const wrap = document.querySelector('.wrap'), grid = document.querySelector('.grid');
    bar = el('div', { id: 'kidsBar', className: 'kbar' });
    bar.innerHTML = [
      ['kMic', '🎤', '开麦克风'], ['kDemo', '👂', '再听一遍'], ['kReset', '🔁', '重来'], ['kSlow', '🐢', '慢一点'], ['kVoice', '🔊', '声音提示'], ['kMap', '🗺️', '选关']
    ].map(([id, e, t]) => `<button class="kbtn" id="${id}" type="button" aria-label="${t}" title="${t}">${e}</button>`).join('');
    wrap.insertBefore(bar, grid);
    handBox = el('div', { id: 'kidsHand', className: 'khand' }, '<div class="kmark" id="kMark"></div><div class="kdots" id="kDots">' +
      [1, 2, 3, 4, 5].map(f => `<b data-f="${f}" style="background:${FC[f]}"></b>`).join('') + '<i class="palm2"></i></div><button class="kbtn ksay" id="kSay" type="button" aria-label="再说一遍" title="再说一遍">🔊</button>');
    $('stage').insertAdjacentElement('afterend', handBox);
    const X = [16, 60, 100, 140, 178], Y = [0, 40, 52, 44, 24];
    handBox.querySelectorAll('.kdots b').forEach((b, i) => { b.style.left = X[i] + 'px'; b.style.bottom = (Y[i] + 8) + 'px'; });
    playOv = el('div', { className: 'kover', hidden: true }, '<div class="kpic" id="kPic"></div><button class="kplay" id="kPlay" type="button" aria-label="开始">▶</button>');
    mapOv = el('div', { className: 'kover kmap', hidden: true });
    doneOv = el('div', { className: 'kover', hidden: true });
    parentBtn = el('button', { className: 'kparent', type: 'button', title: '家长：按住 1 秒回到大人版' }, '家长 · 按住回大人版<i></i>');
    document.body.append(playOv, mapOv, doneOv, parentBtn);

    $('kMic').onclick = () => { unlockAudio(); if (!P().listening) $('startBtn').click(); };
    $('kDemo').onclick = () => { unlockAudio(); runDemo(() => cue(true)); };
    $('kReset').onclick = () => { unlockAudio(); hideAll(); $('resetBtn').click(); };
    $('kSlow').onclick = () => {
      const pe = P(); if (!pe || !pe.opt) return;
      const slowNow = pe.opt.tempo <= 55, tp = $('tempo');
      tp.value = slowNow ? (pe.cur.ls.kind === 'beyer' ? 60 : 100) : 45;
      tp.dispatchEvent(new Event('input', { bubbles: true }));
      paintBar(); say(slowNow ? '变回原来的速度' : '慢一点');
    };
    $('kVoice').onclick = () => { voiceOn = !voiceOn; try { localStorage.setItem(KEY + 'Voice', voiceOn ? '1' : '0'); } catch (e) {} if (!voiceOn && synth) synth.cancel(); paintBar(); if (voiceOn) say('我会说话提醒你'); };
    $('kMap').onclick = () => { unlockAudio(); showMap(); };
    $('kSay').onclick = () => { unlockAudio(); cue(true); };
    $('kPlay').onclick = startLesson;
    mapOv.onclick = e => {
      const t = e.target.closest('.ktile'); if (!t) return;
      unlockAudio();
      if (t.classList.contains('locked')) { t.classList.remove('shake'); void t.offsetWidth; t.classList.add('shake'); say('先拿到前面的星星，这一关就打开了'); return; }
      mapOv.hidden = true; P().openLesson(t.dataset.id);
    };
    doneOv.onclick = e => {
      const b = e.target.closest('[data-k]'); if (!b) return; unlockAudio();
      const k = b.dataset.k; doneOv.hidden = true;
      if (k === 'again') $('resetBtn').click();
      else if (k === 'next') P().openLesson(b.dataset.id);
      else showMap();
    };
    // 家长按住 1 秒回大人版；孩子随手一点不会切走
    let ht = null;
    const cancel = () => { clearTimeout(ht); ht = null; parentBtn.classList.remove('hold'); };
    parentBtn.addEventListener('pointerdown', e => { e.preventDefault(); parentBtn.classList.add('hold'); ht = setTimeout(() => { cancel(); setKids(false); }, 1000); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => parentBtn.addEventListener(t, cancel));
    parentBtn.addEventListener('contextmenu', e => e.preventDefault());
    new MutationObserver(paintBar).observe($('micChip'), { attributes: true, attributeFilter: ['class'] });
  }
  function unlockAudio() { try { P().getCtx(); } catch (e) {} }
  const hideAll = () => { [playOv, mapOv, doneOv].forEach(o => o && (o.hidden = true)); };
  function paintBar() {
    if (!built) return; const pe = P();
    $('kMic').classList.toggle('on', !!(pe && pe.listening));
    $('kSlow').classList.toggle('on', !!(pe && pe.opt && pe.opt.tempo <= 55));
    $('kVoice').textContent = voiceOn ? '🔊' : '🔇'; $('kVoice').classList.toggle('off', !voiceOn);
    $('kSay').hidden = !voiceOn;
  }

  // —— 切换 ——
  function setKids(on, fromTap) {
    kids = !!on; try { localStorage.setItem(KEY, kids ? '1' : '0'); } catch (e) {}
    if (kids) build();
    document.body.classList.toggle('kids', kids);
    if (!kids) { hideAll(); if (synth) synth.cancel(); clearColors(); const pe = P(); if (pe && pe.plan) pe.reset(); return; }
    paintBar(); lastKey = '';
    if (fromTap) { unlockAudio(); showMap(); say('选一张图，我们来弹琴'); }
    else if (P() && P().cur) showPlay();
  }

  // —— 一关开始：先示范，再轮到孩子 ——
  const title = ls => ls.title.replace(/·.*$/, '').trim();
  function picOf(ls, L) { return LS_E[ls.id] || LV_E[L.id] || '🎹'; }
  function showPlay() {
    const pe = P(); if (!pe || !pe.cur) return;
    hideAll(); holdCue = true;
    $('kPic').textContent = picOf(pe.cur.ls, pe.cur.L);
    playOv.hidden = false;
  }
  function startLesson() {
    playOv.hidden = true; unlockAudio();
    const pe = P(); if (!pe || !pe.cur) return;
    if (!micAsked && !pe.listening && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) { micAsked = true; $('startBtn').click(); }
    const ls = pe.cur.ls;
    if (ls.kind === 'free') { holdCue = false; say('随便弹弹，听听好听的声音'); return; }
    if (ls.kind === 'find') { holdCue = false; cue(true); return; }
    say('我们来弹' + title(ls) + '。先听我弹一遍。', () => runDemo(() => { say('轮到你了。', () => cue(true)); }));
  }
  function runDemo(done) {
    const pe = P(), plan = pe && pe.plan;
    if (!plan || !plan.steps.length || pe.cur.ls.kind === 'free') { holdCue = false; done && done(); return; }
    holdCue = true;
    const s = pe.spb(), from = pe.finished ? 0 : pe.idx, t1 = plan.steps[from].t;
    const ms0 = pe.data.measures.find(x => x.t <= t1 + 1e-6 && t1 < x.t + x.len - 1e-6), t2 = t1 + Math.max(8, 2 * (ms0 ? ms0.len : 4));
    $('demoBtn').click(); // 大人版的示范：放声音，3D 手跟着弹
    let end = 0;
    plan.steps.forEach(st => {
      if (st.t < t1 || st.t >= t2) return;
      st.notes.forEach(n => { const at = 150 + (st.t - t1) * s * 1000, d = Math.max(180, n.d * s * 900); end = Math.max(end, at + d); setTimeout(() => lightDemo(n, d), at); });
    });
    setTimeout(() => { holdCue = false; paintStep(); done && done(); }, end + 500);
  }
  function lightDemo(n, d) {
    const pe = P(), k = pe.keyEls[n.m], c = FC[n.f] || '#c8102e';
    if (k) { k.style.setProperty('--kc', c); k.classList.add('kdemo'); setTimeout(() => k.classList.remove('kdemo'), d); }
    const ov = $('handov'), fg = ov && n.hand !== 'L' && ov.querySelector(`.fgr[data-f="${n.f}"]`);
    if (fg) { fg.style.setProperty('--kc', c); fg.classList.add('kpr'); setTimeout(() => fg.classList.remove('kpr'), d); }
    showFinger(n.hand, n.f);
  }

  // —— 每一步：琴键亮成手指的颜色，说一句短提示 ——
  function clearColors() { const pe = P(); if (!pe) return; Object.values(pe.keyEls || {}).forEach(k => k.style.removeProperty('--kc')); }
  function stepNow() { const pe = P(); return pe && pe.plan && !pe.finished ? pe.plan.steps[pe.idx] : null; }
  function paintStep() {
    if (!kids) return;
    const pe = P(), st = stepNow();
    clearColors();
    if (!st) { showFinger(null); return; }
    st.notes.forEach(n => { const k = pe.keyEls[n.m]; if (k) k.style.setProperty('--kc', FC[n.f] || (n.hand === 'L' ? '#2f6fdb' : '#c8102e')); });
    const r = st.notes.find(n => n.hand === 'R') || st.notes[0];
    const ov = $('handov'); if (ov && r.f) ov.style.setProperty('--kc', FC[r.f]);
    document.querySelectorAll('#lane .blk').forEach(b => { const f = b.querySelector('.fg'); if (f) b.style.setProperty('--kc', FC[+f.textContent] || ''); });
    showFinger(r.hand, r.f, st);
  }
  function showFinger(hand, f, st) {
    if (!built) return;
    const dots = $('kDots');
    dots.classList.toggle('left', hand === 'L');
    dots.querySelectorAll('b').forEach(b => b.classList.toggle('on', +b.dataset.f === f));
    let mark = '';
    if (st && st.notes.length > 1) mark = '👐';
    else if (st && (st.shiftR || st.shiftL)) { const pe = P(), prev = pe.plan.steps[pe.idx - 1]; mark = prev && st.anchorR != null && prev.anchorR != null && st.anchorR < prev.anchorR ? '⬅️' : '➡️'; }
    $('kMark').textContent = mark;
  }
  function cueText(full) {
    const pe = P(), st = stepNow(); if (!st) return '';
    const prev = pe.idx > 0 ? pe.plan.steps[pe.idx - 1] : null;
    if (st.any) return full ? '找一找，弹亮起来的黑键，哪个都可以' : '再找一组黑键';
    const who = n => (pe.plan.hands === 'RL' || n.hand === 'L') ? (n.hand === 'L' ? '左手' : '右手') : '';
    const one = (n, long) => n.f ? (long ? `${who(n)}用${CN[n.f]}的${FN[n.f]}，弹${syl(n.m)}` : `${who(n)}${CN[n.f]}${FN[n.f]}，${syl(n.m)}`) : `弹${syl(n.m)}`;
    let t;
    if (st.notes.length > 1) t = (full ? '几个键一起按：' : '一起按：') + st.notes.map(n => one(n, false)).join('，');
    else {
      const n = st.notes[0], p = prev && prev.notes.length === 1 ? prev.notes[0] : null;
      t = full ? one(n, true) : (p && p.f === n.f && p.hand === n.hand ? syl(n.m) : one(n, false));
    }
    if (st.shiftR || st.shiftL) t = '整只手搬家，' + t;
    return t;
  }
  function cue(full) {
    if (!kids) return; const st = stepNow(); if (!st) return;
    const pe = P(); lastKey = pe.cur.ls.id + ':' + pe.idx + ':' + resetN;
    paintStep(); say(cueText(full));
  }

  // —— 弹对、弹错、弹完 ——
  function stars(k) {
    const r = k && k.getBoundingClientRect(); if (!r) return;
    for (let i = 0; i < 3; i++) {
      const s = el('div', { className: 'kstar' }, '⭐');
      s.style.left = (r.left + r.width / 2) + 'px'; s.style.top = (r.top + r.height * 0.35) + 'px';
      s.style.setProperty('--dx', ((i - 1) * 40 + (Math.random() * 16 - 8)) + 'px'); s.style.animationDelay = (i * 70) + 'ms';
      document.body.appendChild(s); setTimeout(() => s.remove(), 1200);
    }
  }
  function arrow(m, need) {
    const pe = P(), k = pe.keyEls[m], kb = $('kb'); if (!k || !kb || !need || !need.length) return;
    const a = el('div', { className: 'karrow' }, need[0] > m ? '➡️' : '⬅️');
    a.style.left = (k.offsetLeft + k.offsetWidth / 2) + 'px';
    kb.appendChild(a); setTimeout(() => a.remove(), 1300);
  }
  window.addEventListener('pe:reset', () => { resetN++; holdCue = false; if (kids) hideAll(); });
  window.addEventListener('pe:lesson', () => { if (kids) showPlay(); });
  window.addEventListener('pe:step', () => {
    if (!kids) return;
    paintStep();
    setTimeout(() => {
      const pe = P(); if (!pe || !pe.cur || holdCue || !kids) return;
      const key = pe.cur.ls.id + ':' + pe.idx + ':' + resetN; if (key === lastKey) return;
      cue(pe.idx === 0);
    }, 0);
  });
  window.addEventListener('pe:hit', e => { if (!kids) return; stars(P().keyEls[e.detail.m]); chime(); });
  window.addEventListener('pe:miss', e => {
    if (!kids) return; const d = e.detail; arrow(d.m, d.need);
    const now = performance.now(); if (now - lastMissSay < 3000) return; lastMissSay = now;
    const st = stepNow();
    say(st && st.any ? '要弹黑键哦' : (d.need[0] > d.m ? '往右边一点，找亮起来的键' : '往左边一点，找亮起来的键'));
  });
  window.addEventListener('pe:finish', e => {
    if (!kids) return; const d = e.detail, pe = P(); build();
    const n = d.stars, nx = d.next && pe.unlocked(d.next) ? d.next : null;
    doneOv.innerHTML = `<div class="kpic">${n >= 3 ? '🏆' : n >= 1 ? '🎉' : '💪'}</div><div class="kstars">${[0, 1, 2].map(i => `<span style="opacity:${i < n ? 1 : 0.2}">⭐</span>`).join('')}</div>` +
      `<div class="krow"><button class="kbtn" data-k="again" aria-label="再来一遍" title="再来一遍">🔁</button>${nx ? `<button class="kbtn big" data-k="next" data-id="${nx}" aria-label="下一关" title="下一关">▶</button>` : ''}<button class="kbtn" data-k="map" aria-label="选关" title="选关">🗺️</button></div>`;
    doneOv.hidden = false; fanfare();
    setTimeout(() => say(n >= 3 ? '太棒了！三颗星星！' : n === 2 ? '真好！两颗星星！' : n === 1 ? '拿到一颗星星！再弹一次，能拿更多' : '没关系，我们再来一次'), 500);
  });

  // —— 图画地图 ——
  function showMap() {
    const pe = P(); if (!pe || !pe.CUR) return; build(); hideAll();
    const levels = MAP_ORDER.map(id => pe.CUR.levels.find(L => L.id === id)).filter(Boolean).concat(pe.CUR.levels.filter(L => !MAP_ORDER.includes(L.id)));
    mapOv.innerHTML = levels.map(L => {
      const got = L.lessons.filter(ls => pe.lessonStars(ls) >= 1).length;
      return `<div class="kisle"><h3>${LV_E[L.id] || '🎹'} <span class="small" style="font-size:14px;color:#d4a017">${'⭐'.repeat(Math.min(got, 12))}</span></h3><div class="ktiles">` +
        L.lessons.map((ls, i) => {
          const ok = pe.unlocked(ls.id), st = pe.lessonStars(ls), cur = pe.cur && pe.cur.ls === ls;
          return `<button class="ktile${ok ? '' : ' locked'}${cur ? ' cur' : ''}" data-id="${ls.id}" aria-label="${ls.title}" title="${ls.title}">` +
            (LS_E[ls.id] ? '' : `<span class="n">${'•'.repeat(i + 1)}</span>`) + `<span class="e${/⚫/.test(picOf(ls, L)) ? ' sm' : ''}">${picOf(ls, L)}</span>` +
            (ls.kind === 'free' ? '' : `<span class="s">${'★'.repeat(st)}<span style="opacity:.25">${'★'.repeat(3 - st)}</span></span>`) + '</button>';
        }).join('') + '</div></div>';
    }).join('');
    mapOv.hidden = false; mapOv.scrollTop = 0;
  }

  // —— 开关：大人版右上角的“儿童版”按钮；地址加 ?kids=1 / ?kids=0 也行 ——
  const btn = $('kidsBtn'); if (btn) btn.onclick = () => setKids(true, true);
  let start = false;
  try { start = localStorage.getItem(KEY) === '1'; } catch (e) {}
  const q = location.search.match(/[?&]kids=([01])/); if (q) start = q[1] === '1';
  if (start) setKids(true);
  window.__kids = { setKids, get on() { return kids; }, cueText, showMap, say };
})();
