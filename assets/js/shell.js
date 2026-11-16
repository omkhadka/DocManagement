/* Login screen, application shell, notifications and command palette */
'use strict';

const PLANT_SVG = `<svg class="plant" viewBox="0 0 900 420" fill="none" stroke="#9BC33C" stroke-width="1.3" aria-hidden="true">
  <g opacity=".35"><path d="M0 360h900"/><path d="M0 372h900" stroke-dasharray="2 8"/></g>
  <g opacity=".9">
    <circle cx="170" cy="230" r="78"/><path d="M92 230h156M106 192h128M106 268h128" opacity=".45"/>
    <path d="M118 290l-10 70M222 290l10 70M140 300l-4 60M200 300l4 60M100 360h140"/><path d="M170 152v-22h18" opacity=".7"/>
    <circle cx="350" cy="250" r="60"/><path d="M290 250h120M302 220h96M302 280h96" opacity=".45"/>
    <path d="M310 296l-8 64M390 296l8 64M296 360h108"/><path d="M350 190v-18" opacity=".7"/>
  </g>
  <g opacity=".75">
    <path d="M470 360c0-46 20-62 70-62h170c50 0 70 16 70 62"/><path d="M490 360c0-34 16-46 52-46h166c36 0 52 12 52 46" opacity=".5"/>
    <path d="M520 298v-14M600 298v-20h40v20M700 298v-14" /><path d="M600 278h-120v-40h-60" opacity=".7"/>
  </g>
  <g opacity=".6"><path d="M248 230h20v-60h150v-30h70"/><path d="M248 238h28v-60h134v-30h78" opacity=".6"/>
    <rect x="488" y="122" width="60" height="44" rx="3"/><path d="M500 122v-14h36v14M518 108V90"/></g>
  <g opacity=".5"><path d="M790 360V180M790 180l-8 14h16z"/><path d="M790 230h40M790 280h40"/><path d="M786 172c4-14 8-14 8-26 6 8 6 16 2 26"/></g>
  <g opacity=".85"><path d="M600 80h300M640 80v-28h80v28M680 52V20"/><path d="M640 80l-20 40h-60" stroke-dasharray="6 5"/></g>
  <g opacity=".7"><path d="M720 98c40 0 160 2 180 2l-12 26H736z"/><path d="M760 98V70h50v28M776 70V56"/></g>
</svg>`;

function renderLogin(message) {
  setTitle('Sign in');
  app().innerHTML = `<main class="login">
    <section class="login-art">
      <div class="login-brand"><span class="mark logo"><img src="assets/brand/mark.png" alt=""></span>${esc(S.settings.org_name || 'Taifa Gas Investment SEZ Limited')}</div>
      <p class="login-quote">${esc(S.settings.site_name || 'TGISL Knowledge Hub')}<small>${esc(S.settings.welcome_text || '')}</small></p>
      ${PLANT_SVG}
    </section>
    <section class="login-form">
      <span class="login-logo"><img src="assets/brand/logo.jpg" alt="${esc(S.settings.org_name || '')}"></span>
      <h1>Sign in</h1>
      <p class="muted">Use your work email and the password your administrator gave you.</p>
      ${message ? `<div class="alert amber" style="margin-top:18px">${icon('info')}<span>${esc(message)}</span></div>` : ''}
      <form id="loginForm" novalidate>
        <div class="field"><label for="em">Work email</label><input class="input" id="em" type="email" autocomplete="username" required></div>
        <div class="field"><label for="pw">Password</label><input class="input" id="pw" type="password" autocomplete="current-password" required></div>
        <div id="loginErr" class="alert red hidden">${icon('alert')}<span></span></div>
        <button class="btn primary" style="height:44px" type="submit">Sign in</button>
      </form>
      <p class="login-foot">Forgot your password? Ask a platform administrator to reset it.<br>${esc(S.settings.site_name || '')} · v${esc(S.settings.version || '')}</p>
    </section></main>`;
  const f = $('#loginForm');
  setTimeout(() => $('#em').focus(), 20);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = f.querySelector('button');
    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      const r = await api('auth.login', { email: $('#em').value.trim(), password: $('#pw').value });
      S.csrf = r.csrf; S.settings = r.settings;
      if (r.mfa === 'verify') return renderMfaVerify(r);
      if (r.mfa === 'enroll') return renderMfaEnrollGate({ pending: true, rememberDays: r.remember_days });
      S.user = r.user;
      S.dir = S.tax = S.libs = null;
      await startApp();
    } catch (err) {
      const box = $('#loginErr'); box.classList.remove('hidden'); box.querySelector('span').textContent = err.message;
      btn.disabled = false; btn.textContent = 'Sign in';
    }
  };
}

const LIB_ICONS = { drafting: 'drafting', chart: 'chart', handshake: 'handshake', shield: 'shield', book: 'book', wrench: 'wrench', people: 'people', bulb: 'bulb', folder: 'folder' };

async function startApp() {
  if (S.user.mfa_must_enroll) return renderMfaEnrollGate();
  if (S.user.must_change_pw) { renderShell(); await loadLibs(); renderSideLibs(); forcePasswordChange(); return; }
  renderShell();
  try { await loadLibs(); } catch (e) {}
  renderSideLibs();
  refreshCounts();
  navigate();
}

function renderShell() {
  const u = S.user;
  app().innerHTML = `<div class="shell">
    <aside class="side" aria-label="Main navigation">
      <div class="side-head"><span class="mark logo"><img src="assets/brand/mark.png" alt=""></span><div><b>${esc(S.settings.site_name)}</b><span>${esc(S.settings.org_name || '')}</span></div></div>
      <div class="side-scroll">
        <nav class="nav">
          <a href="#/" data-nav="/">${icon('home')}Home</a>
          <a href="#/search" data-nav="/search">${icon('search')}Search</a>
          ${S.settings.approvals ? `<a href="#/approvals" data-nav="/approvals">${icon('stamp')}Approvals<span class="count hot hidden" id="cApprovals"></span></a>` : `<a href="#/my/new" data-nav="/my/new">${icon('clock')}New this week</a>`}
          <a href="#/my/favorites" data-nav="/my/favorites">${icon('star')}Favourites</a>
          <a href="#/my/mine" data-nav="/my/mine">${icon('file')}My documents</a>
          <a href="#/my/recent" data-nav="/my/recent">${icon('clock')}Recent</a>
          <a href="#/people" data-nav="/people">${icon('users')}People</a>
        </nav>
        <div class="nav-label">Libraries ${u.is_admin ? `<button title="New library" data-act="new-lib">${icon('plus', 'sm')}</button>` : ''}</div>
        <nav class="nav" id="sideLibs"></nav>
        <nav class="nav" style="margin-top:6px"><a href="#/recycle" data-nav="/recycle">${icon('trash')}Recycle bin</a></nav>
        ${u.is_admin ? `<div class="nav-label">Administration</div>
        <nav class="nav">
          <a href="#/admin/users" data-nav="/admin/users">${icon('user')}People & access</a>
          <a href="#/admin/libraries" data-nav="/admin/libraries">${icon('folder')}Libraries & permissions</a>
          <a href="#/admin/taxonomy" data-nav="/admin/taxonomy">${icon('tree')}Properties & term store</a>
          <a href="#/admin/ocr" data-nav="/admin/ocr">${icon('sparkle')}Searchable text</a>
          <a href="#/admin/analytics" data-nav="/admin/analytics">${icon('chart')}Analytics</a>
          <a href="#/admin/audit" data-nav="/admin/audit">${icon('activity')}Audit log</a>
          <a href="#/admin/settings" data-nav="/admin/settings">${icon('settings')}Settings</a>
        </nav>` : ''}
      </div>
      <div class="side-foot">
        <a href="#/profile" title="Your profile">${avatar(u.name)}</a>
        <div class="who"><b>${esc(u.name)}</b><span>${esc(u.department || roleName(u.role))}</span></div>
        <button title="Switch light / dark" data-act="theme">${icon(isDark() ? 'sun' : 'moon')}</button>
        <button title="Sign out" data-act="logout">${icon('logout')}</button>
      </div>
    </aside>
    <div class="main">
      <header class="top">
        <button class="icon-btn menu-btn" data-act="menu" aria-label="Open menu">${icon('menu')}</button>
        <button class="search-trigger" data-act="palette">${icon('search')}<span>Search documents, numbers, tags, people…</span><kbd>Ctrl K</kbd></button>
        <div class="top-actions">
          <button class="icon-btn" data-act="upload" title="Upload">${icon('upload')}</button>
          <button class="icon-btn" data-act="notifs" title="Notifications" aria-label="Notifications">${icon('bell')}<span class="dot hidden" id="cUnread"></span></button>
        </div>
      </header>
      <div class="page" id="page"></div>
    </div></div>`;
  const shell = $('.shell');
  shell.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]'); if (!a) return;
    const act = a.dataset.act;
    if (act === 'menu') shell.classList.toggle('nav-open');
    if (act === 'palette') openPalette();
    if (act === 'notifs') toggleNotifs();
    if (act === 'upload') openUpload({});
    if (act === 'new-lib') editLibrary();
    if (act === 'theme') { localStorageSet('km-theme', isDark() ? 'light' : 'dark'); applyTheme(); a.innerHTML = icon(isDark() ? 'sun' : 'moon'); }
    if (act === 'logout') { await api('auth.logout', {}).catch(() => {}); location.hash = ''; S.user = null; const s = await api('auth.session'); S.csrf = s.csrf; renderLogin(); }
  });
  shell.addEventListener('click', (e) => { if (e.target === shell && shell.classList.contains('nav-open')) shell.classList.remove('nav-open'); });
}
function roleName(r) { return { admin: 'Administrator', head: 'Department head', member: 'Member', viewer: 'Viewer' }[r] || r; }

function renderSideLibs() {
  const box = $('#sideLibs'); if (!box) return;
  box.innerHTML = (S.libs || []).map((l) => `<a href="#/lib/${l.id}" data-nav="/lib/${l.id}" title="${esc(l.name)}"><span class="swatch" style="background:${esc(l.color)}"></span><span class="lib-name">${esc(l.name)}</span></a>`).join('')
    || '<div class="faint small" style="padding:6px 10px">No libraries shared with you yet.</div>';
  highlightNav((location.hash.replace(/^#/, '') || '/').split('?')[0]);
}
function highlightNav(path) {
  $$('.nav a').forEach((a) => {
    const n = a.dataset.nav;
    a.classList.toggle('on', n === path || (n !== '/' && path.startsWith(n + '/')) || (n === '/approvals' && path.startsWith('/approvals')));
  });
}

async function refreshCounts() {
  try {
    const c = await api('notifications.count');
    S.counts = c;
    const u = $('#cUnread'), a = $('#cApprovals');
    if (u) { u.textContent = c.unread > 99 ? '99+' : c.unread; u.classList.toggle('hidden', !c.unread); }
    if (a) { a.textContent = c.approvals; a.classList.toggle('hidden', !c.approvals); }
  } catch (e) {}
}
setInterval(() => { if (S.user && document.visibilityState === 'visible' && !document.querySelector('#page .loading')) refreshCounts(); }, 90000);

/* ---------- Notifications ---------- */
async function toggleNotifs() {
  const ex = $('.notif-pop'); if (ex) { ex.remove(); return; }
  const pop = document.createElement('div');
  pop.className = 'notif-pop';
  pop.innerHTML = `<div class="panel-h"><h3>Notifications</h3><button class="btn sm ghost" data-all>Mark all read</button></div><div class="list"><div class="loading"><div class="boot-mark"></div></div></div>`;
  $('.top').appendChild(pop);
  const close = (e) => { if (!pop.contains(e.target) && !e.target.closest('[data-act=notifs]')) { pop.remove(); document.removeEventListener('mousedown', close); } };
  document.addEventListener('mousedown', close);
  const r = await api('notifications.list');
  const list = pop.querySelector('.list');
  list.innerHTML = r.items.length ? r.items.map((n) => `<div class="notif ${n.is_read ? '' : 'unread'}" data-id="${n.id}" data-link="${esc(n.link)}"><span class="d"></span>
    <div><b>${esc(n.title)}</b>${n.body ? `<p>${esc(n.body)}</p>` : ''}<small>${ago(n.created_at)}</small></div></div>`).join('')
    : `<div class="empty">${icon('bell')}<h3>You're all caught up</h3><p>Approvals, comments and mentions will show up here.</p></div>`;
  list.onclick = async (e) => {
    const n = e.target.closest('.notif'); if (!n) return;
    api('notifications.read', { id: +n.dataset.id }).then(refreshCounts);
    pop.remove();
    if (n.dataset.link) location.hash = n.dataset.link.replace(/^#/, '');
  };
  pop.querySelector('[data-all]').onclick = async () => { await api('notifications.read', { all: 1 }); $$('.notif.unread', pop).forEach((x) => x.classList.remove('unread')); refreshCounts(); };
}

/* ---------- Command palette ---------- */
function openPalette(initial = '') {
  if ($('.palette-back')) return;
  const back = document.createElement('div');
  back.className = 'palette-back';
  back.innerHTML = `<div class="palette" role="dialog" aria-label="Quick search"><input placeholder="Search titles, document numbers, tags, people, libraries…" value="${esc(initial)}" aria-label="Search">
    <div class="res"></div><div class="foot"><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span><span style="margin-left:auto">Full search shows content matches</span></div></div>`;
  document.body.appendChild(back);
  const input = $('input', back), res = $('.res', back);
  let items = [], idx = 0;
  const close = () => { back.remove(); document.removeEventListener('keydown', key, true); };
  const actions = [
    { label: 'Upload documents', ico: 'upload', run: () => openUpload({}) },
    S.settings.approvals ? { label: 'Approvals waiting for me', ico: 'stamp', href: '#/approvals' } : { label: 'New this week', ico: 'clock', href: '#/my/new' },
    { label: 'My favourites', ico: 'star', href: '#/my/favorites' },
    { label: 'Documents due for review', ico: 'clock', href: '#/my/review' },
    { label: 'My checked-out documents', ico: 'lock', href: '#/my/checked_out' },
  ];
  const draw = () => {
    res.innerHTML = items.map((it, i) => (it.group ? `<div class="grp">${esc(it.group)}</div>` : '') +
      `<div class="it ${i === idx ? 'on' : ''}" data-i="${i}">${it.html}</div>`).join('') || '<div class="empty small">No quick matches. Press Enter for full search.</div>';
  };
  const build = async () => {
    const q = input.value.trim();
    if (!q) {
      items = actions.map((a, i) => ({ group: i === 0 ? 'Quick actions' : '', html: `${icon(a.ico)}<span class="t">${a.label}</span>`, ...a }));
      idx = 0; draw(); return;
    }
    const r = await api('search.suggest', undefined, { query: { q } });
    if (input.value.trim() !== q) return;
    items = [{ group: '', html: `${icon('search')}<span class="t">Search everything for “${esc(q)}”</span><small>Enter</small>`, href: '#/search?q=' + encodeURIComponent(q) }];
    r.docs.forEach((d, i) => items.push({ group: i === 0 ? 'Documents' : '', html: `${fileIcon(d.ext, 'sm')}<span class="t">${esc(d.title)}</span><small class="mono">${esc(d.doc_number || '')}</small>`, href: '#/doc/' + d.id }));
    r.terms.forEach((t, i) => items.push({ group: i === 0 ? 'Tags' : '', html: `${icon('tag')}<span class="t">${esc(t.label)}</span><small>${esc(t.termset)}</small>`, href: '#/search?terms=' + t.id }));
    r.libraries.forEach((l, i) => items.push({ group: i === 0 ? 'Libraries' : '', html: `<span class="swatch" style="width:10px;height:10px;border-radius:3px;background:${esc(l.color)};margin:0 4px"></span><span class="t">${esc(l.name)}</span>`, href: '#/lib/' + l.id }));
    r.people.forEach((p, i) => items.push({ group: i === 0 ? 'People' : '', html: `${avatar(p.name)}<span class="t">${esc(p.name)}</span><small>${esc(p.department || '')}</small>`, href: '#/person/' + p.id }));
    idx = 0; draw();
  };
  const pick = (it) => { close(); if (!it) return; if (it.run) it.run(); else location.hash = it.href.replace(/^#/, ''); };
  const key = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(items.length - 1, idx + 1); draw(); $('.it.on', res)?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); draw(); $('.it.on', res)?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter') { e.preventDefault(); const q = input.value.trim(); if (!items.length && q) pick({ href: '#/search?q=' + encodeURIComponent(q) }); else pick(items[idx]); }
  };
  document.addEventListener('keydown', key, true);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  res.addEventListener('click', (e) => { const it = e.target.closest('.it'); if (it) pick(items[+it.dataset.i]); });
  input.addEventListener('input', debounce(build, 160));
  build();
  input.focus();
}
document.addEventListener('keydown', (e) => {
  if (!S.user) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
  else if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !$('.modal-back')) { e.preventDefault(); openPalette(); }
});

function forcePasswordChange() {
  const m = modal({ title: 'Choose your own password', locked: true, body: `<p style="margin:0" class="muted">Your account uses a temporary password set by an administrator. Choose your own to continue — you'll only be asked once.</p>
    <div class="field"><label for="cp1">Password you signed in with</label><input class="input" type="password" id="cp1" autocomplete="current-password"></div>
    <div class="field"><label for="cp2">New password (8+ characters)</label><input class="input" type="password" id="cp2" autocomplete="new-password"></div>
    <div class="field"><label for="cp3">Repeat new password</label><input class="input" type="password" id="cp3" autocomplete="new-password"></div>
    <div id="cpErr" class="alert red hidden">${icon('alert')}<span></span></div>`,
    foot: `<button class="btn ghost left" data-out>Sign out</button><button class="btn primary" data-ok>Save password</button>` });
  m.$('[data-close]').remove();
  const err = (msg) => { const b = m.$('#cpErr'); b.classList.remove('hidden'); b.querySelector('span').textContent = msg; };
  const save = async () => {
    const cur = m.$('#cp1').value, n1 = m.$('#cp2').value, n2 = m.$('#cp3').value;
    if (!cur) return err('Enter the password you just signed in with.');
    if (n1.length < 8) return err('Use at least 8 characters for the new password.');
    if (n1 !== n2) return err('The new passwords do not match.');
    if (n1 === cur) return err('Choose a password different from the temporary one.');
    const btn = m.$('[data-ok]'); btn.disabled = true;
    try { await api('auth.change_password', { current: cur, new: n1 }); }
    catch (e) { btn.disabled = false; return err(e.message); }
    S.user.must_change_pw = 0; m.close(); toast('Password saved. You won\'t be asked again.'); refreshCounts(); navigate();
  };
  m.$('[data-ok]').onclick = save;
  m.$('#cp3').addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  m.$('[data-out]').onclick = async () => { await api('auth.logout', {}).catch(() => {}); m.close(); S.user = null; const s = await api('auth.session'); S.csrf = s.csrf; renderLogin(); };
}

/* ---------- Boot ---------- */
async function boot() {
  try {
    const s = await api('auth.session');
    S.csrf = s.csrf; S.settings = s.settings;
    if (s.user) { S.user = s.user; await startApp(); }
    else if (s.mfa === 'verify') renderMfaVerify({});
    else if (s.mfa === 'enroll') renderMfaEnrollGate({ pending: true });
    else renderLogin();
  } catch (e) {
    app().innerHTML = `<div class="empty" style="padding-top:20vh">${icon('alert')}<h3>The Knowledge Hub could not start</h3><p>${esc(e.message)}</p><a class="btn" href="">Try again</a></div>`;
  }
}
