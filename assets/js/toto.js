/* Toto — the librarian character and the "Ask Toto" conversation */
'use strict';

/** Toto, drawn as an original little librarian: a round blue figure with lime glasses, a leaf sprout and a book. */
function totoFigure(size = 150) {
  return `<svg class="toto-fig" viewBox="0 0 160 180" width="${size}" height="${Math.round(size * 1.125)}" role="img" aria-label="Toto, the librarian">
    <ellipse class="tf-shadow" cx="80" cy="172" rx="42" ry="6"/>
    <g class="tf-body">
      <g class="tf-sprout"><path d="M80 30 C80 20 82 14 86 10" class="tf-stem"/><path d="M86 10 C96 4 106 8 106 16 C96 20 90 18 86 10Z" class="tf-leaf"/><path d="M84 16 C74 8 64 12 64 20 C72 24 80 22 84 16Z" class="tf-leaf tf-leaf2"/></g>
      <ellipse cx="62" cy="163" rx="13" ry="7" class="tf-foot"/><ellipse cx="98" cy="163" rx="13" ry="7" class="tf-foot"/>
      <path d="M80 28 C120 28 134 62 134 100 C134 140 112 160 80 160 C48 160 26 140 26 100 C26 62 40 28 80 28Z" class="tf-skin"/>
      <path d="M80 92 C104 92 116 108 116 128 C116 148 100 156 80 156 C60 156 44 148 44 128 C44 108 56 92 80 92Z" class="tf-belly"/>
      <g class="tf-bow"><path d="M80 104 L66 96 L66 112 Z" class="tf-scarf"/><path d="M80 104 L94 96 L94 112 Z" class="tf-scarf"/><circle cx="80" cy="104" r="4" class="tf-knot"/></g>
      <g class="tf-arm-l"><path d="M34 104 C22 112 22 126 34 132" class="tf-limb-o"/><path d="M34 104 C22 112 22 126 34 132" class="tf-limb"/>
        <g class="tf-book"><rect x="26" y="120" width="30" height="22" rx="3" transform="rotate(-12 41 131)" class="tf-cover"/><rect x="30" y="123" width="23" height="16" rx="1.5" transform="rotate(-12 41 131)" class="tf-pages"/><path d="M41 122 L42 141" transform="rotate(-12 41 131)" class="tf-spine"/></g></g>
      <g class="tf-arm-r"><path d="M124 100 C140 94 150 80 152 64" class="tf-limb-o"/><path d="M124 100 C140 94 150 80 152 64" class="tf-limb"/><circle cx="152" cy="58" r="9.5" class="tf-hand"/>
        <path d="M146 50 l-3 -6 M152 48 v-7 M158 50 l3 -6" class="tf-fingers"/></g>
      <g class="tf-face">
        <circle cx="62" cy="68" r="15" class="tf-eyewhite"/><circle cx="98" cy="68" r="15" class="tf-eyewhite"/>
        <g class="tf-pupils"><circle cx="64" cy="70" r="6.5" class="tf-pupil"/><circle cx="100" cy="70" r="6.5" class="tf-pupil"/><circle cx="66" cy="67" r="2" class="tf-glint"/><circle cx="102" cy="67" r="2" class="tf-glint"/></g>
        <g class="tf-lids"><rect x="45" y="50" width="34" height="0" class="tf-lid"/><rect x="81" y="50" width="34" height="0" class="tf-lid"/></g>
        <circle cx="62" cy="68" r="17" class="tf-glasses"/><circle cx="98" cy="68" r="17" class="tf-glasses"/><path d="M79 66 Q80 62 81 66" class="tf-glasses"/>
        <path d="M54 46 Q62 42 70 46" class="tf-brow tf-brow-l"/><path d="M90 46 Q98 42 106 46" class="tf-brow tf-brow-r"/>
        <ellipse cx="48" cy="88" rx="7" ry="4" class="tf-cheek"/><ellipse cx="112" cy="88" rx="7" ry="4" class="tf-cheek"/>
        <path d="M68 88 Q80 100 92 88" class="tf-mouth tf-smile"/><path d="M70 92 Q80 86 90 92" class="tf-mouth tf-frown"/><ellipse cx="80" cy="91" rx="5" ry="4" class="tf-mouth-o"/>
      </g>
    </g>
    <g class="tf-steam"><path d="M30 34 q-6 -8 0 -14 q6 -6 0 -14"/><path d="M130 34 q6 -8 0 -14 q-6 -6 0 -14"/></g>
    <g class="tf-cup"><path d="M108 132 h22 v10 a11 11 0 0 1 -22 0z"/><path d="M130 135 a5 5 0 0 1 0 9" fill="none"/><path d="M114 126 q-3 -4 0 -8 M122 126 q-3 -4 0 -8" class="tf-cupsteam"/></g>
    <g class="tf-zz"><text x="118" y="24">z</text><text x="130" y="12">Z</text></g>
    <g class="tf-think"><circle cx="128" cy="28" r="4"/><circle cx="140" cy="18" r="5.5"/><circle cx="154" cy="8" r="7"/></g>
  </svg>`;
}

const TOTO_STATE_CLASSES = ['is-wave', 'is-think', 'is-happy', 'is-sorry', 'is-talk', 'is-grumpy', 'is-dance', 'is-wink', 'is-yawn', 'is-sleep'];
function totoMood(el, mood, ms = 0) {
  if (!el) return;
  el.classList.remove(...TOTO_STATE_CLASSES);
  if (mood) { void el.offsetWidth; el.classList.add('is-' + mood); }
  clearTimeout(el._moodT);
  if (ms) el._moodT = setTimeout(() => el.classList.remove('is-' + mood), ms);
}

/** Light formatting for Toto's replies: **bold** and *emphasis*, everything else escaped. */
function totoText(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>');
}
function totoQuote(text, words) {
  // highlight on the raw text, escaping every piece separately (never run patterns over escaped HTML)
  const ws = (words || []).filter((w) => w && w.length > 1).sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!ws.length) return esc(text);
  const rx = new RegExp('((?:' + ws.join('|') + ')[\\p{L}]*)', 'giu');
  return String(text).split(rx).map((part, i) => (i % 2 ? `<mark>${esc(part)}</mark>` : esc(part))).join('');
}

/* ---------------- Toto's voice (built into the browser: no service, no cost) ---------------- */
const TOTO_VOICE = {
  listening: false, rec: null, voice: null,
  canSpeak: () => 'speechSynthesis' in window,
  canListen: () => !!(window.SpeechRecognition || window.webkitSpeechRecognition) && S.settings.voice_input !== false,
  on() { try { return localStorage.getItem('toto-voice') === '1'; } catch (e) { return false; } },
  set(v) { try { localStorage.setItem('toto-voice', v ? '1' : '0'); } catch (e) {} },
  noticeShown() { try { const s = localStorage.getItem('toto-mic-notice') === '1'; localStorage.setItem('toto-mic-notice', '1'); return s; } catch (e) { return true; } },
  pick() {
    // prefer a voice that runs on this computer, in English; a lighter, friendly one if there is a choice
    const vs = speechSynthesis.getVoices(); if (!vs.length) return null;
    const en = vs.filter((v) => /^en/i.test(v.lang));
    const pool = en.length ? en : vs;
    const score = (v) => (v.localService ? 4 : 0) + (/en-(GB|KE|ZA|IE|AU)/i.test(v.lang) ? 1 : 0) + (/natural|neural|online/i.test(v.name) ? 2 : 0) + (/female|zira|libby|sonia|aria|jenny|hazel|susan|samantha|serena/i.test(v.name) ? 1 : 0);
    return pool.slice().sort((a, b) => score(b) - score(a))[0];
  },
  say(text, fig) {
    if (!this.canSpeak() || !text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.slice(0, 700));
    this.voice = this.voice || this.pick();
    if (this.voice) { u.voice = this.voice; u.lang = this.voice.lang; }
    u.rate = 1.03; u.pitch = 1.25;   // a little higher: Toto is small
    u.onstart = () => fig?.classList.add('is-talking');
    u.onend = u.onerror = () => fig?.classList.remove('is-talking');
    u.onboundary = () => { if (!fig) return; fig.classList.remove('blab'); void fig.offsetWidth; fig.classList.add('blab'); };
    speechSynthesis.speak(u);
  },
  stop(fig) { if (this.canSpeak()) speechSynthesis.cancel(); fig?.classList.remove('is-talking'); },
  listen({ onText, onDone, onError }) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new SR(); this.rec = r; this.listening = true;
    r.lang = /^en/i.test(navigator.language) ? navigator.language : 'en-GB';
    r.interimResults = true; r.maxAlternatives = 1; r.continuous = false;
    let finalText = '';
    r.onresult = (e) => { let t = ''; for (const res of e.results) t += res[0].transcript; if (e.results[e.results.length - 1].isFinal) finalText = t; onText(t); };
    r.onerror = (e) => {
      this.listening = false;
      onError(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'I need permission to use the microphone — allow it in the address bar. 🎙️'
        : e.error === 'no-speech' ? 'I didn’t hear anything. Try again? 🙉' : e.error === 'network' ? 'Voice needs an internet connection in this browser. You can still type. ⌨️' : 'The microphone didn’t work this time. You can still type. ⌨️');
    };
    r.onend = () => { if (!this.listening) return; this.listening = false; onDone(finalText || ''); };
    try { r.start(); } catch (e) { this.listening = false; onError('The microphone is busy. Try again in a moment.'); }
  },
  stopListening() { try { this.rec?.stop(); } catch (e) {} },
};
if ('speechSynthesis' in window) { speechSynthesis.onvoiceschanged = () => { TOTO_VOICE.voice = null; }; window.addEventListener('hashchange', () => { speechSynthesis.cancel(); TOTO_VOICE.stopListening(); }); }

/** What Toto reads aloud: the gist, not every chip and link. */
function totoSpeech(r) {
  const clean = (x) => String(x || '').replace(/\*\*|\*/g, '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '').replace(/[•→]/g, '').replace(/\s+/g, ' ').trim();
  const parts = (r.reply || []).map(clean);
  if (r.passage) parts.push(clean(r.passage.text));
  if (r.steps?.length) r.steps.slice(0, 5).forEach((x, i) => parts.push(`Step ${i + 1}. ${clean(x)}`));
  if (r.reply2) parts.push(clean(r.reply2));
  return parts.filter(Boolean).join(' ').replace(/\(([A-Z]{2,}[-A-Z0-9]*), v([\d.]+)\)/g, ', number $1, version $2,');
}

const chat1 = (xs) => xs[Math.floor(Math.random() * xs.length)];
/** Toto's one-liner above the conversation, matching his mood. */
function totoLine(r, mood) {
  if (mood === 'grumpy') return chat1(['Hmph. 😤', 'I’m not angry. I’m just… organising my feelings. 😑', 'My glasses are steaming. 😠']);
  if (r.intent === 'help') return 'Here’s how — step by step below. 👇';
  if (r.intent === 'chat' && mood === 'sorry' && (r.chat?.annoy || 0) > 0) return chat1(['That stung a little. 😕', 'Hmm. 😑', 'I’m trying, you know…']);
  if (r.intent === 'chat') return mood === 'dance' ? chat1(['Hehe! 😄', '💃🕺', 'I’m on a roll today!']) : mood === 'wink' ? chat1(['😉', 'Your move!', 'Think carefully… 🤔']) : mood === 'sorry' ? 'I’m here for you. 💙' : chat1(['🙂', 'Anything else?', 'I’m enjoying this chat!']);
  if (r.total) return r.passage ? 'Found it — the answer is quoted below.' : `I found ${r.total === 1 ? 'one' : r.total} for you.`;
  return "Hmm, I couldn't find that one.";
}

/* ---------------- Ask Toto ---------------- */
// the conversation is kept for this tab and this person only (another person signing in on the same tab never sees it)
const TOTO_CHAT = { msgs: [], ctx: null, chat: null, uid: null };
const totoKey = () => 'toto-chat-' + (S.user?.id || 0);
function totoLoad() {
  if (TOTO_CHAT.uid === S.user?.id) return;
  Object.assign(TOTO_CHAT, { msgs: [], ctx: null, chat: null, uid: S.user?.id });
  try { const saved = JSON.parse(sessionStorage.getItem(totoKey()) || 'null'); if (saved && Array.isArray(saved.msgs)) { TOTO_CHAT.msgs = saved.msgs; TOTO_CHAT.ctx = saved.ctx || null; TOTO_CHAT.chat = saved.chat || null; } } catch (e) {}
}
const totoSave = () => { try { sessionStorage.setItem(totoKey(), JSON.stringify({ msgs: TOTO_CHAT.msgs.slice(-30), ctx: TOTO_CHAT.ctx, chat: TOTO_CHAT.chat })); } catch (e) {} };
function totoForget() { try { Object.keys(sessionStorage).filter((k) => k.startsWith('toto-chat-')).forEach((k) => sessionStorage.removeItem(k)); } catch (e) {} Object.assign(TOTO_CHAT, { msgs: [], ctx: null, chat: null, uid: null }); }

route('/ask', async (page, _, params) => {
  setTitle('Ask Toto');
  // every visit starts a fresh, tidy conversation
  Object.assign(TOTO_CHAT, { msgs: [], ctx: null, chat: null, uid: S.user?.id });
  try { sessionStorage.removeItem(totoKey()); } catch (e) {}
  if (!S.settings.ai) { location.hash = '#/search' + (params.q ? '?q=' + encodeURIComponent(params.q) : ''); return; }
  const first = (S.user.name || '').split(' ')[0];
  page.innerHTML = `
    <div class="ask">
      <div class="ask-stage">
        <div class="ask-toto is-enter" id="totoFig">${totoFigure(150)}</div>
        <div class="ask-hello"><div class="bubble" id="totoHello"></div>
          <div class="ask-alt small"><a href="#/search">Prefer the classic search with filters?</a></div></div>
      </div>
      <div class="ask-log" id="askLog" aria-live="polite"></div>
      <form class="ask-bar" id="askForm" autocomplete="off">
        ${TOTO_VOICE.canListen() ? `<button class="mini-btn ask-mic" type="button" id="askMic" title="Talk to Toto (hold a normal conversation — he listens until you pause)">${icon('mic')}</button>` : ''}
        <input class="input" id="askQ" placeholder="Ask Toto… e.g. where is the latest hydrotest procedure?" aria-label="Ask Toto" maxlength="400">
        ${TOTO_VOICE.canSpeak() ? `<button class="mini-btn ask-spk ${TOTO_VOICE.on() ? 'on' : ''}" type="button" id="askSpk" title="Toto speaks his answers">${icon(TOTO_VOICE.on() ? 'volume' : 'mute')}</button>` : ''}
        <button class="btn primary" type="submit" id="askGo">${icon('send', 'sm')}Ask</button>
        ${TOTO_CHAT.msgs.length ? `<button class="btn ghost" type="button" id="askNew" title="Start a new conversation">${icon('undo', 'sm')}New</button>` : ''}
      </form>
    </div>`;
  const fig = $('#totoFig'), log = $('#askLog'), input = $('#askQ'), hello = $('#totoHello');
  const greet = TOTO_CHAT.msgs.length ? `Welcome back, ${first}! Carry on, or ask me something new.`
    : `Hi ${first}! I'm Toto, your librarian. Tell me what you're looking for — the way you'd ask a colleague.`;
  // the hello appears letter by letter while Toto waves
  setTimeout(() => totoMood(fig, 'wave', 2600), 450);
  let i = 0; const typer = setInterval(() => { hello.textContent = greet.slice(0, ++i); if (i >= greet.length) clearInterval(typer); }, 18);
  setTimeout(() => fig.classList.remove('is-enter'), 900);

  // bring the latest question (and the reply under it) up to just below Toto, like any chat app
  const scroll = () => requestAnimationFrame(() => {
    const mine = log.querySelectorAll('.msg.me'); const target = mine[mine.length - 1] || log.lastElementChild; if (!target) return;
    const stage = page.querySelector('.ask-stage');
    const offset = (stage ? stage.getBoundingClientRect().bottom : 160) + 8;
    const y = window.scrollY + target.getBoundingClientRect().top - offset;
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  });
  const userBubble = (q) => `<div class="msg me"><div class="bubble">${esc(q)}</div>${avatar(S.user.name)}</div>`;
  const totoBubble = (r) => {
    const passage = r.passage ? `<blockquote class="ask-quote">${totoMark()}<div><p>“${totoQuote(r.passage.text, r.passage.words)}”</p>
        <a href="#/doc/${r.passage.doc_id}">${esc(r.passage.title)}${r.passage.doc_number ? ` · <span class="mono">${esc(r.passage.doc_number)}</span>` : ''}${r.passage.version ? ` · v${esc(r.passage.version)}` : ''} →</a></div></blockquote>` : '';
    const docs = r.docs?.length ? `<div class="ask-docs">${r.docs.map((d) => `<a class="ask-doc" href="#/doc/${d.id}">${fileIcon(d.ext, 'sm')}<div style="min-width:0"><div class="t">${esc(d.title)}</div>
        <div class="s">${esc([d.doc_number, d.content_type, d.library].filter(Boolean).join(' · '))} · ${esc(fmtDate(d.modified))}</div>
        ${d.why?.length ? `<div class="why">${d.why.map((w) => `<span>${esc(w)}</span>`).join('')}</div>` : ''}</div>${d.version ? revDelta(d.version, d.status === 'published' ? 'pub' : '') : ''}</a>`).join('')}</div>` : '';
    const more = r.total > (r.docs?.length || 0) && r.search_q ? `<a class="small" href="#/search?q=${encodeURIComponent(r.search_q)}">See all ${r.total} in the classic search →</a>` : '';
    const chips = r.chips?.length ? `<div class="ask-chips"><span class="faint small">I understood:</span>${r.chips.map((c, j) => `<button type="button" class="chip ghost" data-rm="${j}" title="Search again without this">${esc(c.label)}${icon('x', 'sm')}</button>`).join('')}</div>` : '';
    const expert = r.expert ? `<div class="ask-expert">${avatar(r.expert.name)}<div><b>Ask ${esc(r.expert.name)}</b><span class="small muted">${esc(r.expert.job_title || r.expert.department || '')} — ${esc(r.expert.why)}.</span>
        <div class="small"><a href="#/person/${r.expert.id}">View profile</a>${r.expert.email ? ` · <a href="mailto:${esc(r.expert.email)}">${esc(r.expert.email)}</a>` : ''}</div></div></div>` : '';
    const sugg = r.suggest?.length ? `<div class="ask-sugg">${r.suggest.map((s) => `<button type="button" class="chip add" data-ask="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : '';
    const steps = r.steps?.length ? `<ol class="ask-steps">${r.steps.map((x) => `<li>${totoText(x)}</li>`).join('')}</ol>` : '';
    const acts = r.actions?.length ? `<div class="btn-row">${r.actions.map((x, j) => `<button type="button" class="btn sm" data-act-i="${j}">${icon(x.run === 'upload' ? 'upload' : 'arrow', 'sm')}${esc(x.label)}</button>`).join('')}</div>` : '';
    return `<div class="msg toto"><span class="toto-avatar">${totoMark()}</span><div class="bubble">${(r.reply || []).map((p) => `<p>${totoText(p)}</p>`).join('')}${steps}${acts}${passage}${r.reply2 ? `<p>${totoText(r.reply2)}</p>` : ''}${docs}${more}${chips}${expert}${sugg}</div></div>`;
  };
  const paint = () => {
    page.querySelector('.ask')?.classList.toggle('chatting', TOTO_CHAT.msgs.length > 0);
    log.innerHTML = TOTO_CHAT.msgs.map((m, j) => (m.who === 'me' ? userBubble(m.q) : totoBubble(m.r).replace('<div class="msg toto">', `<div class="msg toto" data-m="${j}">`))).join('')
      || `<div class="ask-start"><span class="faint small">Try asking:</span>${['Where is the latest hydrotest procedure?', 'How many drawings were added this month?', 'Which documents are overdue for review?', 'Who owns the fire & gas philosophy?', 'Show me my documents from last week']
        .map((s) => `<button type="button" class="chip add" data-ask="${esc(s)}">${esc(s)}</button>`).join('')}</div>`;
  };
  paint();
  if (TOTO_CHAT.msgs.length) setTimeout(scroll, 50);

  let busy = false;
  const ask = async (q, remove = null, ctxOverride) => {
    if (busy) return; busy = true;
    if (q) TOTO_CHAT.msgs.push({ who: 'me', q });
    paint();
    log.insertAdjacentHTML('beforeend', `<div class="msg toto thinking"><span class="toto-avatar">${totoMark()}</span><div class="bubble"><span class="dots"><i></i><i></i><i></i></span> <span class="faint small">Toto is looking on the shelves…</span></div></div>`);
    scroll();
    totoMood(fig, 'think');
    try {
      const t0 = Date.now();
      const r = await api('search.ask', { q: q || '', context: ctxOverride !== undefined ? ctxOverride : TOTO_CHAT.ctx, remove: remove || [], chat: TOTO_CHAT.chat });
      // a person takes a moment to reply — a little longer for longer answers
      const words = (r.reply || []).join(' ').split(/\s+/).length + (r.steps || []).join(' ').split(/\s+/).length;
      await new Promise((ok) => setTimeout(ok, Math.max(0, Math.min(1400, 380 + words * 14) - (Date.now() - t0))));
      TOTO_CHAT.ctx = r.context || TOTO_CHAT.ctx;
      if (r.chat) TOTO_CHAT.chat = r.chat;
      TOTO_CHAT.msgs.push({ who: 'toto', r });
      totoSave();
      paint(); scroll();
      const mood = r.mood || (r.total ? 'happy' : 'sorry');
      totoMood(fig, mood, mood === 'grumpy' ? 0 : 2600);
      hello.textContent = totoLine(r, mood);
      if (r.lock) teaBreak(r.lock);
      if (TOTO_VOICE.on()) TOTO_VOICE.say(totoSpeech(r), fig);
    } catch (e) {
      log.querySelector('.thinking')?.remove();
      totoMood(fig, 'sorry', 2000);
      toast(e.message, 'err');
    }
    busy = false;
    $('#askNew') || $('#askForm').insertAdjacentHTML('beforeend', `<button class="btn ghost" type="button" id="askNew" title="Start a new conversation">${icon('undo', 'sm')}New</button>`);
  };

  $('#askForm').addEventListener('submit', (e) => { e.preventDefault(); const q = input.value.trim(); if (!q) return; input.value = ''; ask(q); });
  page.addEventListener('click', (e) => {
    const a = e.target.closest('[data-ask]'); if (a) { ask(a.dataset.ask); return; }
    const ac = e.target.closest('[data-act-i]');
    if (ac) {
      const m = TOTO_CHAT.msgs[+ac.closest('[data-m]').dataset.m]; const x = m?.r?.actions?.[+ac.dataset.actI]; if (!x) return;
      if (x.run === 'upload') openUpload({});
      else if (x.run === 'theme') $('[data-act="theme"]')?.click();
      else if (x.href && /^#\/[\w\/?=&-]*$/.test(x.href)) go(x.href);
      return;
    }
    const rm = e.target.closest('[data-rm]');
    if (rm) {   // re-run that answer without one of the things Toto understood
      const host = rm.closest('[data-m]'); const m = TOTO_CHAT.msgs[+host.dataset.m]; const chip = m?.r?.chips?.[+rm.dataset.rm];
      if (chip) ask('', [{ k: chip.k, v: chip.v }], m.r.context);
      return;
    }
    if (e.target.closest('#askNew')) { TOTO_VOICE.stop(fig); TOTO_CHAT.msgs = []; TOTO_CHAT.ctx = null; TOTO_CHAT.chat = null; totoSave(); paint(); e.target.closest('#askNew').remove(); hello.textContent = `Fresh start, ${first}. What are you looking for?`; totoMood(fig, 'wave', 2400); input.focus(); }
  });
  // poke Toto: ticklish at first, then less amused
  let pokes = [], idleT = null, idleN = 0;
  fig.addEventListener('click', () => {
    const now = Date.now(); pokes = pokes.filter((t) => now - t < 6000); pokes.push(now);
    const n = pokes.length;
    if (n <= 2) { totoMood(fig, 'dance', 1600); hello.textContent = chat1(['Hehe, that tickles! 😆', 'Boop! 👉👈', 'Hi again! 👋']); }
    else if (n <= 4) { totoMood(fig, 'wink', 1600); hello.textContent = chat1(['Okay, okay, I’m awake! 😅', 'That’s enough poking, thank you. 🙃']); }
    else {
      totoMood(fig, 'grumpy');
      hello.textContent = chat1(['Stop poking me! 😠 I’m trying to work here.', 'Do I poke YOU while you’re working? 😤']);
      TOTO_CHAT.chat = Object.assign({}, TOTO_CHAT.chat, { annoy: Math.min(4, ((TOTO_CHAT.chat || {}).annoy || 0) + 1) }); totoSave();
      if (n >= 8) { pokes = []; teaBreak(8, 'That’s it — tea break. ☕ Poke me again in a minute.'); }
    }
  });
  // nobody talking for a while: Toto gets bored, then sleepy
  const idle = () => {
    clearTimeout(idleT);
    idleT = setTimeout(() => {
      if (!document.body.contains(fig) || fig.classList.contains('is-grumpy')) return;
      idleN++;
      if (idleN === 1) { totoMood(fig, 'yawn', 3000); hello.textContent = `*yawns* … still there, ${first}? 😴`; idle(); }
      else if (idleN === 2) { totoMood(fig, 'sleep'); hello.textContent = 'Zzz… (type something to wake me up)'; }
    }, idleN ? 120000 : 60000);
  };
  const wake = () => { if (fig.classList.contains('is-sleep')) { totoMood(fig, 'wave', 2000); hello.textContent = `Oh! I’m awake, I’m awake! 😳 What do you need, ${first}?`; } idleN = 0; idle(); };
  input.addEventListener('input', wake); input.addEventListener('focus', wake);
  idle();
  function teaBreak(sec, line) {
    const go = $('#askGo'); input.disabled = true; go.disabled = true;
    fig.classList.add('is-tea'); totoMood(fig, 'grumpy');
    if (line) hello.textContent = line;
    let left = sec;
    const tick = () => {
      if (!document.body.contains(input)) return;
      input.placeholder = `Toto is on a tea break ☕ … ${left}s`;
      if (left-- <= 0) {
        input.disabled = false; go.disabled = false; input.placeholder = 'Ask Toto… e.g. where is the latest hydrotest procedure?';
        fig.classList.remove('is-tea'); totoMood(fig, 'wave', 2400);
        hello.textContent = chat1(['Okay, I’m back. Tea helps. 😌 Where were we?', 'Back! Feeling much calmer now. ☕✨', `Right, ${first}. Fresh start? 🙂`]);
        input.focus(); return;
      }
      setTimeout(tick, 1000);
    };
    tick();
  }
  // voice: Toto listens (microphone) and talks back (speaker)
  $('#askSpk')?.addEventListener('click', (e) => {
    const on = !TOTO_VOICE.on(); TOTO_VOICE.set(on);
    const b = e.currentTarget; b.classList.toggle('on', on); b.innerHTML = icon(on ? 'volume' : 'mute');
    if (on) TOTO_VOICE.say(chat1([`Hello ${first}! I can talk now.`, 'Testing, testing… can you hear me?', `Hi ${first}, my voice is on.`]), fig);
    else TOTO_VOICE.stop(fig);
  });
  $('#askMic')?.addEventListener('click', () => {
    if (TOTO_VOICE.listening) { TOTO_VOICE.stopListening(); return; }
    TOTO_VOICE.stop(fig);
    if (!TOTO_VOICE.noticeShown()) hello.textContent = 'Listening… 🎙️ (your browser turns speech into text — then I take it from here)';
    else hello.textContent = chat1(['I’m all ears! 👂', 'Go ahead, I’m listening… 🎙️', 'Speak up, I’m listening!']);
    fig.classList.add('is-listen');
    $('#askMic').classList.add('rec');
    TOTO_VOICE.listen({
      onText: (t) => { input.value = t; },
      onDone: (t) => { fig.classList.remove('is-listen'); $('#askMic')?.classList.remove('rec'); if (t && t.trim()) { input.value = ''; ask(t.trim()); } else hello.textContent = 'I didn’t catch that — try again? 🙉'; },
      onError: (msg) => { fig.classList.remove('is-listen'); $('#askMic')?.classList.remove('rec'); hello.textContent = msg; },
    });
  });
  input.focus();
  if (params.q) ask(params.q);
});
