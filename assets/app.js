/* TGISL Knowledge Hub — core: state, API, helpers, icons, dialogs, router */
'use strict';

const S = { user: null, csrf: '', settings: {}, dir: null, tax: null, libs: null, counts: { unread: 0, approvals: 0 } };
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = () => $('#app');

/* ---------------- API ---------------- */
class ApiError extends Error { constructor(msg, status, data) { super(msg); this.status = status; this.data = data; } }

async function api(route, data, opts = {}) {
  const isGet = data === undefined && !opts.post;
  let url = 'api.php?r=' + route;
  const init = { method: isGet ? 'GET' : 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': S.csrf } };
  if (opts.query) url += '&' + qs(opts.query);
  if (!isGet) {
    if (data instanceof FormData) init.body = data;
    else { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(data || {}); }
  }
  let res;
  const attempts = isGet ? 3 : 1;           // only read-only requests are repeated, so nothing is ever saved twice
  for (let i = 0; i < attempts; i++) {
    try { res = await fetch(url, init); break; }
    catch (e) {
      if (i < attempts - 1) { await new Promise((r) => setTimeout(r, 500 * (i + 1) + Math.random() * 300)); continue; }
      throw new ApiError(await whyNoReply(url), 0);
    }
  }
  let json;
  try { json = await res.json(); } catch (e) { throw new ApiError('The server sent an unexpected response (' + res.status + ').', res.status); }
  if (res.status === 401 && route !== 'auth.login') { S.user = null; renderLogin('Your session ended. Sign in again to continue.'); throw new ApiError(json.error, 401); }
  if (res.status === 419 && !opts.retried) {
    const s = await (await fetch('api.php?r=auth.session', { credentials: 'same-origin' })).json();
    S.csrf = s.csrf;
    return api(route, data, { ...opts, retried: true });
  }
  if (res.status === 403 && json.code === 'mfa_enroll' && S.user) { S.user.mfa_must_enroll = true; renderMfaEnrollGate(); throw new ApiError(json.error, 403, json); }
  if (!json.ok) throw new ApiError(json.error || 'Request failed.', res.status, json);
  return json;
}
/* Records security-policy blocks so a failed request can say why. */
let lastBlock = null;
document.addEventListener('securitypolicyviolation', (e) => { lastBlock = { uri: e.blockedURI, at: Date.now() }; });

/** Works out why a request got no reply, for a clearer message. */
async function whyNoReply(url) {
  if (navigator.onLine === false) return 'You appear to be offline. Check your internet connection, then try again.';
  if (lastBlock && Date.now() - lastBlock.at < 5000) return `The server redirected the request to ${lastBlock.uri || 'another address'}, so the browser stopped it. This is usually the hosting security filter (Imunify360/ModSecurity) — ask the host to whitelist km.arginternational.ae/api.php.`;
  try {
    const probe = await fetch(url, { credentials: 'same-origin', redirect: 'manual', headers: { 'X-CSRF-Token': S.csrf } });
    if (probe.type === 'opaqueredirect') return 'The server answered with a redirect instead of data. This is usually the hosting security filter (Imunify360/ModSecurity) — ask the host to whitelist km.arginternational.ae/api.php.';
    if (probe.ok) return 'The connection dropped for a moment. Try again.';
    return `The server returned an error (${probe.status}). Try again, or check cPanel → Metrics → Errors.`;
  } catch (e) {
    return 'The server did not reply (the connection was closed). Try again in a moment. If it keeps happening, check cPanel → Metrics → Resource Usage for limits being hit.';
  }
}

function qs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) v.forEach((x) => p.append(k + '[]', x));
    else if (typeof v === 'object') for (const [k2, v2] of Object.entries(v)) { if (v2 !== '' && v2 != null) p.append(`${k}[${k2}]`, v2); }
    else p.append(k, v);
  }
  return p.toString();
}
async function run(promise, okMsg) {
  try { const r = await promise; if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg); return r; }
  catch (e) { toast(e.message, 'err'); throw e; }
}

/* ---------------- Formatting ---------------- */
function parseDate(s) { if (!s) return null; return new Date(String(s).replace(' ', 'T')); }
function fmtDate(s, withTime) {
  const d = parseDate(s); if (!d || isNaN(d)) return '';
  const o = { day: 'numeric', month: 'short', year: 'numeric' };
  if (withTime) Object.assign(o, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleString('en-GB', o);
}
function ago(s) {
  const d = parseDate(s); if (!d || isNaN(d)) return '';
  const sec = (Date.now() - d.getTime()) / 1000;
  if (sec < 60) return 'just now';
  if (sec < 3600) return Math.floor(sec / 60) + ' min ago';
  if (sec < 86400) return Math.floor(sec / 3600) + ' h ago';
  if (sec < 86400 * 7) { const n = Math.floor(sec / 86400); return n === 1 ? 'yesterday' : n + ' days ago'; }
  return fmtDate(s);
}
function fmtSize(b) { b = +b || 0; if (b < 1024) return b + ' B'; if (b < 1048576) return (b / 1024).toFixed(0) + ' KB'; if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB'; return (b / 1073741824).toFixed(2) + ' GB'; }
const plural = (n, w, pl) => `${n} ${n === 1 ? w : (pl || w + 's')}`;
/** Local calendar date as YYYY-MM-DD, optionally some days / months from today. */
function localISODate(addDays = 0, addMonths = 0) {
  const d = new Date(); d.setMonth(d.getMonth() + addMonths); d.setDate(d.getDate() + addDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function initials(n) { return String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase(); }
const AV_COLORS = ['#1479B8', '#2F6FB0', '#5B4FA8', '#B5532C', '#2E8B57', '#A33A6B', '#8A5A00', '#3D5A80', '#6B4E3D', '#C0392B'];
function avatar(name, cls = '') { let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return `<span class="av ${cls}" style="background:${AV_COLORS[h % AV_COLORS.length]}" aria-hidden="true">${esc(initials(name))}</span>`; }
const LEVELS = { 0: 'No access', 1: 'Read', 2: 'Contribute', 3: 'Approve', 4: 'Full control' };
const STATUS = { draft: 'Draft', pending: 'Pending approval', published: 'Published', rejected: 'Changes requested' };
const statusTag = (s) => `<span class="status ${s}">${STATUS[s] || s}</span>`;
const stamp = (s, sub = '', big = false) => `<span class="stamp ${s} ${big ? 'big' : ''}" data-sub="${esc(sub)}">${{ draft: 'DRAFT', pending: 'IN REVIEW', published: S.settings.approvals ? 'APPROVED' : 'PUBLISHED', rejected: 'RETURNED' }[s] || s}</span>`;
const CONF_HELP = {
  public: 'Public — anyone who can open this library can see it. Fine to share outside the company.',
  internal: 'Internal — anyone who can open this library can see it. Not for sharing outside TGISL.',
  confidential: 'Confidential — only the author, the library’s owning department, approvers, contributors and people you name can see it. Others won’t find it in lists or search.',
  restricted: 'Restricted — only you, administrators and people you name under Permissions can see it. Use for salaries, legal and board matters.',
};
const isSensitive = (c) => c === 'confidential' || c === 'restricted';
function watermark(c) {
  const t = `${c.toUpperCase()} · ${S.user?.name || ''} · ${new Date().toLocaleDateString('en-GB')}`;
  return `<div class="wm" aria-hidden="true">${Array.from({ length: 36 }, () => `<span>${esc(t)}</span>`).join('')}</div>`;
}
const conf = (c) => `<span class="conf ${c}">${c.charAt(0).toUpperCase() + c.slice(1)}</span>`;
function highlight(text, words) {
  let out = esc(text);
  (words || []).filter((w) => w && w.length > 1).forEach((w) => {
    const re = new RegExp('(' + esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    out = out.replace(re, '<mark>$1</mark>');
  });
  return out;
}

/* ---------------- Icons ---------------- */
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
  'folder-plus': '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/><path d="M12 11v6M9 14h6"/>',
  upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  download: '<path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  shield: '<path d="M12 3 5 6v5.5c0 4.3 3 7.7 7 9.5 4-1.8 7-5.2 7-9.5V6z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 7.6-1.7"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6.5 6.5 0 0 1 3.5 6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
  tree: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="12" r="2"/><circle cx="18" cy="19" r="2"/><path d="M6 7v10a2 2 0 0 0 2 2h8M6 10a2 2 0 0 0 2 2h8"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
  inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5 5h14l2 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z"/>',
  stamp: '<path d="M9.5 3h5l-1 8h-3z"/><path d="M5 14h14v4H5zM4 21h16"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5M5 12h11"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14 9l2 2"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  message: '<path d="M4 5h16v11H9l-5 4z"/>',
  activity: '<path d="M3 12h4l3 8 4-16 3 8h4"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  book: '<path d="M4 19.5V5a2 2 0 0 1 2-2h14v16H6.5a2.5 2.5 0 0 0 0 5H20"/>',
  drafting: '<path d="M12 3v3"/><circle cx="12" cy="8" r="2"/><path d="m10.8 9.7-5.3 10.8M13.2 9.7l5.3 10.8M7 16h10"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>',
  handshake: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6.5 6.5 0 0 1 3.5 6"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  filter: '<path d="M3 5h18l-7 8.5V20l-4-2v-4.5z"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5L3 9"/><path d="M3 4v5h5"/><path d="M4 13a8 8 0 0 0 14.6 4.5L21 15"/><path d="M21 20v-5h-5"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 9v5M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  compare: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M6 8.5V15a3 3 0 0 0 3 3h6.5M18 15.5V9a3 3 0 0 0-3-3H8.5"/>',
  megaphone: '<path d="M3 10v4h4l7 5V5L7 10z"/><path d="M18 9a4 4 0 0 1 0 6"/>',
  building: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  badge: '<circle cx="12" cy="9" r="5"/><path d="M8.5 13 7 21l5-3 5 3-1.5-8"/>',
  sparkle: '<path d="M12 3c.6 4.2 2.8 6.4 7 7-4.2.6-6.4 2.8-7 7-.6-4.2-2.8-6.4-7-7 4.2-.6 6.4-2.8 7-7z"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  plant: '<circle cx="12" cy="9.5" r="5.5"/><path d="M6.5 9.5h11M8.5 14 7.5 20.5M15.5 14l1 6.5M5 20.5h14"/>',
  file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/>',
  move: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/><path d="M9 14h6M13 11.5l2.5 2.5-2.5 2.5"/>',
  send: '<path d="M21 3 3 10.5l7 3 3 7z"/><path d="m10 13.5 4-4"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  chart2: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
};
function icon(name, cls = '') { return `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.file}</svg>`; }

const EXT_COLORS = { pdf: '#C8443A', doc: '#2F6FB0', docx: '#2F6FB0', odt: '#2F6FB0', rtf: '#2F6FB0', xls: '#2E8B57', xlsx: '#2E8B57', xlsm: '#2E8B57', csv: '#2E8B57', ods: '#2E8B57',
  ppt: '#B5532C', pptx: '#B5532C', odp: '#B5532C', jpg: '#5B4FA8', jpeg: '#5B4FA8', png: '#5B4FA8', gif: '#5B4FA8', webp: '#5B4FA8', svg: '#5B4FA8',
  dwg: '#0F7C7A', dxf: '#0F7C7A', zip: '#3D5A80', rar: '#3D5A80', '7z': '#3D5A80', msg: '#3A7CA5', eml: '#3A7CA5', mp4: '#A33A6B', mp3: '#A33A6B', mpp: '#2E8B57', xer: '#8A5A00', vsdx: '#3A7CA5' };
function fileIcon(ext, cls = '') {
  const e = String(ext || '').toLowerCase();
  const c = EXT_COLORS[e] || '#6B7C83';
  return `<span class="ficon ${cls}" aria-hidden="true"><svg viewBox="0 0 34 40"><path d="M3 2.5A1.5 1.5 0 0 1 4.5 1H22l9 9v27.5a1.5 1.5 0 0 1-1.5 1.5h-25A1.5 1.5 0 0 1 3 37.5z" fill="${c}" opacity=".14"/><path d="M3 2.5A1.5 1.5 0 0 1 4.5 1H22l9 9v27.5a1.5 1.5 0 0 1-1.5 1.5h-25A1.5 1.5 0 0 1 3 37.5z" fill="none" stroke="${c}" stroke-width="1.4"/><path d="M22 1v7.5A1.5 1.5 0 0 0 23.5 10H31" fill="none" stroke="${c}" stroke-width="1.4"/><rect x="3" y="25" width="28" height="10" fill="${c}"/></svg><span>${esc(e.slice(0, 4).toUpperCase() || 'FILE')}</span></span>`;
}

/* ---------------- Toasts & dialogs ---------------- */
function toast(msg, type = '', ms = 4200) {
  const t = document.createElement('div');
  t.className = 'toast ' + (type === 'err' ? 'err' : '');
  t.innerHTML = (type === 'err' ? icon('alert', 'sm') : icon('check', 'sm')) + `<span>${msg instanceof Node ? '' : (type === 'html' ? msg : esc(msg))}</span>`;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), ms);
}

function modal({ title, body = '', foot = '', size = '', onClose, locked = false }) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-h"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
    <div class="modal-b">${body}</div>${foot ? `<div class="modal-f">${foot}</div>` : ''}</div>`;
  const prevFocus = document.activeElement;
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); onClose && onClose(); prevFocus && prevFocus.focus && prevFocus.focus(); };
  const onKey = (e) => { if (!locked && e.key === 'Escape' && document.body.lastElementChild === back) close(); };
  back.addEventListener('mousedown', (e) => { if (!locked && e.target === back) close(); });
  back.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(back);
  setTimeout(() => { const f = back.querySelector('input:not([type=hidden]):not([type=checkbox]),textarea,select'); (f || back.querySelector('.modal')).focus?.(); }, 30);
  return { el: back, close, $: (s) => back.querySelector(s), $$: (s) => Array.from(back.querySelectorAll(s)) };
}

function confirmBox(text, { title = 'Are you sure?', ok = 'Confirm', danger = false, detail = '' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({ title, body: `<p style="margin:0">${esc(text)}</p>${detail}`,
      foot: `<button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'danger solid' : 'primary'}" data-ok>${esc(ok)}</button>`,
      onClose: () => { if (!done) resolve(false); } });
    m.$('[data-ok]').onclick = () => { done = true; m.close(); resolve(true); };
  });
}

function promptBox({ title, label, value = '', ok = 'Save', textarea = false, required = true, hint = '' }) {
  return new Promise((resolve) => {
    let done = false;
    const inp = textarea ? `<textarea class="input" id="pv">${esc(value)}</textarea>` : `<input class="input" id="pv" value="${esc(value)}">`;
    const m = modal({ title, body: `<div class="field"><label for="pv">${esc(label)}</label>${inp}${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</div>`,
      foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>${esc(ok)}</button>`, onClose: () => { if (!done) resolve(null); } });
    const go = () => { const v = m.$('#pv').value.trim(); if (required && !v) { m.$('#pv').focus(); return; } done = true; m.close(); resolve(v); };
    m.$('[data-ok]').onclick = go;
    if (!textarea) m.$('#pv').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });
}

/* ---------------- Shared data ---------------- */
async function loadDir(force) { if (!S.dir || force) S.dir = await api('users.directory'); return S.dir; }
async function loadTax(force) { if (!S.tax || force) S.tax = await api('taxonomy.get'); return S.tax; }
async function loadLibs(force) { if (!S.libs || force) S.libs = (await api('libraries.list')).libraries; return S.libs; }
function termIndex() {
  const idx = {};
  (S.tax?.termsets || []).forEach((s) => s.terms.forEach((t) => { idx[t.id] = { ...t, set: s }; }));
  return idx;
}
function termPath(id, idx) { const out = []; let t = idx[id]; while (t) { out.unshift(t.label); t = t.parent_id ? idx[t.parent_id] : null; } return out.join(' › '); }

/* ---------------- Router ---------------- */
const ROUTES = [];
function route(pattern, handler) { ROUTES.push({ re: new RegExp('^' + pattern + '$'), handler }); }
let currentCleanup = null;
async function navigate() {
  if (!S.user) return;
  const hash = location.hash.replace(/^#/, '') || '/';
  const [path, query] = hash.split('?');
  const params = Object.fromEntries(new URLSearchParams(query || ''));
  if (currentCleanup) { try { currentCleanup(); } catch (e) {} currentCleanup = null; }
  document.querySelector('.shell')?.classList.remove('nav-open');
  $$('.modal-back, .palette-back, .notif-pop').forEach((x) => x.remove());
  for (const r of ROUTES) {
    const m = path.match(r.re);
    if (m) {
      highlightNav(path);
      const old = $('#page'); const page = old.cloneNode(false); old.replaceWith(page);
      page.innerHTML = '<div class="loading"><div class="boot-mark"></div></div>';
      try { currentCleanup = (await r.handler(page, m.slice(1), params)) || null; }
      catch (e) {
        if (e.status === 401 || (e.status === 403 && e.data?.code === 'mfa_enroll')) return;
        page.innerHTML = `<div class="empty">${icon('alert')}<h3>That didn't load</h3><p>${esc(e.message)}</p><div class="btn-row" style="justify-content:center"><button class="btn primary" data-retry>${icon('refresh', 'sm')}Try again</button><a class="btn" href="#/">Go to home</a></div></div>`;
        page.querySelector('[data-retry]').onclick = () => navigate();
      }
      window.scrollTo(0, 0);
      return;
    }
  }
  $('#page').innerHTML = `<div class="empty">${icon('search')}<h3>Page not found</h3><p>The link may be old.</p><a class="btn" href="#/">Go to home</a></div>`;
}
window.addEventListener('hashchange', navigate);
const go = (h) => { if (location.hash === h) navigate(); else location.hash = h; };

function setTitle(t) { document.title = (t ? t + ' · ' : '') + (S.settings.site_name || 'Knowledge Hub'); }
function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/* Theme */
function applyTheme() { const t = localStorageGet('km-theme'); if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }
function localStorageGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function localStorageSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} }
function isDark() { const t = document.documentElement.dataset.theme; return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; }
applyTheme();
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
/* Drawing-office visual language: ink seals & stamps, revision triangles, drawing-sheet frame, annotated home drawing.
   Everything is inline SVG, so it themes with CSS and needs no images. */
'use strict';

/* Ink texture filter, defined once for the whole page. */
function ensureInkDefs() {
  if (document.getElementById('km-ink-defs')) return;
  const d = document.createElement('div');
  d.id = 'km-ink-defs';
  d.setAttribute('aria-hidden', 'true');
  d.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  d.innerHTML = `<svg width="0" height="0"><defs>
    <filter id="km-ink" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="4" result="grain"/>
      <feDisplacementMap in="SourceGraphic" in2="grain" scale="1.3" xChannelSelector="R" yChannelSelector="G" result="rough"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.28" numOctaves="2" seed="11" result="blot"/>
      <feColorMatrix in="blot" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.25 1.42" result="mask"/>
      <feComposite in="rough" in2="mask" operator="in"/>
    </filter></defs></svg>`;
  document.body.appendChild(d);
}

const stampTilt = (seed) => (((Number(seed) || 7) * 37) % 11) - 5;   // −5…+5°, the same every time for a document
let sealSeq = 0;

/** Round company seal: "TGISL · DOCUMENT CONTROL" ring, APPROVED band, initials and date. */
function seal({ date = '', by = '', seed = 1, size = 116, press = false, word = 'APPROVED' } = {}) {
  ensureInkDefs();
  const id = 'sealring' + (++sealSeq);
  const dt = date ? parseDate(date) : null;
  const dateTxt = dt ? dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase() : '';
  const ini = initials(by);
  return `<span class="seal ${press ? 'press' : ''}" style="--tilt:${stampTilt(seed)}deg" role="img" aria-label="${word === 'APPROVED' ? 'Approved' : 'Published'}${by ? ' by ' + esc(by) : ''}${dateTxt ? ' on ' + esc(dateTxt) : ''}">
    <svg viewBox="0 0 120 120" width="${size}" height="${size}" aria-hidden="true">
      <g filter="url(#km-ink)" fill="none" stroke="currentColor">
        <circle cx="60" cy="60" r="56.5" stroke-width="3.2"/>
        <circle cx="60" cy="60" r="51.5" stroke-width="1"/>
        <circle cx="60" cy="60" r="38" stroke-width="1.4"/>
        <path id="${id}" d="M60,60 m-44.5,0 a44.5,44.5 0 1,1 89,0 a44.5,44.5 0 1,1 -89,0" stroke="none"/>
        <text fill="currentColor" stroke="none" font-size="8.4" font-weight="700" letter-spacing="1.35" font-family="Instrument Sans, sans-serif">
          <textPath href="#${id}" startOffset="0">TGISL ★ DOCUMENT CONTROL ★ KNOWLEDGE HUB ★</textPath></text>
        <rect x="9" y="49" width="102" height="22" fill="var(--surface)" stroke-width="2"/>
        <rect x="12" y="52" width="96" height="16" stroke-width=".8"/>
        <text x="60" y="65" text-anchor="middle" fill="currentColor" stroke="none" font-size="${word.length > 8 ? 12.2 : 13.5}" font-weight="800" letter-spacing="${word.length > 8 ? 1.6 : 2.2}" font-family="Instrument Sans, sans-serif">${esc(word)}</text>
        <text x="60" y="42" text-anchor="middle" fill="currentColor" stroke="none" font-size="10" font-weight="700" letter-spacing="1" font-family="JetBrains Mono, monospace">${esc(ini || '—')}</text>
        <text x="60" y="84" text-anchor="middle" fill="currentColor" stroke="none" font-size="7.6" font-weight="700" letter-spacing=".6" font-family="JetBrains Mono, monospace">${esc(dateTxt)}</text>
      </g>
    </svg></span>`;
}

/** Rectangular rubber stamp. kind: draft | pending | rejected | confidential | restricted */
function rectStamp(kind, { sub = '', seed = 1, size = 150 } = {}) {
  ensureInkDefs();
  const t = { draft: ['DRAFT', 'NOT FOR USE'], pending: ['IN REVIEW', sub || 'AWAITING APPROVAL'], rejected: ['RETURNED', 'FOR CHANGES'],
    confidential: ['CONFIDENTIAL', 'TGISL'], restricted: ['RESTRICTED', 'NAMED ACCESS ONLY'] }[kind] || [String(kind).toUpperCase(), sub];
  const dash = kind === 'draft' ? 'stroke-dasharray="5 3"' : '';
  return `<span class="rstamp ${kind}" style="--tilt:${stampTilt(seed) * 0.8}deg" role="img" aria-label="${esc(t[0])}">
    <svg viewBox="0 0 160 58" width="${size}" height="${size * 58 / 160}" aria-hidden="true"><g filter="url(#km-ink)" fill="none" stroke="currentColor">
      <rect x="2.5" y="2.5" width="155" height="53" rx="5" stroke-width="3" ${dash}/>
      <rect x="7" y="7" width="146" height="44" rx="2.5" stroke-width="1"/>
      <text x="80" y="31" text-anchor="middle" fill="currentColor" stroke="none" font-size="${t[0].length > 9 ? 16 : 19}" font-weight="800" letter-spacing="2.4" font-family="Instrument Sans, sans-serif">${esc(t[0])}</text>
      <text x="80" y="44" text-anchor="middle" fill="currentColor" stroke="none" font-size="7.4" font-weight="700" letter-spacing="1.6" font-family="JetBrains Mono, monospace">${esc(t[1] || '')}</text>
    </g></svg></span>`;
}

/** The stamp for a document's state; approved documents get the seal. */
function docStamp(d, approvals = [], opts = {}) {
  if (d.status === 'published') return seal({ date: d.published_at || d.modified, by: d.published_by || '', seed: d.id, word: S.settings.approvals ? 'APPROVED' : 'PUBLISHED', ...opts });
  if (d.status === 'pending') return rectStamp('pending', { seed: d.id, size: opts.size ? opts.size * 1.25 : 150 });
  if (d.status === 'rejected') return rectStamp('rejected', { seed: d.id, size: opts.size ? opts.size * 1.25 : 150 });
  return rectStamp('draft', { seed: d.id, size: opts.size ? opts.size * 1.25 : 150 });
}

/** Revision triangle (drawing convention) holding the version label. */
function revDelta(label, cls = '') {
  const l = String(label || '');
  return `<span class="rev ${cls}" title="Revision ${esc(l)}"><svg viewBox="0 0 44 30" aria-hidden="true"><path d="M22 2 42 28H2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    <text x="22" y="24.5" text-anchor="middle" font-size="${l.length > 4 ? 7.6 : 9}" font-weight="700" fill="currentColor" font-family="JetBrains Mono, monospace">${esc(l)}</text></svg></span>`;
}

/** Drawing-sheet frame with grid references around a preview. */
function sheetFrame(inner) {
  const cols = 'ABCDEFGH'.split(''), rows = ['1', '2', '3', '4', '5', '6'];
  const r = (arr, cls) => `<div class="sheet-ref ${cls}">${arr.map((x) => `<span>${x}</span>`).join('')}</div>`;
  return `<div class="sheet">${r(cols, 'sr-t')}${r(cols, 'sr-b')}${r(rows, 'sr-l')}${r(rows, 'sr-r')}<div class="sheet-in">${inner}</div></div>`;
}
/* Two-step verification: sign-in code step, set-up with QR code, recovery codes, profile panel */
'use strict';

/* ---------- QR code (assets/qrcode.js, MIT, bundled locally) ---------- */
function qrSvg(text, px = 200) {
  if (typeof qrcode !== 'function') return '<div class="faint small">QR code unavailable — use the key below.</div>';
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  const n = q.getModuleCount(), m = 4, size = n + m * 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
  return `<svg viewBox="0 0 ${size} ${size}" width="${px}" height="${px}" shape-rendering="crispEdges" role="img" aria-label="QR code for your authenticator app"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#0E2A3B"/></svg>`;
}
const groupKey = (k) => k.replace(/(.{4})/g, '$1 ').trim();

function otpInput(id = 'otp') {
  return `<input class="input otp" id="${id}" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="7" placeholder="000000" aria-label="6-digit code">`;
}
/** Keeps an OTP box to digits and calls onFull when 6 digits are entered. */
function wireOtp(input, onFull) {
  input.addEventListener('input', () => {
    if (input.dataset.mode === 'recovery') return;
    input.value = input.value.replace(/\D/g, '').slice(0, 6);
    if (input.value.length === 6) onFull();
  });
}

/* ---------- Sign-in, step 2 ---------- */
function loginPanel(html) {
  if (!$('.login-form')) renderLogin();
  const p = $('.login-form');
  p.innerHTML = html;
  return p;
}

function renderMfaVerify(opts = {}) {
  setTitle('Two-step verification');
  const days = opts.remember_days ?? 30;
  const p = loginPanel(`
    <h1>Enter your code</h1>
    <p class="muted">${opts.name ? esc(opts.name.split(' ')[0]) + ', open' : 'Open'} Google Authenticator on your phone and enter the 6-digit code shown for <b>${esc(S.settings.site_name)}</b>.</p>
    <form id="mfaForm" class="mfa-form" novalidate>
      <div class="field"><label for="otp" id="otpLabel">Authenticator code</label>${otpInput()}<span class="hint" id="otpHint">The code changes every 30 seconds.</span></div>
      ${days > 0 ? `<label class="check"><input type="checkbox" id="mfaRemember"><span>Trust this device for ${days} days<br><span class="small muted">Don't tick this on a shared or public computer.</span></span></label>` : ''}
      <div id="mfaErr" class="alert red hidden">${icon('alert')}<span></span></div>
      <button class="btn primary" style="height:44px" type="submit">Verify</button>
      <div class="mfa-links"><button type="button" class="linklike" id="useRecovery">Use a recovery code instead</button><button type="button" class="linklike" id="mfaBack">Back to sign in</button></div>
    </form>
    <p class="login-foot">Lost your phone and your recovery codes? Ask a platform administrator to reset two-step verification for your account.</p>`);
  const f = $('#mfaForm', p), inp = $('#otp', p), btn = f.querySelector('button[type=submit]');
  setTimeout(() => inp.focus(), 20);
  const submit = async () => {
    if (btn.disabled) return;
    const code = inp.value.trim();
    if (!code) return inp.focus();
    btn.disabled = true; btn.textContent = 'Checking…';
    try {
      const r = await api('auth.mfa_verify', { code, remember: $('#mfaRemember', p)?.checked ? 1 : 0 });
      S.user = r.user; S.csrf = r.csrf; S.settings = r.settings; S.dir = S.tax = S.libs = null;
      await startApp();
    } catch (err) {
      if (err.status === 440 || err.status === 429) return renderLogin(err.message);
      const box = $('#mfaErr', p); box.classList.remove('hidden'); box.querySelector('span').textContent = err.message;
      btn.disabled = false; btn.textContent = 'Verify'; inp.value = ''; inp.focus();
    }
  };
  f.onsubmit = (e) => { e.preventDefault(); submit(); };
  wireOtp(inp, submit);
  $('#useRecovery', p).onclick = (e) => {
    const rec = inp.dataset.mode !== 'recovery';
    inp.dataset.mode = rec ? 'recovery' : '';
    inp.value = ''; inp.maxLength = rec ? 12 : 7; inp.placeholder = rec ? 'xxxx-xxxx' : '000000';
    inp.inputMode = rec ? 'text' : 'numeric'; inp.classList.toggle('otp', !rec); inp.classList.toggle('mono', rec);
    $('#otpLabel', p).textContent = rec ? 'Recovery code' : 'Authenticator code';
    $('#otpHint', p).textContent = rec ? 'Each recovery code works once.' : 'The code changes every 30 seconds.';
    e.target.textContent = rec ? 'Use the authenticator app instead' : 'Use a recovery code instead';
    inp.focus();
  };
  $('#mfaBack', p).onclick = async () => { await api('auth.mfa_cancel', {}).catch(() => {}); renderLogin(); };
}

/* ---------- Set-up (used at sign-in and from the profile page) ---------- */
async function mfaSetupFlow(host, { pending = false, rememberDays = 0, onDone } = {}) {
  host.innerHTML = '<div class="loading"><div class="boot-mark"></div></div>';
  let r;
  try { r = await api('auth.mfa_setup_begin', {}); }
  catch (e) { if (e.status === 401) return; host.innerHTML = `<div class="alert red">${icon('alert')}<span>${esc(e.message)}</span></div>`; return; }
  host.innerHTML = `
    <ol class="mfa-steps">
      <li><b>Install an authenticator app</b><span>Google Authenticator from the App Store or Google Play. Microsoft Authenticator also works.</span></li>
      <li><b>Scan this QR code</b><span>In the app tap <b>+</b> → <b>Scan a QR code</b>.</span>
        <div class="qr-wrap"><div class="qr-box">${qrSvg(r.uri)}</div>
          <div class="qr-alt"><span class="small muted">Can't scan? Choose <b>Enter a setup key</b> and type:</span>
            <code class="secret" id="mfaSecret">${esc(groupKey(r.secret))}</code>
            <span class="small muted">Account: ${esc(r.account)} · Time based</span>
            <button type="button" class="btn sm" id="copyKey">${icon('link', 'sm')}Copy key</button></div></div></li>
      <li><b>Enter the 6-digit code from the app</b>
        <div class="mfa-confirm">${otpInput('setupOtp')}<button type="button" class="btn primary" id="setupGo">Turn on</button></div>
        ${pending && rememberDays > 0 ? `<label class="check" style="margin-top:10px"><input type="checkbox" id="setupRemember"><span>Trust this device for ${rememberDays} days</span></label>` : ''}
        <div id="setupErr" class="alert red hidden" style="margin-top:10px">${icon('alert')}<span></span></div></li>
    </ol>`;
  const inp = $('#setupOtp', host), go = $('#setupGo', host);
  $('#copyKey', host).onclick = () => { navigator.clipboard?.writeText(r.secret).then(() => toast('Key copied.')); };
  const confirm = async () => {
    if (go.disabled) return;
    if (inp.value.length !== 6) return inp.focus();
    go.disabled = true; go.textContent = 'Checking…';
    try {
      const res = await api('auth.mfa_setup_confirm', { code: inp.value, remember: $('#setupRemember', host)?.checked ? 1 : 0 });
      if (res.user) { S.user = res.user; S.csrf = res.csrf; S.settings = res.settings; S.dir = S.tax = S.libs = null; }
      showRecoveryCodes(host, res.codes, { onContinue: onDone, first: true });
    } catch (e) {
      if (e.status === 401) return;
      const box = $('#setupErr', host); box.classList.remove('hidden'); box.querySelector('span').textContent = e.message;
      go.disabled = false; go.textContent = 'Turn on'; inp.value = ''; inp.focus();
      if (e.status === 409 || e.status === 429) setTimeout(() => mfaSetupFlow(host, { pending, rememberDays, onDone }), 1800);
    }
  };
  wireOtp(inp, confirm);
  go.onclick = confirm;
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirm(); });
  setTimeout(() => inp.focus(), 30);
}

function showRecoveryCodes(host, codes, { onContinue, first = false } = {}) {
  const text = `${S.settings.site_name} — recovery codes\nAccount: ${S.user?.email || ''}\nCreated: ${new Date().toLocaleString('en-GB')}\n\n` +
    codes.join('\n') + '\n\nEach code can be used once instead of an authenticator code. Keep them somewhere safe.\n';
  host.innerHTML = `
    ${first ? `<div class="alert teal">${icon('check')}<div class="grow"><b>Two-step verification is on</b>From now on you'll enter a code from your phone after your password.</div></div>` : ''}
    <div><h3 style="margin-bottom:6px">Save your recovery codes</h3>
    <p class="muted small" style="margin:0">If you lose your phone, each of these codes lets you sign in once. They're shown only now — download or print them and keep them somewhere safe, away from your phone.</p></div>
    <div class="codes-grid">${codes.map((c) => `<code>${esc(c)}</code>`).join('')}</div>
    <div class="btn-row"><button type="button" class="btn" id="dlCodes">${icon('download', 'sm')}Download .txt</button><button type="button" class="btn" id="cpCodes">${icon('link', 'sm')}Copy</button><button type="button" class="btn" id="prCodes">${icon('file', 'sm')}Print</button></div>
    <label class="check"><input type="checkbox" id="ackCodes"><span>I've saved my recovery codes</span></label>
    <button type="button" class="btn primary" id="codesDone" disabled style="height:42px">Continue</button>`;
  $('#dlCodes', host).onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = 'TGISL-KM-recovery-codes.txt'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $('#cpCodes', host).onclick = () => navigator.clipboard?.writeText(text).then(() => toast('Recovery codes copied.'));
  $('#prCodes', host).onclick = () => {
    const w = window.open('', '_blank', 'width=480,height=640');
    if (!w) return toast('Allow pop-ups to print, or use Download.', 'err');
    w.document.write(`<pre style="font:15px/1.7 monospace;padding:24px">${esc(text)}</pre>`); w.document.close(); w.focus(); w.print();
  };
  $('#ackCodes', host).onchange = (e) => { $('#codesDone', host).disabled = !e.target.checked; };
  $('#codesDone', host).onclick = () => onContinue && onContinue();
}

/** Full-page set-up when the organisation requires it (at sign-in, or for someone already signed in). */
function renderMfaEnrollGate({ pending = false, rememberDays = 0 } = {}) {
  setTitle('Set up two-step verification');
  const p = loginPanel(`
    <h1>Set up two-step verification</h1>
    <p class="muted">${esc(S.settings.site_name)} requires a second step for your account. After your password you'll enter a code from an app on your phone, so a stolen password alone can't open the documents.</p>
    <div id="mfaSetupHost" class="mfa-setup"></div>
    <div class="mfa-links" style="margin-top:14px"><button type="button" class="linklike" id="mfaGateOut">${pending ? 'Back to sign in' : 'Sign out'}</button></div>`);
  p.classList.add('wide');
  $('#mfaGateOut', p).onclick = async () => {
    if (pending) await api('auth.mfa_cancel', {}).catch(() => {}); else await api('auth.logout', {}).catch(() => {});
    S.user = null; const s = await api('auth.session'); S.csrf = s.csrf; renderLogin();
  };
  mfaSetupFlow($('#mfaSetupHost', p), {
    pending, rememberDays,
    onDone: async () => { if (S.user) { S.user.mfa_enabled = 1; S.user.mfa_must_enroll = false; } location.hash = ''; await startApp(); },
  });
}

/* ---------- Profile panel ---------- */
async function mfaProfilePanel(host) {
  const st = await api('auth.mfa_status');
  const devs = st.devices || [];
  const browser = (ua) => { ua = ua || ''; const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser'; const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone / iPad' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : ''; return b + (os ? ' on ' + os : ''); };
  host.innerHTML = `<div class="panel-h"><h3>Two-step verification</h3>${st.enabled ? '<span class="pill" style="color:var(--green)">' + icon('shield', 'sm') + 'On</span>' : '<span class="pill">Off</span>'}</div>
    <div class="panel-b" style="display:grid;gap:14px">
    ${st.enabled ? `
      <p class="muted small" style="margin:0">On since ${esc(fmtDate(st.enabled_at))}. After your password you enter a code from your authenticator app.${st.required ? ' Required for your role.' : ''}</p>
      <dl class="kv"><dt>Recovery codes</dt><dd>${st.recovery_left} unused${st.recovery_left <= 3 ? ' <span style="color:var(--amber)">· running low</span>' : ''}</dd>
        <dt>Trusted devices</dt><dd>${devs.length ? devs.map((d) => `${esc(browser(d.user_agent))} <span class="faint small">· until ${esc(fmtDate(d.expires_at))}</span>`).join('<br>') : '<span class="faint">None</span>'}</dd></dl>
      <div class="btn-row"><button class="btn" id="mfaNewCodes">${icon('refresh', 'sm')}New recovery codes</button>
        ${devs.length ? `<button class="btn" id="mfaForget">${icon('x', 'sm')}Forget trusted devices</button>` : ''}
        ${st.required ? '' : `<button class="btn danger" id="mfaOff">Turn off</button>`}</div>`
    : `<p class="muted small" style="margin:0">Add a second step to your sign-in: after your password, enter a 6-digit code from Google Authenticator on your phone. Someone who learns your password still can't get in.</p>
      <div><button class="btn primary" id="mfaOn">${icon('shield', 'sm')}Turn on two-step verification</button></div>`}
    </div>`;
  const reload = () => mfaProfilePanel(host);
  $('#mfaOn', host)?.addEventListener('click', () => {
    const m = modal({ title: 'Turn on two-step verification', size: 'wide', body: '<div id="mSetup" class="mfa-setup"></div>', onClose: reload });
    mfaSetupFlow(m.$('#mSetup'), { onDone: () => { S.user.mfa_enabled = 1; m.close(); toast('Two-step verification is on.'); } });
  });
  const askCode = (title, ok, extra = '') => new Promise((resolve) => {
    let done = false;
    const m = modal({ title, body: `${extra}<div class="field"><label for="ac">Code from your authenticator app</label>${otpInput('ac')}<span class="hint">Or enter one of your recovery codes.</span></div>`,
      foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>${esc(ok)}</button>`, onClose: () => { if (!done) resolve(null); } });
    m.$('#ac').maxLength = 12;
    m.$('#ac').addEventListener('input', (e) => { if (/^\d/.test(e.target.value)) e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); });
    m.$('[data-ok]').onclick = () => { done = true; const v = { code: m.$('#ac').value.trim(), password: m.$('#ap')?.value }; m.close(); resolve(v); };
  });
  $('#mfaNewCodes', host)?.addEventListener('click', async () => {
    const v = await askCode('New recovery codes', 'Create new codes', '<p class="muted small" style="margin:0">Your old recovery codes stop working.</p>'); if (!v) return;
    const r = await run(api('auth.mfa_recovery_new', { code: v.code }));
    const m = modal({ title: 'New recovery codes', body: '<div id="rc" style="display:grid;gap:14px"></div>', onClose: reload });
    showRecoveryCodes(m.$('#rc'), r.codes, { onContinue: () => m.close() });
  });
  $('#mfaForget', host)?.addEventListener('click', async () => { await run(api('auth.mfa_devices_forget', {}), (r) => r.message); reload(); });
  $('#mfaOff', host)?.addEventListener('click', async () => {
    const v = await askCode('Turn off two-step verification', 'Turn off', '<p class="muted small" style="margin:0">Your account will be protected by your password only.</p><div class="field"><label for="ap">Password</label><input class="input" type="password" id="ap" autocomplete="current-password"></div>');
    if (!v) return;
    await run(api('auth.mfa_disable', v), (r) => r.message); S.user.mfa_enabled = 0; reload();
  });
}
/* Library browsing: folders, term navigation, filters, document table, peek panel, permissions, move */
'use strict';

function docTable(docs, { sel = new Set(), sort = 'modified', dir = 'desc', showLib = false, folders = [], selectable = true, focusId = null } = {}) {
  const th = (key, label, cls = '') => `<th class="${cls}"><button data-sort="${key}">${label}${sort === key ? icon(dir === 'asc' ? 'up' : 'down', 'sm') : ''}</button></th>`;
  const all = docs.length && docs.every((d) => sel.has(d.id));
  const folderRows = folders.map((f) => `<tr class="folder-row" data-folder="${f.id}">${selectable ? '<td class="cb"></td>' : ''}
    <td colspan="${showLib ? 7 : 6}"><div class="doc-title"><span class="folder-ico">${icon('folder', 'lg')}</span><div><div class="tt">${esc(f.name)}</div>
    <div class="nn">${f.count} published${f.inherit ? '' : ' · ' + 'own permissions'}</div></div></div></td></tr>`).join('');
  return `<div class="table-wrap"><table class="docs"><thead><tr>
    ${selectable ? `<th class="cb"><input type="checkbox" data-selall ${all ? 'checked' : ''} aria-label="Select all"></th>` : ''}
    ${th('title', 'Name')}${showLib ? '<th>Library</th>' : ''}${th('type', 'Type')}<th>Version</th><th>Status</th>${th('modified', 'Modified')}${th('owner', 'Author', 'c-owner')}${th('size', 'Size', 'c-size')}
  </tr></thead><tbody>${folderRows}${docs.map((d) => `<tr data-id="${d.id}" class="${sel.has(d.id) ? 'sel' : ''} ${focusId === d.id ? 'focus' : ''}">
    ${selectable ? `<td class="cb"><input type="checkbox" data-sel="${d.id}" ${sel.has(d.id) ? 'checked' : ''} aria-label="Select ${esc(d.title)}"></td>` : ''}
    <td><div class="doc-title">${fileIcon(d.ext)}<div><div class="tt">${esc(d.title)}${isSensitive(d.confidentiality) ? ' ' + conf(d.confidentiality) : ''}<span class="flags">${d.checked_out_by ? `<span title="Checked out by ${esc(d.checked_out_name)}">${icon('lock', 'sm')}</span>` : ''}${d.favorite ? `<span title="Favourite">${icon('star', 'sm')}</span>` : ''}</span></div>
      <div class="nn">${esc(d.doc_number || d.filename)}</div></div></div></td>
    ${showLib ? `<td class="nowrap"><span class="pill"><span class="sw" style="background:${esc(d.library_color)}"></span>${esc(d.library)}</span></td>` : ''}
    <td>${d.content_type ? `<span class="pill"><span class="sw" style="background:${esc(d.content_type_color)}"></span>${esc(d.content_type)}</span>` : '<span class="pill">General document</span>'}</td>
    <td>${revDelta(d.version)}</td>
    <td>${statusTag(d.status)}</td>
    <td class="nowrap muted" title="${esc(fmtDate(d.modified, true))}">${ago(d.modified)}</td>
    <td class="nowrap c-owner">${esc(d.owner)}</td>
    <td class="nowrap muted c-size">${fmtSize(d.size)}</td></tr>`).join('')}</tbody></table></div>`;
}

function docGrid(docs, sel) {
  return `<div class="grid-docs">${docs.map((d) => `<div class="gcard ${sel.has(d.id) ? 'sel' : ''}" data-id="${d.id}">
    <input type="checkbox" data-sel="${d.id}" ${sel.has(d.id) ? 'checked' : ''} aria-label="Select">
    ${fileIcon(d.ext)}<div class="gt">${esc(d.title)}</div><div class="mono faint small">${esc(d.doc_number || '')}</div>
    <div class="chips">${d.content_type ? `<span class="pill"><span class="sw" style="background:${esc(d.content_type_color)}"></span>${esc(d.content_type)}</span>` : '<span class="pill">General document</span>'}</div>
    <div class="gm"><span>${statusTag(d.status)}</span><span class="ver">v${esc(d.version)}</span></div></div>`).join('')}</div>`;
}

function emptyState(ico, title, text, action = '') { return `<div class="panel empty">${icon(ico)}<h3>${esc(title)}</h3><p>${text}</p>${action}</div>`; }

/* ================= Library page ================= */
route('/lib/(\\d+)(?:/f/(\\d+))?', async (page, [libId, folderId], params) => {
  libId = +libId; folderId = folderId ? +folderId : null;
  const [r] = await Promise.all([api('libraries.get', undefined, { query: { id: libId } }), loadTax()]);
  if (r.denied) {
    setTitle(r.library.name);
    page.innerHTML = `<div class="crumbs"><a href="#/">Home</a>${icon('right')}${esc(r.library.name)}</div>
      ${emptyState('lock', "You don't have access to this library yet", esc(r.library.description || 'Ask for access and an administrator will review it.'),
      r.requested ? '<p class="faint">Your request is with the administrators.</p>' : `<button class="btn primary" id="reqAccess">${icon('key')}Request access</button>`)}`;
    $('#reqAccess')?.addEventListener('click', async () => {
      const reason = await promptBox({ title: 'Request access', label: 'Why do you need access?', textarea: true, ok: 'Send request' });
      if (reason === null) return;
      await run(api('libraries.request_access', { library_id: libId, reason }), (x) => x.message);
      navigate();
    });
    return;
  }
  const lib = r.library, folders = r.folders;
  setTitle(lib.name);
  const st = { flat: params.flat === '1', view: localStorageGet('km-view') || 'list', sort: 'modified', dir: 'desc',
    filters: { ct: [], status: [], terms: params.term ? [+params.term] : [], ext: [], q: '' }, sel: new Set(), peek: null, docs: [], facets: null, level: lib.level };
  const fById = Object.fromEntries(folders.map((f) => [f.id, f]));
  const pathTo = (fid) => { const out = []; let f = fById[fid]; while (f) { out.unshift(f); f = f.parent_id ? fById[f.parent_id] : null; } return out; };
  const curFolder = folderId ? fById[folderId] : null;
  const subfolders = folders.filter((f) => (f.parent_id || null) === folderId);
  const canContribute = () => st.level >= 2;
  const folderLevel = curFolder ? curFolder.level : lib.level;
  st.level = folderLevel;

  page.innerHTML = `
    <div class="crumbs"><a href="#/">Home</a>${icon('right')}<a href="#/lib/${lib.id}">${esc(lib.name)}</a>${pathTo(folderId).map((f) => `${icon('right')}<a href="#/lib/${lib.id}/f/${f.id}">${esc(f.name)}</a>`).join('')}</div>
    <div class="page-head">
      <div class="grow"><h1>${esc(curFolder ? curFolder.name : lib.name)}</h1><p>${esc(curFolder ? 'Folder in ' + lib.name : lib.description || '')}
        <span class="faint"> · Your access: ${LEVELS[folderLevel]}${S.settings.approvals && +lib.approval_required ? ' · Publishing needs a department head’s approval' : ''}</span></p></div>
      <div class="btn-row">
        ${folderLevel >= 2 ? `<button class="btn primary" id="bUpload">${icon('upload')}Upload</button><button class="btn" id="bFolder">${icon('folder-plus')}New folder</button>` : ''}
        ${folderLevel >= 4 ? `<button class="btn" id="bPerms">${icon('shield')}Permissions</button>` : ''}
        ${S.user.is_admin && !curFolder ? `<button class="btn ghost" id="bEditLib" title="Library settings">${icon('settings')}</button>` : ''}
        ${curFolder && folderLevel >= 4 ? `<button class="btn ghost" id="bFolderMore" title="Rename or delete folder">${icon('edit')}</button>` : ''}
      </div>
    </div>
    <div class="lib-layout" id="libLayout">
      <aside class="lib-nav">
        <div><h4>Folders</h4><ul class="tree" id="folderTree"></ul></div>
        <div id="termNav"></div>
        <div id="facetNav"></div>
      </aside>
      <section>
        <div class="toolbar">
          <div class="filter-input">${icon('filter', 'sm')}<input class="input" id="qf" placeholder="Filter by title, number or keyword"></div>
          <label class="check small" style="align-items:center"><input type="checkbox" id="flat" ${st.flat ? 'checked' : ''}> Include subfolders</label>
          <div style="margin-left:auto" class="seg"><button data-view="list" class="${st.view === 'list' ? 'on' : ''}" title="List">${icon('list', 'sm')}</button><button data-view="grid" class="${st.view === 'grid' ? 'on' : ''}" title="Tiles">${icon('grid', 'sm')}</button></div>
        </div>
        <div class="active-filters" id="activeFilters"></div>
        <div id="bulk"></div>
        <div id="docList"><div class="loading"><div class="boot-mark"></div></div></div>
      </section>
      <aside id="peek" class="peek hidden" aria-label="Document details"></aside>
    </div>`;

  // Folder tree
  const drawTree = (parent) => {
    const kids = folders.filter((f) => (f.parent_id || null) === parent);
    if (!kids.length) return '';
    return kids.map((f) => `<li><a href="#/lib/${lib.id}/f/${f.id}" class="${f.id === folderId ? 'on' : ''}">${icon('folder', 'sm')}<span>${esc(f.name)}</span>${f.inherit ? '' : `<span class="lock" title="Has its own permissions">${icon('lock', 'sm')}</span>`}<span class="n">${f.count || ''}</span></a>
      ${folders.some((c) => c.parent_id === f.id) ? `<ul>${drawTree(f.id)}</ul>` : ''}</li>`).join('');
  };
  $('#folderTree').innerHTML = `<li><a href="#/lib/${lib.id}" class="${!folderId ? 'on' : ''}">${icon('home', 'sm')}<span>Library root</span></a></li>` + drawTree(null);

  const load = async () => {
    const q = { library_id: lib.id, folder_id: folderId || '', flat: st.flat ? 1 : '', sort: st.sort, dir: st.dir, q: st.filters.q,
      ct: st.filters.ct, status: st.filters.status, terms: st.filters.terms, ext: st.filters.ext };
    const res = await api('docs.list', undefined, { query: q });
    st.docs = res.docs; st.facets = res.facets;
    st.sel.forEach((id) => { if (!st.docs.some((d) => d.id === id)) st.sel.delete(id); });
    drawList(); drawFacets(); drawActive();
  };

  const drawList = () => {
    const showFolders = !st.flat && !st.filters.q && !hasFilters() ? subfolders : [];
    const box = $('#docList');
    if (!st.docs.length && !showFolders.length) {
      box.innerHTML = hasFilters() || st.filters.q
        ? emptyState('filter', 'Nothing matches these filters', 'Clear a filter or include subfolders to widen the results.', '<button class="btn" id="clearAll">Clear filters</button>')
        : emptyState('upload', 'This folder is empty', canContribute() ? 'Drag files anywhere on this page, or use Upload. Each file becomes a versioned document.' : 'Documents appear here once they are published.',
          canContribute() ? `<button class="btn primary" id="emptyUp">${icon('upload')}Upload documents</button>` : '');
      $('#emptyUp')?.addEventListener('click', () => openUpload({ libraryId: lib.id, folderId, onDone: load }));
      $('#clearAll')?.addEventListener('click', () => { st.filters = { ct: [], status: [], terms: [], ext: [], q: '' }; $('#qf').value = ''; load(); });
    } else box.innerHTML = st.view === 'grid' ? (showFolders.length ? docTable([], { folders: showFolders, selectable: false }) + '<div style="height:12px"></div>' : '') + docGrid(st.docs, st.sel)
      : docTable(st.docs, { sel: st.sel, sort: st.sort, dir: st.dir, folders: showFolders, focusId: st.peek });
    drawBulk();
  };
  const hasFilters = () => st.filters.ct.length || st.filters.status.length || st.filters.terms.length || st.filters.ext.length;

  const drawFacets = () => {
    const f = st.facets; if (!f) return;
    const idx = termIndex();
    // Term-store navigation: every navigable term set with counts
    const sets = (S.tax.termsets || []).filter((s) => s.navigable);
    $('#termNav').innerHTML = sets.map((s) => {
      const counts = Object.fromEntries((f.terms[s.name] || []).map((t) => [t.id, t.n]));
      const roll = (id) => (counts[id] || 0) + s.terms.filter((t) => t.parent_id === id).reduce((a, t) => a + roll(t.id), 0);
      const draw = (pid) => s.terms.filter((t) => (t.parent_id || null) === pid && !t.deprecated).map((t) => {
        const n = roll(t.id); if (!n) return '';
        const kids = draw(t.id);
        return `<li><button class="node ${st.filters.terms.includes(t.id) ? 'on' : ''}" data-term="${t.id}">${icon('tag', 'sm')}<span>${esc(t.label)}</span><span class="n">${n}</span></button>${kids ? `<ul>${kids}</ul>` : ''}</li>`;
      }).join('');
      const body = draw(null);
      return body ? `<div style="margin-bottom:14px"><h4>${esc(s.name)}</h4><ul class="tree">${body}</ul></div>` : '';
    }).join('');
    const facet = (title, key, items) => items.length ? `<div style="margin-bottom:14px"><h4>${title}</h4><div class="facet">${items.map((it) => `<label><input type="checkbox" data-f="${key}" value="${esc(it.v)}" ${st.filters[key].map(String).includes(String(it.v)) ? 'checked' : ''}>${it.sw ? `<span class="pill" style="height:auto;border:0;background:none;padding:0"><span class="sw" style="background:${esc(it.sw)}"></span></span>` : ''}<span>${esc(it.l)}</span><span class="n">${it.n}</span></label>`).join('')}</div></div>` : '';
    $('#facetNav').innerHTML =
      facet('Content type', 'ct', f.content_types.map((c) => ({ v: c.id, l: c.label, n: c.n, sw: c.color }))) +
      facet('Status', 'status', Object.entries(f.status).map(([k, n]) => ({ v: k, l: STATUS[k] || k, n }))) +
      facet('File type', 'ext', Object.entries(f.ext).map(([k, n]) => ({ v: k, l: k.toUpperCase(), n })));
  };

  const drawActive = () => {
    const idx = termIndex();
    const chips = [];
    st.filters.terms.forEach((t) => chips.push(['terms', t, (idx[t]?.label) || 'Tag']));
    st.filters.ct.forEach((c) => chips.push(['ct', c, S.tax.content_types.find((x) => x.id === +c)?.name || 'Type']));
    st.filters.status.forEach((s) => chips.push(['status', s, STATUS[s]]));
    st.filters.ext.forEach((e) => chips.push(['ext', e, e.toUpperCase()]));
    $('#activeFilters').innerHTML = chips.map(([k, v, l]) => `<span class="chip">${esc(l)}<span class="x" data-rm="${k}" data-v="${esc(v)}" title="Remove">${icon('x', 'sm')}</span></span>`).join('')
      + (chips.length > 1 ? '<button class="chip ghost" data-rm="all">Clear all</button>' : '');
  };

  const drawBulk = () => {
    const n = st.sel.size;
    $('#bulk').innerHTML = n ? `<div class="bulk"><b>${n} selected</b>
      <button class="btn sm" data-bulk="zip">${icon('download', 'sm')}Download</button>
      ${canContribute() ? `<button class="btn sm" data-bulk="move">${icon('move', 'sm')}Move</button>` : ''}
      ${S.user.is_admin || (canContribute() && (st.docs || []).some((x) => st.sel.has(x.id) && x.status !== 'published')) ? `<button class="btn sm" data-bulk="delete">${icon('trash', 'sm')}Delete</button>` : ''}
      <button class="btn sm" data-bulk="clear" style="margin-left:auto">Clear</button></div>` : '';
  };

  // Peek panel
  const openPeek = async (id) => {
    st.peek = id;
    $('#libLayout').classList.add('with-peek');
    const p = $('#peek'); p.classList.remove('hidden');
    p.innerHTML = '<div class="loading"><div class="boot-mark"></div></div>';
    $$('#docList tr[data-id]').forEach((tr) => tr.classList.toggle('focus', +tr.dataset.id === id));
    try { const r = await api('docs.get', undefined, { query: { id } }); if (st.peek === id) p.innerHTML = peekHtml(r); }
    catch (e) { p.innerHTML = `<div class="empty">${icon('lock')}<p>${esc(e.message)}</p></div>`; }
  };
  const closePeek = () => { st.peek = null; $('#peek').classList.add('hidden'); $('#libLayout').classList.remove('with-peek'); $$('#docList tr.focus').forEach((x) => x.classList.remove('focus')); };

  // Events
  page.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.closest('[data-close-peek]')) return closePeek();
    const sortB = t.closest('[data-sort]');
    if (sortB) { const k = sortB.dataset.sort; st.dir = st.sort === k ? (st.dir === 'asc' ? 'desc' : 'asc') : (k === 'title' || k === 'type' || k === 'owner' ? 'asc' : 'desc'); st.sort = k; return load(); }
    const vb = t.closest('[data-view]');
    if (vb) { st.view = vb.dataset.view; localStorageSet('km-view', st.view); $$('[data-view]').forEach((b) => b.classList.toggle('on', b === vb)); return drawList(); }
    const tn = t.closest('[data-term]');
    if (tn) { const id = +tn.dataset.term; st.filters.terms = st.filters.terms.includes(id) ? st.filters.terms.filter((x) => x !== id) : [...st.filters.terms, id]; return load(); }
    const rm = t.closest('[data-rm]');
    if (rm) { if (rm.dataset.rm === 'all') st.filters = { ...st.filters, ct: [], status: [], terms: [], ext: [] }; else st.filters[rm.dataset.rm] = st.filters[rm.dataset.rm].filter((x) => String(x) !== rm.dataset.v); return load(); }
    const bk = t.closest('[data-bulk]');
    if (bk) return bulkAction(bk.dataset.bulk);
    if (t.matches('[data-selall]')) { if (t.checked) st.docs.forEach((d) => st.sel.add(d.id)); else st.sel.clear(); return drawList(); }
    if (t.matches('[data-sel]')) { const id = +t.dataset.sel; t.checked ? st.sel.add(id) : st.sel.delete(id); t.closest('tr,.gcard')?.classList.toggle('sel', t.checked); return drawBulk(); }
    const pa = t.closest('[data-peek-act]');
    if (pa) return peekAction(pa.dataset.peekAct, +pa.dataset.id);
    const fr = t.closest('[data-folder]');
    if (fr) return go(`#/lib/${lib.id}/f/${fr.dataset.folder}`);
    const row = t.closest('tr[data-id], .gcard[data-id]');
    if (row && !t.closest('input,a,button')) { const id = +row.dataset.id; if (st.peek === id && e.detail > 1) return go('#/doc/' + id); return openPeek(id); }
  });
  page.addEventListener('dblclick', (e) => { const row = e.target.closest('tr[data-id], .gcard[data-id]'); if (row) go('#/doc/' + row.dataset.id); });
  page.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.f) { const k = t.dataset.f; const v = k === 'ct' ? +t.value : t.value; st.filters[k] = t.checked ? [...st.filters[k], v] : st.filters[k].filter((x) => String(x) !== String(v)); load(); }
    if (t.id === 'flat') { st.flat = t.checked; load(); }
  });
  $('#qf').addEventListener('input', debounce((e) => { st.filters.q = e.target.value.trim(); load(); }, 250));
  $('#bUpload')?.addEventListener('click', () => openUpload({ libraryId: lib.id, folderId, onDone: load }));
  $('#bFolder')?.addEventListener('click', async () => {
    const name = await promptBox({ title: 'New folder', label: 'Folder name', ok: 'Create folder' });
    if (!name) return;
    await run(api('libraries.folder_save', { library_id: lib.id, parent_id: folderId, name }), 'Folder created.');
    navigate();
  });
  $('#bPerms')?.addEventListener('click', () => openPermissions(curFolder ? 'folder' : 'library', curFolder ? curFolder.id : lib.id, curFolder ? curFolder.name : lib.name, () => navigate()));
  $('#bEditLib')?.addEventListener('click', () => editLibrary(lib));
  $('#bFolderMore')?.addEventListener('click', () => {
    const m = modal({ title: 'Folder: ' + curFolder.name, body: `<div class="field"><label>Name</label><input class="input" id="fn" value="${esc(curFolder.name)}"></div>`,
      foot: `<button class="btn danger left" data-del>${icon('trash', 'sm')}Delete folder</button><button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>Rename</button>` });
    m.$('[data-ok]').onclick = async () => { await run(api('libraries.folder_save', { id: curFolder.id, name: m.$('#fn').value }), 'Folder renamed.'); m.close(); navigate(); };
    m.$('[data-del]').onclick = async () => {
      if (!await confirmBox('Delete this folder and its empty subfolders?', { danger: true, ok: 'Delete folder' })) return;
      await run(api('libraries.folder_delete', { id: curFolder.id }), 'Folder deleted.'); m.close(); go(curFolder.parent_id ? `#/lib/${lib.id}/f/${curFolder.parent_id}` : `#/lib/${lib.id}`);
    };
  });

  const bulkAction = async (act) => {
    const ids = [...st.sel];
    if (act === 'clear') { st.sel.clear(); return drawList(); }
    if (act === 'zip') { location.href = 'download.php?zip=1&ids=' + ids.join(','); return; }
    if (act === 'delete') {
      if (!await confirmBox(`Move ${ids.length} document(s) to the recycle bin? You can restore them for ${S.settings.recycle_days || 90} days.`, { danger: true, ok: 'Delete' })) return;
      await run(api('docs.delete', { ids }), (r) => r.message); st.sel.clear(); closePeek(); load();
    }
    if (act === 'move') { openMove(ids, () => { st.sel.clear(); load(); }); }
  };
  const peekAction = async (act, id) => {
    if (act === 'fav') { const r = await api('docs.favorite', { id }); toast(r.favorite ? 'Added to favourites.' : 'Removed from favourites.'); openPeek(id); load(); }
    if (act === 'version') openUpload({ documentId: id, libraryId: lib.id, folderId, onDone: () => { load(); openPeek(id); } });
  };

  // Drag & drop anywhere on the page
  let dragDepth = 0, overlay = null;
  const onDragEnter = (e) => { if (!canContribute() || !e.dataTransfer?.types?.includes('Files')) return; dragDepth++; if (!overlay) { overlay = document.createElement('div'); overlay.className = 'dropzone-overlay'; overlay.innerHTML = `<div>${icon('upload', 'lg')}<br>Drop to upload into ${esc(curFolder ? curFolder.name : lib.name)}</div>`; document.body.appendChild(overlay); } };
  const onDragLeave = () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth && overlay) { overlay.remove(); overlay = null; } };
  const onDragOver = (e) => { if (canContribute() && e.dataTransfer?.types?.includes('Files')) e.preventDefault(); };
  const onDrop = (e) => { if (!canContribute() || $('.modal-back')) return; e.preventDefault(); dragDepth = 0; overlay?.remove(); overlay = null; if (e.dataTransfer.files.length) openUpload({ libraryId: lib.id, folderId, files: [...e.dataTransfer.files], onDone: load }); };
  const onKey = (e) => { if (e.key === 'Escape' && st.peek && !$('.modal-back')) closePeek(); };
  document.addEventListener('dragenter', onDragEnter); document.addEventListener('dragleave', onDragLeave); document.addEventListener('dragover', onDragOver); document.addEventListener('drop', onDrop); document.addEventListener('keydown', onKey);

  await load();
  return () => { document.removeEventListener('dragenter', onDragEnter); document.removeEventListener('dragleave', onDragLeave); document.removeEventListener('dragover', onDragOver); document.removeEventListener('drop', onDrop); document.removeEventListener('keydown', onKey); overlay?.remove(); };
});

function titleBlock(d, approvals = [], opts = {}) {
  const flow = S.settings.approvals;
  const statusTxt = { published: flow ? 'Approved for use' : 'Published', pending: 'Awaiting approval', rejected: 'Returned for changes', draft: 'Draft — not for use' }[d.status] || d.status;
  return `<div class="titleblock">
    <div class="tb-num"><small>Document number</small><div class="v mono">${esc(d.doc_number || '—')}</div></div>
    <div class="tb-rev"><small>Rev</small>${revDelta(d.version, 'big')}</div>
    <div class="tb-stamp nr">${docStamp(d, approvals, { size: opts.size || 104, press: !!opts.press })}</div>
    <div><small>Type</small><div class="v">${esc(d.content_type || 'General document')}</div></div>
    <div><small>Class</small><div class="v">${esc(d.confidentiality.charAt(0).toUpperCase() + d.confidentiality.slice(1))}</div></div>
    <div><small>Author</small><div class="v">${esc(d.owner)}</div></div>
    <div><small>Date</small><div class="v">${esc(parseDate(d.modified)?.toLocaleDateString('en-GB') || '')}</div></div>
    <div class="nb"><small>Library</small><div class="v">${esc(d.library)}</div></div>
    <div class="nb"><small>${flow ? 'Approved by' : 'Published by'}</small><div class="v">${esc(d.published_by || '—')}</div></div>
    <div class="nb nr"><small>Status</small><div class="v">${esc(statusTxt)}</div></div>
  </div>`;
}

function peekHtml(r) {
  const d = r.doc;
  const props = r.props.filter((p) => (Array.isArray(p.value) ? p.value.length : p.value));
  return `<div class="peek-h">${fileIcon(d.ext)}<h3>${esc(d.title)}</h3><button class="icon-btn" data-close-peek aria-label="Close">${icon('x')}</button></div>
    <div style="padding:0 16px 14px">${titleBlock(d, r.approvals, { size: 92 })}</div>
    <div class="sect"><div class="actions">
      <a class="btn sm primary" href="#/doc/${d.id}">${icon('open', 'sm')}Open</a>
      <a class="btn sm" href="download.php?id=${d.id}">${icon('download', 'sm')}Download</a>
      <button class="btn sm" data-peek-act="fav" data-id="${d.id}" title="Favourite">${icon('star', 'sm')}${d.favorite ? 'Unfavourite' : 'Favourite'}</button>
      ${d.can.upload_version ? `<button class="btn sm" data-peek-act="version" data-id="${d.id}">${icon('upload', 'sm')}New version</button>` : ''}
    </div></div>
    ${d.status === 'pending' ? `<div class="sect"><div class="alert amber">${icon('clock')}<div class="grow"><b>Waiting for approval</b>${d.can.approve ? 'You can approve this document.' : 'A department head will review it.'}</div></div></div>` : ''}
    ${d.status === 'rejected' ? `<div class="sect"><div class="alert red">${icon('alert')}<div class="grow"><b>Changes requested</b>${esc(r.approvals[0]?.note || '')}</div></div></div>` : ''}
    ${d.description ? `<div class="sect"><p style="margin:0" class="small muted">${esc(d.description)}</p></div>` : ''}
    ${props.length ? `<div class="sect"><h4>Properties</h4><dl class="kv">${props.map((p) => `<dt>${esc(p.name)}</dt><dd>${propValue(p)}</dd>`).join('')}</dl></div>` : ''}
    <div class="sect"><h4>Versions</h4><ul class="timeline">${r.versions.slice(0, 5).map((v) => `<li class="${v.is_published ? 'pub' : ''} ${v.is_current ? 'cur' : ''}"><b class="mono">${esc(v.label)}</b> · ${esc(v.uploader || '')}<div class="when">${ago(v.created_at)}${v.comment ? ' · ' + esc(v.comment) : ''}</div></li>`).join('')}</ul></div>
    <div class="sect"><dl class="kv"><dt>File</dt><dd>${esc(d.filename)} · ${fmtSize(d.size)}</dd><dt>Views</dt><dd>${plural(d.views, "view")} by ${plural(d.viewers, "person", "people")}</dd>${d.review_date ? `<dt>Review by</dt><dd>${esc(fmtDate(d.review_date))}</dd>` : ''}</dl></div>`;
}

function propValue(p) {
  if (p.type === 'term') return `<div class="chips">${p.value.map((t) => `<a class="chip" href="#/search?terms=${t.id}">${esc(t.label)}</a>`).join('')}</div>`;
  if (p.type === 'user') return p.value ? `<a href="#/person/${p.value.id}">${esc(p.value.name)}</a>` : '';
  if (p.type === 'date') return esc(fmtDate(p.value));
  if (p.type === 'bool') return p.value === '1' ? 'Yes' : 'No';
  if (p.type === 'number') return esc(Number(p.value).toLocaleString('en-US'));
  return esc(p.value);
}

/* ================= Permissions dialog ================= */
async function openPermissions(scope, id, name, onSaved) {
  const [r, dir] = await Promise.all([api('libraries.perms_get', undefined, { query: { scope, id } }), loadDir()]);
  let inherit = !!r.inherit;
  let entries = r.entries.map((e) => ({ principal_type: e.principal_type, principal_id: e.principal_id, level: e.level, label: e.label }));
  const roleLabels = { admin: 'All administrators', head: 'All department heads', member: 'All members', viewer: 'All viewers' };
  const pIcon = { everyone: 'globe', user: 'user', department: 'building', group: 'users', role: 'badge' };
  const ptName = { everyone: 'Everyone signed in', user: 'Person', department: 'Department', group: 'Group', role: 'Role' };
  const m = modal({ title: 'Permissions · ' + name, size: 'wide', body: '', foot: `<span class="left faint small" id="permNote"></span><button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>Save permissions</button>` });
  const draw = () => {
    m.$('.modal-b').innerHTML = `
      <div class="levels-legend"><div><b>Read</b>View and download published documents</div><div><b>Contribute</b>Upload, edit properties, new versions</div><div><b>Approve</b>See drafts and publish documents</div><div><b>Full control</b>Delete anything and manage permissions</div></div>
      ${r.classification_rule ? `<div class="alert ${r.classification === 'restricted' ? 'amber' : 'teal'}">${icon('lock')}<div class="grow">${esc(r.classification_rule)}${r.classification === 'restricted' ? ' Add the people who need it below.' : ' People listed below can also see it.'}</div></div>` : ''}
      ${scope !== 'library' && r.classification !== 'restricted' ? `<label class="check"><input type="checkbox" id="inh" ${inherit ? 'checked' : ''}><span><b>Inherit permissions from ${r.source ? esc(r.source.name) : 'the parent'}</b><br><span class="muted small">Untick to give this ${scope} its own permissions (for example, a confidential folder).</span></span></label>` : ''}
      <div class="perm-list">${entries.map((e, i) => `<div class="perm-row"><span class="pt-ico">${icon(pIcon[e.principal_type])}</span>
        <div><b>${esc(e.label)}</b><div class="pt">${ptName[e.principal_type]}</div></div>
        <select class="input" data-lv="${i}" ${inherit ? 'disabled' : ''}>${[1, 2, 3, 4].map((l) => `<option value="${l}" ${e.level === l ? 'selected' : ''}>${LEVELS[l]}</option>`).join('')}</select>
        ${inherit ? '<span></span>' : `<button class="mini-btn" data-rm="${i}" title="Remove">${icon('x', 'sm')}</button>`}</div>`).join('') || '<div class="empty small">Nobody has access yet. Add people, departments or groups below.</div>'}</div>
      ${inherit ? '' : `<div class="panel" style="padding:14px"><div class="label" style="margin-bottom:8px">Grant access</div><div style="display:grid;grid-template-columns:150px 1fr 150px auto;gap:8px" class="grant">
        <select class="input" id="gType"><option value="department">Department</option><option value="user">Person</option><option value="group">Group</option><option value="role">Role</option><option value="everyone">Everyone</option></select>
        <select class="input" id="gWho"></select>
        <select class="input" id="gLv">${[1, 2, 3, 4].map((l) => `<option value="${l}" ${l === 1 ? 'selected' : ''}>${LEVELS[l]}</option>`).join('')}</select>
        <button class="btn" id="gAdd">${icon('plus', 'sm')}Add</button></div></div>`}`;
    m.$('#permNote').textContent = inherit ? 'Showing the permissions this item inherits.' : '';
    const fillWho = () => {
      const t = m.$('#gType')?.value; const sel = m.$('#gWho'); if (!sel) return;
      const opts = t === 'department' ? dir.departments.map((d) => [d.id, d.name]) : t === 'user' ? dir.people.map((p) => [p.id, `${p.name}${p.department ? ' — ' + p.department : ''}`])
        : t === 'group' ? dir.groups.map((g) => [g.id, g.name]) : t === 'role' ? Object.entries(roleLabels) : [['', 'Everyone signed in']];
      sel.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
      sel.disabled = t === 'everyone';
    };
    fillWho();
    m.$('#gType')?.addEventListener('change', fillWho);
    m.$('#gAdd')?.addEventListener('click', () => {
      const t = m.$('#gType').value, w = m.$('#gWho').value, lv = +m.$('#gLv').value;
      const label = t === 'everyone' ? 'Everyone' : m.$('#gWho').selectedOptions[0].textContent.split(' — ')[0];
      const ex = entries.find((e) => e.principal_type === t && String(e.principal_id) === String(w));
      if (ex) ex.level = lv; else entries.push({ principal_type: t, principal_id: t === 'everyone' ? '' : w, level: lv, label });
      draw();
    });
    m.$('#inh')?.addEventListener('change', (e) => { inherit = e.target.checked; draw(); });
    m.$$('[data-lv]').forEach((s) => s.addEventListener('change', () => { entries[+s.dataset.lv].level = +s.value; }));
    m.$$('[data-rm]').forEach((b) => b.addEventListener('click', () => { entries.splice(+b.dataset.rm, 1); draw(); }));
  };
  draw();
  m.$('[data-ok]').onclick = async () => {
    await run(api('libraries.perms_save', { scope, id, inherit: inherit ? 1 : 0, entries }), 'Permissions saved.');
    m.close(); onSaved && onSaved();
  };
}

/* ================= Move dialog ================= */
async function openMove(ids, onDone) {
  const libs = (await loadLibs(true)).filter((l) => l.level >= 2);
  const m = modal({ title: `Move ${ids.length} document${ids.length > 1 ? 's' : ''}`, body: `
    <div class="field"><label>Library</label><select class="input" id="mvLib">${libs.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Folder</label><select class="input" id="mvFolder"></select></div>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>Move here</button>` });
  const fill = async () => {
    const r = await api('libraries.get', undefined, { query: { id: m.$('#mvLib').value } });
    const fs = r.folders || [];
    const path = (f) => { const p = []; let x = f; while (x) { p.unshift(x.name); x = fs.find((y) => y.id === x.parent_id); } return p.join(' / '); };
    m.$('#mvFolder').innerHTML = '<option value="">Library root</option>' + fs.filter((f) => f.level >= 2).map((f) => [f.id, path(f)]).sort((a, b) => a[1].localeCompare(b[1])).map(([id, p]) => `<option value="${id}">${esc(p)}</option>`).join('');
  };
  m.$('#mvLib').addEventListener('change', fill);
  await fill();
  m.$('[data-ok]').onclick = async () => {
    await run(api('docs.move', { ids, library_id: +m.$('#mvLib').value, folder_id: +m.$('#mvFolder').value || null }), (r) => r.message);
    m.close(); onDone && onDone();
  };
}

/* ================= Library settings (admin) ================= */
async function editLibrary(lib = null) {
  const dir = await loadDir();
  const icons = ['folder', 'drafting', 'chart', 'handshake', 'shield', 'book', 'wrench', 'people', 'bulb'];
  const m = modal({ title: lib ? 'Library settings' : 'New library', size: 'wide', body: `
    <div class="grid2">
      <div class="field"><label>Name</label><input class="input" id="lName" value="${esc(lib?.name || '')}"></div>
      <div class="field"><label>Code</label><input class="input mono" id="lCode" value="${esc(lib?.code || '')}" maxlength="16"><span class="hint">Used in document numbers, e.g. TGISL-<b>ENG</b>-DWG-0001</span></div>
      <div class="field" style="grid-column:1/-1"><label>Description</label><input class="input" id="lDesc" value="${esc(lib?.description || '')}"></div>
      <div class="field"><label>Owning department</label><select class="input" id="lDept"><option value="">None</option>${dir.departments.map((d) => `<option value="${d.id}" ${+lib?.department_id === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
        ${lib ? '' : '<span class="hint">This department gets Contribute access automatically.</span>'}</div>
      <div class="field"><label>Colour</label><input class="input" type="color" id="lColor" value="${esc(lib?.color || '#0F7C7A')}" style="padding:4px"></div>
      <div class="field"><label>Icon</label><select class="input" id="lIcon">${icons.map((i) => `<option ${lib?.icon === i ? 'selected' : ''}>${i}</option>`).join('')}</select></div>
      <div class="field" ${S.settings.approvals ? '' : 'hidden'}><label>Who can approve?</label><select class="input" id="lMode"><option value="any_head">Any department head with read access</option><option value="owner_head" ${lib?.approval_mode === 'owner_head' ? 'selected' : ''}>Only heads of the owning department</option></select></div>
    </div>
    <label class="check" ${S.settings.approvals ? '' : 'hidden'}><input type="checkbox" id="lAppr" ${!lib || +lib.approval_required ? 'checked' : ''}><span><b>Require approval before publishing</b><br><span class="muted small">Uploads stay as drafts (visible to the author and approvers) until a department head approves them.</span></span></label>`,
    foot: `${lib ? `<button class="btn danger left" data-del>${icon('trash', 'sm')}Delete library</button>` : ''}<button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>${lib ? 'Save changes' : 'Create library'}</button>` });
  m.$('[data-ok]').onclick = async () => {
    const r = await run(api('libraries.save', { id: lib?.id || 0, name: m.$('#lName').value, code: m.$('#lCode').value, description: m.$('#lDesc').value, department_id: +m.$('#lDept').value || 0,
      color: m.$('#lColor').value, icon: m.$('#lIcon').value, approval_mode: m.$('#lMode').value, approval_required: m.$('#lAppr').checked ? 1 : 0 }), lib ? 'Library saved.' : 'Library created.');
    m.close(); await loadLibs(true); renderSideLibs(); go('#/lib/' + r.id);
  };
  m.$('[data-del]')?.addEventListener('click', async () => {
    if (!await confirmBox('Delete this library? It must be empty first.', { danger: true, ok: 'Delete library' })) return;
    await run(api('libraries.delete', { id: lib.id }), 'Library deleted.'); m.close(); await loadLibs(true); renderSideLibs(); go('#/');
  });
}
/* Upload dialog, property editors and the term picker */
'use strict';

/* ---------------- Term picker ---------------- */
function termPicker(host, { termsetId, multi = true, value = [], onChange, placeholder = 'Type to find a term…' }) {
  const set = (S.tax?.termsets || []).find((s) => s.id === termsetId);
  const terms = (set?.terms || []).filter((t) => !t.deprecated);
  const byId = Object.fromEntries((set?.terms || []).map((t) => [t.id, t]));
  const path = (t) => { const p = []; let x = byId[t.parent_id]; while (x) { p.unshift(x.label); x = byId[x.parent_id]; } return p.join(' › '); };
  let sel = value.map(Number).filter((id) => byId[id]);
  let open = false, active = 0, list = [];
  host.classList.add('tp');
  host.innerHTML = `<div class="tp-box"><span class="chips"></span><input placeholder="${esc(placeholder)}" aria-label="${esc(set?.name || 'Terms')}"></div>`;
  const box = host.querySelector('.tp-box'), input = host.querySelector('input'), chips = host.querySelector('.chips');
  let menu = null;
  const drawChips = () => {
    chips.innerHTML = sel.map((id) => `<span class="chip">${esc(byId[id]?.label)}<span class="x" data-x="${id}">${icon('x', 'sm')}</span></span>`).join('');
    input.placeholder = sel.length && !multi ? '' : placeholder;
  };
  const drawMenu = () => {
    const q = input.value.trim().toLowerCase();
    list = terms.filter((t) => !q || t.label.toLowerCase().includes(q) || (t.synonyms || '').toLowerCase().includes(q)).slice(0, 60);
    if (!menu) { menu = document.createElement('div'); menu.className = 'tp-menu'; host.appendChild(menu); }
    menu.innerHTML = list.map((t, i) => `<button type="button" data-t="${t.id}" class="${i === active ? 'on' : ''}">${'&nbsp;&nbsp;'.repeat(path(t) ? path(t).split('›').length : 0)}${esc(t.label)}${path(t) ? `<span class="path">${esc(path(t))}</span>` : ''}${sel.includes(t.id) ? `<span class="sel">${icon('check', 'sm')}</span>` : ''}</button>`).join('')
      || '<div class="faint small" style="padding:8px 10px">No matching term. An administrator can add it in the term store.</div>';
  };
  const toggle = (id) => {
    if (sel.includes(id)) sel = sel.filter((x) => x !== id); else sel = multi ? [...sel, id] : [id];
    drawChips(); onChange && onChange(sel);
    if (!multi) close(); else { input.value = ''; drawMenu(); }
  };
  const close = () => { open = false; menu?.remove(); menu = null; };
  input.addEventListener('focus', () => { open = true; active = 0; drawMenu(); });
  input.addEventListener('input', () => { active = 0; drawMenu(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(list.length - 1, active + 1); drawMenu(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); drawMenu(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (list[active]) toggle(list[active].id); }
    else if (e.key === 'Escape') { if (open) { e.stopPropagation(); close(); } }
    else if (e.key === 'Backspace' && !input.value && sel.length) { sel.pop(); drawChips(); onChange && onChange(sel); }
  });
  host.addEventListener('mousedown', (e) => {
    const b = e.target.closest('[data-t]'); if (b) { e.preventDefault(); toggle(+b.dataset.t); return; }
    const x = e.target.closest('[data-x]'); if (x) { e.preventDefault(); toggle(+x.dataset.x); return; }
    if (e.target === box) { e.preventDefault(); input.focus(); }
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
  drawChips();
  return { get: () => sel.slice(), add: (id) => { if (!sel.includes(id)) { sel = multi ? [...sel, id] : [id]; drawChips(); onChange && onChange(sel); } } };
}

/* ---------------- Property inputs ---------------- */
function fieldsForType(ctId) {
  const ct = S.tax.content_types.find((c) => c.id === +ctId);
  if (!ct) return [];
  return ct.fields.map((fid) => S.tax.fields.find((f) => f.id === fid)).filter(Boolean);
}
function renderFieldInputs(host, fields, values = {}) {
  const pickers = {};
  host.innerHTML = fields.length ? `<div class="grid2">${fields.map((f) => {
    const v = values[f.id];
    const id = 'fld' + f.id;
    let inp;
    if (f.type === 'term') inp = `<div data-tp="${f.id}"></div>`;
    else if (f.type === 'choice') inp = `<select class="input" id="${id}" data-fid="${f.id}"><option value=""></option>${(f.options || []).map((o) => `<option ${v === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    else if (f.type === 'date') inp = `<input class="input" type="date" id="${id}" data-fid="${f.id}" value="${esc(v || '')}">`;
    else if (f.type === 'number') inp = `<input class="input" type="number" step="any" id="${id}" data-fid="${f.id}" value="${esc(v || '')}">`;
    else if (f.type === 'bool') inp = `<select class="input" id="${id}" data-fid="${f.id}"><option value="0">No</option><option value="1" ${v === '1' ? 'selected' : ''}>Yes</option></select>`;
    else if (f.type === 'user') inp = `<select class="input" id="${id}" data-fid="${f.id}"><option value=""></option>${(S.dir?.people || []).map((p) => `<option value="${p.id}" ${+v === p.id || v?.id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`;
    else inp = `<input class="input" id="${id}" data-fid="${f.id}" value="${esc(v || '')}">`;
    return `<div class="field" ${f.type === 'term' && f.multi ? 'style="grid-column:1/-1"' : ''}><label for="${id}">${esc(f.name)}${f.required ? ' *' : ''}</label>${inp}${f.description ? `<span class="hint">${esc(f.description)}</span>` : ''}</div>`;
  }).join('')}</div>` : '';
  fields.filter((f) => f.type === 'term').forEach((f) => {
    const el = host.querySelector(`[data-tp="${f.id}"]`);
    pickers[f.id] = termPicker(el, { termsetId: f.termset_id, multi: !!f.multi, value: (values[f.id] || []).map((t) => (typeof t === 'object' ? t.id : t)) });
  });
  return {
    pickers,
    collect: () => {
      const out = {};
      host.querySelectorAll('[data-fid]').forEach((el) => { out[el.dataset.fid] = el.value; });
      Object.entries(pickers).forEach(([fid, p]) => { out[fid] = p.get(); });
      return out;
    },
    missing: () => fields.filter((f) => f.required).filter((f) => { const el = host.querySelector(`[data-fid="${f.id}"]`); return f.type === 'term' ? !pickers[f.id].get().length : !el?.value; }).map((f) => f.name),
    addTerm: (termId) => {
      const idx = termIndex(); const t = idx[termId]; if (!t) return false;
      const f = fields.find((x) => x.type === 'term' && x.termset_id === t.set.id);
      if (!f) return false; pickers[f.id].add(termId); return true;
    },
  };
}

/* ---------------- Upload dialog ---------------- */
async function openUpload({ libraryId = null, folderId = null, documentId = null, files = [], onDone } = {}) {
  await Promise.all([loadTax(), loadDir(), loadLibs()]);
  const writable = S.libs.filter((l) => l.level >= 2);
  let doc = null;
  if (documentId) doc = (await api('docs.get', undefined, { query: { id: documentId } })).doc;
  if (!documentId && !writable.length && !libraryId) return toast("You don't have upload access to any library yet. Ask an administrator.", 'err');
  const canPublish = S.user.is_admin || S.user.is_head;
  const queue = [];
  let lib = libraryId || writable[0]?.id, folder = folderId || null;
  let props = null;

  const m = modal({ title: doc ? 'Upload a new version' : 'Upload documents', size: 'wide', body: `
    ${doc ? `<div class="alert teal">${fileIcon(doc.ext, 'sm')}<div class="grow"><b>${esc(doc.title)}</b><span class="mono small">${esc(doc.doc_number || '')} · current version ${esc(doc.version)}</span></div></div>` : `
    <div class="grid2"><div class="field"><label>Library</label><select class="input" id="uLib">${writable.map((l) => `<option value="${l.id}" ${l.id === lib ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Folder</label><select class="input" id="uFolder"><option value="">Library root</option></select></div></div>`}
    <div class="drop" id="uDrop" tabindex="0" role="button">${icon('upload')}<b>${doc ? 'Choose the updated file' : 'Drop files here or choose files'}</b><span class="small">${esc((S.settings.allowed_ext || []).slice(0, 12).join(', ').toUpperCase())}… up to ${Math.min(S.settings.max_upload_mb, S.settings.server_upload_mb || 9999)} MB each</span>
      <input type="file" id="uFile" ${doc ? '' : 'multiple'} hidden></div>
    <div class="uq" id="uQueue"></div>
    <div id="uSuggest"></div>
    ${doc ? `<div class="field"><label>What changed in this version?</label><input class="input" id="uComment" placeholder="e.g. Updated hold time after client comments"></div>` : `
    <div id="uSingle" class="field hidden"><label>Title</label><input class="input" id="uTitle" placeholder="Defaults to the file name"></div>
    <div class="grid3">
      <div class="field"><label>Content type</label><select class="input" id="uCt"><option value="">General document</option>${S.tax.content_types.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Classification</label><select class="input" id="uConf"><option value="internal">Internal</option><option value="public">Public</option><option value="confidential">Confidential</option><option value="restricted">Restricted</option></select></div>
      <div class="field"><label for="uReview">Next review date <span class="faint">(optional)</span></label><input class="input" type="date" id="uReview" min="${localISODate(1)}"><span class="hint">When this document should be checked again — not the document's own date.</span></div>
    </div>
    <div class="hint conf-hint" id="uConfHint">${esc(CONF_HELP.internal)}</div>
    <div id="uFields"></div>
    <div class="field"><label>Description</label><textarea class="input" id="uDesc" rows="2" style="min-height:64px" placeholder="What is this document for? Searchable."></textarea></div>
    <div class="field"><label>Keywords</label><input class="input" id="uKw" placeholder="Comma separated — e.g. hydrotest, jetty, NCR-112"></div>`}
    <div class="field"><label>After upload</label><div class="mode-pick" id="uMode"></div></div>`,
    foot: `<span class="left faint small" id="uInfo"></span><button class="btn" data-close>Cancel</button><button class="btn primary" data-ok disabled>${icon('upload', 'sm')}Upload</button>` });

  const libObj = () => S.libs.find((l) => l.id === +lib) || {};
  const drawModes = () => {
    if (!S.settings.approvals) { m.$('#uMode').closest('.field').hidden = true; m.$('#uMode').innerHTML = `<input type="radio" name="um" value="publish" checked hidden>`; return; }
    const needs = doc ? true : +libObj().approval_required !== 0;
    m.$('#uMode').innerHTML = needs ? `
      <label><input type="radio" name="um" value="submit" checked><b>Send for approval</b>A department head reviews it, then it’s published.</label>
      <label><input type="radio" name="um" value="draft"><b>Keep as draft</b>Only you and approvers can see it for now.</label>
      ${canPublish ? `<label><input type="radio" name="um" value="publish"><b>Publish now</b>You can approve, so publish straight away.</label>` : ''}`
      : `<label><input type="radio" name="um" value="publish" checked><b>Publish on upload</b>This library doesn’t need approval.</label>`;
  };
  const fillFolders = async () => {
    if (doc) return;
    const r = await api('libraries.get', undefined, { query: { id: lib } });
    const fs = r.folders || [];
    const path = (f) => { const p = []; let x = f; while (x) { p.unshift(x.name); x = fs.find((y) => y.id === x.parent_id); } return p.join(' / '); };
    m.$('#uFolder').innerHTML = '<option value="">Library root</option>' + fs.filter((f) => f.level >= 2).map((f) => [f.id, path(f)]).sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, p]) => `<option value="${id}" ${id === +folder ? 'selected' : ''}>${esc(p)}</option>`).join('');
    checkNames();
  };
  const checkNames = async () => {
    if (doc || !queue.length) return;
    const r = await api('docs.check_names', undefined, { query: { library_id: lib, folder_id: folder || '', names: queue.map((q) => q.file.name) } });
    queue.forEach((q) => { q.existing = r.existing[q.file.name.toLowerCase()] || null; });
    drawQueue();
  };
  const drawQueue = () => {
    m.$('#uQueue').innerHTML = queue.map((q, i) => {
      let st = fmtSize(q.file.size), cls = '';
      if (q.state === 'done') { st = esc(q.msg); cls = 'ok'; }
      else if (q.state === 'error') { st = esc(q.msg); cls = 'err'; }
      else if (q.state === 'uploading') st = 'Uploading… ' + Math.round(q.progress) + '%';
      else if (q.existing) { st = `Same name exists — will become a new version of “${esc(q.existing.title)}” (now ${esc(q.existing.version)})${q.existing.locked ? ' · checked out' : ''}`; cls = 'v'; }
      return `<div class="uq-item">${fileIcon(q.file.name.split('.').pop(), 'sm')}<div style="min-width:0"><div class="nm">${esc(q.file.name)}</div><div class="st ${cls}">${st}</div>${q.state === 'uploading' ? `<div class="bar"><i style="width:${q.progress}%"></i></div>` : ''}</div>
        ${q.state ? (q.state === 'done' && q.id ? `<a class="btn sm" href="#/doc/${q.id}">Open</a>` : '') : `<button class="mini-btn" data-rmq="${i}" title="Remove">${icon('x', 'sm')}</button>`}</div>`;
    }).join('');
    m.$('[data-ok]').disabled = !queue.some((q) => !q.state);
    m.$('#uSingle')?.classList.toggle('hidden', !(queue.length === 1 && !queue[0].existing));
    m.$('#uInfo').textContent = queue.length ? `${queue.length} file${queue.length > 1 ? 's' : ''}` : '';
  };
  const suggest = async () => {
    if (doc || !queue.length || !props) return;
    const text = queue.map((q) => q.file.name.replace(/[_.-]+/g, ' ')).join(' ') + ' ' + (m.$('#uTitle')?.value || '') + ' ' + (m.$('#uDesc')?.value || '') + ' ' + (m.$('#uKw')?.value || '');
    const r = await api('docs.suggest', undefined, { query: { text } });
    const usable = r.suggest.filter((s) => fieldsForType(m.$('#uCt').value).some((f) => f.type === 'term' && f.termset_id === s.termset_id));
    m.$('#uSuggest').innerHTML = usable.length ? `<div class="alert teal">${icon('sparkle')}<div class="grow"><b>Suggested tags</b><div class="chips" style="margin-top:6px">${usable.map((s) => `<button class="chip add" data-sg="${s.id}" type="button">${icon('plus', 'sm')}${esc(s.label)} <span class="faint">· ${esc(s.termset)}</span></button>`).join('')}</div></div></div>` : '';
  };
  const addFiles = (list) => {
    for (const f of list) {
      const ext = f.name.split('.').pop().toLowerCase();
      if (S.settings.allowed_ext?.length && !S.settings.allowed_ext.includes(ext)) { toast(`.${ext} files aren't allowed here.`, 'err'); continue; }
      if (f.size > S.settings.max_upload_mb * 1048576) { toast(`${f.name} is larger than ${S.settings.max_upload_mb} MB.`, 'err'); continue; }
      if (doc) queue.length = 0;
      if (!queue.some((q) => q.file.name === f.name && q.file.size === f.size)) queue.push({ file: f, state: '', progress: 0 });
    }
    drawQueue(); checkNames(); suggest();
  };
  const drawProps = () => { if (doc) return; props = renderFieldInputs(m.$('#uFields'), fieldsForType(m.$('#uCt').value)); suggest(); };
  const ctDefaults = () => {
    const ct = S.tax.content_types.find((c) => c.id === +m.$('#uCt').value);
    if (ct?.review_months && !m.$('#uReview').value) m.$('#uReview').value = localISODate(0, ct.review_months);
  };

  // wiring
  const drop = m.$('#uDrop'), fi = m.$('#uFile');
  drop.addEventListener('click', () => fi.click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fi.click(); } });
  fi.addEventListener('change', () => { addFiles([...fi.files]); fi.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => addFiles([...e.dataTransfer.files]));
  m.el.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); if (!drop.contains(e.target)) addFiles([...e.dataTransfer.files]); });
  m.el.addEventListener('dragover', (e) => e.preventDefault());
  m.$('#uQueue').addEventListener('click', (e) => { const b = e.target.closest('[data-rmq]'); if (b) { queue.splice(+b.dataset.rmq, 1); drawQueue(); } });
  m.$('#uSuggest').addEventListener('click', (e) => { const b = e.target.closest('[data-sg]'); if (b && props?.addTerm(+b.dataset.sg)) b.remove(); });
  m.$('#uLib')?.addEventListener('change', (e) => { lib = +e.target.value; folder = null; drawModes(); fillFolders(); });
  m.$('#uFolder')?.addEventListener('change', (e) => { folder = +e.target.value || null; checkNames(); });
  m.$('#uCt')?.addEventListener('change', () => { drawProps(); ctDefaults(); });
  m.$('#uConf')?.addEventListener('change', (e) => { const h = m.$('#uConfHint'); h.textContent = CONF_HELP[e.target.value]; h.classList.toggle('warn', isSensitive(e.target.value)); });
  m.$('#uTitle')?.addEventListener('input', debounce(suggest, 400));
  m.$('#uKw')?.addEventListener('input', debounce(suggest, 400));

  drawModes(); await fillFolders(); drawProps(); addFiles(files);

  m.$('[data-ok]').onclick = async () => {
    const pending = queue.filter((q) => !q.state);
    if (!pending.length) return;
    if (props) { const miss = props.missing(); if (miss.length) return toast('Fill in: ' + miss.join(', '), 'err'); }
    const mode = m.$('input[name=um]:checked')?.value || 'draft';
    const btn = m.$('[data-ok]'); btn.disabled = true;
    let ok = 0;
    for (const q of pending) {
      const fd = new FormData();
      fd.append('file', q.file);
      fd.append('submit', mode);
      if (doc) { fd.append('document_id', doc.id); fd.append('comment', m.$('#uComment').value); }
      else {
        fd.append('library_id', lib); if (folder) fd.append('folder_id', folder);
        fd.append('content_type_id', m.$('#uCt').value); fd.append('confidentiality', m.$('#uConf').value); fd.append('review_date', m.$('#uReview').value);
        fd.append('description', m.$('#uDesc').value); fd.append('keywords', m.$('#uKw').value);
        if (pending.length === 1 && queue.length === 1 && m.$('#uTitle').value.trim()) fd.append('title', m.$('#uTitle').value.trim());
        fd.append('meta', JSON.stringify(props ? props.collect() : {}));
        if (q.existing) fd.append('comment', 'New upload with the same file name');
      }
      q.state = 'uploading'; drawQueue();
      try {
        const r = await xhrUpload(fd, (p) => { q.progress = p; drawQueue(); });
        q.state = 'done'; q.id = r.id; ok++;
        const verb = r.status === 'published' ? 'published' : r.status === 'pending' ? 'sent for approval' : 'saved as draft';
        q.msg = (r.versioned ? `Version ${r.version} of “${r.title}”` : `Version ${r.version}`) + ' · ' + verb + (r.indexed ? ' · text indexed' : '');
        if (r.needs_ocr && ocrEnqueue({ docId: r.id, versionId: r.version_id, title: r.title, ext: r.ext, file: q.file })) q.msg += ' · scan detected — reading its text in the background';
        if (r.duplicates?.length) { q.msg += ` · Same file also in: ${r.duplicates.map((d) => d.title).join(', ')}`; }
      } catch (e) { q.state = 'error'; q.msg = e.message; }
      drawQueue();
    }
    btn.disabled = false;
    if (ok) { onDone && onDone(); refreshCounts(); loadLibs(true).then(renderSideLibs); }
    if (ok === pending.length) {
      toast(ok === 1 ? 'Uploaded.' : `${ok} files uploaded.`);
      if (doc || ok === 1) { m.close(); const id = queue.find((q) => q.id)?.id; if (doc || !onDone) go('#/doc/' + id); }
      else { btn.textContent = 'Done'; btn.disabled = false; btn.onclick = () => m.close(); }
    }
  };
}

function xhrUpload(fd, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', 'api.php?r=docs.upload');
    x.setRequestHeader('X-CSRF-Token', S.csrf);
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total * 100); };
    x.onload = () => {
      let j = null; try { j = JSON.parse(x.responseText); } catch (e) {}
      if (x.status === 413) return reject(new Error('The file is larger than the server allows. Ask the administrator to raise the upload limit.'));
      if (!j) return reject(new Error('Upload failed (' + x.status + '). The file may exceed the server limit.'));
      j.ok ? resolve(j) : reject(new Error(j.error));
    };
    x.onerror = () => reject(new Error('Connection lost during upload.'));
    x.send(fd);
  });
}
/* Document page: preview, title block, properties, versions, approvals, comments, activity */
'use strict';

const ACTION_TEXT = { upload: 'uploaded the first version', new_version: 'uploaded a new version', submit: 'sent it for approval', approve: 'approved and published it', reject: 'requested changes',
  publish: 'published it', comment: 'commented', view: 'viewed it', download: 'downloaded it', edit_properties: 'edited properties', checkout: 'checked it out', checkin: 'checked it in',
  discard_checkout: 'released the check-out', restore_version: 'restored an earlier version', move: 'moved it', delete: 'moved it to the recycle bin', restore: 'restored it from the recycle bin',
  withdraw: 'withdrew the approval request', permissions_change: 'changed permissions', link: 'linked a related document' };

route('/doc/(\\d+)', async (page, [id], params) => {
  id = +id;
  await Promise.all([loadTax(), loadDir()]);
  const r = await api('docs.get', undefined, { query: { id } });
  const d = r.doc, c = d.can;
  setTitle(d.title);
  const tab = params.tab || 'comments';
  const pend = d.status === 'pending';
  const lastReject = r.approvals.find((a) => a.decision === 'rejected');
  const previewUrl = `download.php?id=${d.id}&v=${d.version_id}&inline=1`;
  const words = (params.hl || '').split(/\s+/).filter(Boolean);
  // The seal "presses" onto the title block right after this person approves the document.
  let pressed = false;
  try { pressed = sessionStorage.getItem('km-pressed') === String(id) && d.status === 'published'; sessionStorage.removeItem('km-pressed'); } catch (e) {}

  let preview;
  if (r.preview.kind === 'pdf') preview = `<iframe src="${previewUrl}#view=FitH" title="Preview of ${esc(d.title)}"></iframe>`;
  else if (r.preview.kind === 'image') preview = `<div class="img-wrap"><img src="${previewUrl}" alt="${esc(d.title)}"></div>`;
  else if (r.preview.kind === 'video') preview = `<video src="${previewUrl}" controls style="width:100%;display:block;max-height:72vh;background:#000"></video>`;
  else if (r.preview.kind === 'audio') preview = `<div style="padding:30px"><audio src="${previewUrl}" controls style="width:100%"></audio></div>`;
  else if (r.preview.kind === 'text') preview = `<pre>${highlight(r.preview.text, words)}</pre>`;
  else preview = `<div class="empty">${fileIcon(d.ext)}<h3>No preview for .${esc(d.ext)} files</h3><p>Download the file to open it in its own application.</p><a class="btn primary" href="download.php?id=${d.id}">${icon('download')}Download</a></div>`;

  page.innerHTML = `
    <div class="crumbs"><a href="#/">Home</a>${icon('right')}<a href="#/lib/${r.library.id}">${esc(r.library.name)}</a>${r.path.map((f) => `${icon('right')}<a href="#/lib/${r.library.id}/f/${f.id}">${esc(f.name)}</a>`).join('')}</div>
    <div class="doc-head">${fileIcon(d.ext)}<h1>${esc(d.title)}</h1>
      <div class="btn-row">
        <button class="btn ${d.favorite ? 'primary' : ''}" data-a="fav" title="Favourite">${icon('star')}${d.favorite ? 'Favourite' : 'Add to favourites'}</button>
        <a class="btn" href="download.php?id=${d.id}&v=${d.version_id}">${icon('download')}Download</a>
        ${c.upload_version ? `<button class="btn" data-a="version">${icon('upload')}New version</button>` : ''}
        <button class="btn ghost" data-a="more" aria-label="More actions">${icon('more')}</button>
      </div></div>
    <div id="alerts" class="side-stack" style="margin-bottom:16px">
      ${pend ? `<div class="alert amber">${icon('clock')}<div class="grow"><b>Waiting for approval</b>${c.approve ? 'You can approve this version. Approving publishes it to everyone with read access.' : 'A department head will review this version before it’s published.'}</div>
        ${c.approve ? `<button class="btn sm approve" data-a="approve">${icon('check', 'sm')}Approve</button><button class="btn sm" data-a="reject">Request changes</button>` : ''}
        ${c.cancel_request ? `<button class="btn sm ghost" data-a="withdraw">Withdraw</button>` : ''}</div>` : ''}
      ${d.status === 'rejected' && lastReject ? `<div class="alert red">${icon('alert')}<div class="grow"><b>${esc(lastReject.decider)} requested changes</b>${esc(lastReject.note)}</div>${c.upload_version ? `<button class="btn sm" data-a="version">Upload fix</button>` : ''}</div>` : ''}
      ${!S.settings.approvals && d.status !== 'published' && c.publish_direct ? `<div class="alert teal">${icon('info')}<div class="grow"><b>Not published yet</b>This version was saved before direct publishing was switched on, so only you and a few others can see it.</div><button class="btn sm primary" data-a="publish">${icon('check', 'sm')}Publish now</button></div>` : ''}
      ${d.status === 'draft' && c.submit ? `<div class="alert teal">${icon('info')}<div class="grow"><b>Draft</b>Only you and approvers can see this version.</div><button class="btn sm primary" data-a="submit">${icon('send', 'sm')}Send for approval</button>${c.publish_direct ? `<button class="btn sm" data-a="approve">Publish now</button>` : ''}</div>` : ''}
      ${d.checked_out_by ? `<div class="alert amber">${icon('lock')}<div class="grow"><b>Checked out by ${d.checked_out_by === S.user.id ? 'you' : esc(d.checked_out_name)}</b>${d.checked_out_by === S.user.id ? 'Upload the new version to check it in automatically, or release it.' : 'You can read it, but new versions are blocked until it’s checked in.'}</div>
        ${d.checked_out_by === S.user.id || c.permissions ? `<button class="btn sm" data-a="checkin">Release</button>` : ''}</div>` : ''}
      ${r.ocr?.needed ? `<div class="alert teal" id="ocrNotice">${icon('search')}<div class="grow"><b>Words in this file can't be searched yet</b>It's a scan or a picture, so it contains no real text. ${r.ocr.can ? 'Text recognition reads the words so search can find them — it runs here in your browser.' : 'The author or an approver can make it searchable.'}</div>
        ${r.ocr.can ? `<button class="btn sm primary" data-a="ocr">${icon('sparkle', 'sm')}Make it searchable</button>` : ''}</div>` : ''}
      ${c.review && (d.review_overdue || d.review_due_soon) ? `<div class="alert amber">${icon('history')}<div class="grow"><b>${d.review_overdue ? 'Review overdue' : 'Review due soon'}</b>${d.review_overdue ? 'This document was due for review on' : 'This document is due for review on'} ${esc(fmtDate(d.review_date))}. Check it is still correct, upload a new version if anything changed, then mark it as reviewed.</div>
        <button class="btn sm" data-a="reviewed">${icon('check', 'sm')}Mark as reviewed</button></div>` : ''}
    </div>
    <div class="doc-page">
      <div>
        <div class="preview ${isSensitive(d.confidentiality) ? 'has-wm' : ''}"><div class="preview-bar">${icon('eye', 'sm')}<span>${esc(d.filename)} · ${fmtSize(d.size)} · version ${esc(d.version)}${r.preview.extracted ? ' · text view' : ''}</span>
          ${r.ocr?.source === 'ocr' ? `<span class="pill ocr-pill" title="Recognised ${esc(fmtDate(r.ocr.at, true))}">${icon('sparkle', 'sm')}Searchable text from scan${r.ocr.confidence != null ? ' · ' + r.ocr.confidence + '% confidence' : ''}</span>
            <button class="linklike" data-a="ocrview">${words.length ? 'View file' : 'View recognised text'}</button>${r.ocr.can ? `<button class="linklike" data-a="ocr" title="Run text recognition again">Read again</button>` : ''}` : ''}
          ${['pdf', 'image'].includes(r.preview.kind) ? `<a style="margin-left:auto" href="${previewUrl}" target="_blank" rel="noopener">Open full screen</a>` : ''}</div>${isSensitive(d.confidentiality) ? watermark(d.confidentiality) : ''}${sheetFrame(`<div id="previewBody">${r.ocr?.source === 'ocr' && words.length ? ocrTextView(r.ocr.text, words) : preview}</div>`)}</div>
        <div style="margin-top:22px">
          <div class="tabs" role="tablist">
            <button data-tab="comments" class="${tab === 'comments' ? 'on' : ''}">${icon('message', 'sm')}Comments <span class="n">${r.comments.length}</span></button>
            <button data-tab="versions" class="${tab === 'versions' ? 'on' : ''}">${icon('history', 'sm')}Versions <span class="n">${r.versions.length}</span></button>
            ${S.settings.approvals ? `<button data-tab="approvals" class="${tab === 'approvals' ? 'on' : ''}">${icon('stamp', 'sm')}Approvals</button>` : ''}
            <button data-tab="activity" class="${tab === 'activity' ? 'on' : ''}">${icon('activity', 'sm')}Activity</button>
          </div>
          <div id="tabBody"></div>
        </div>
      </div>
      <div class="side-stack">
        ${titleBlock(d, r.approvals, { press: pressed })}
        <div class="panel"><div class="panel-h"><h3>Properties</h3>${c.edit ? `<button class="btn sm ghost" data-a="edit">${icon('edit', 'sm')}Edit</button>` : ''}</div>
          <div class="panel-b"><dl class="kv">
            ${d.description ? `<dt>Description</dt><dd>${esc(d.description)}</dd>` : ''}
            ${r.props.filter((p) => (Array.isArray(p.value) ? p.value.length : p.value)).map((p) => `<dt>${esc(p.name)}</dt><dd>${propValue(p)}</dd>`).join('')}
            ${d.keywords ? `<dt>Keywords</dt><dd><div class="chips">${d.keywords.split(',').map((k) => k.trim()).filter(Boolean).map((k) => `<a class="chip ghost" href="#/search?q=${encodeURIComponent(k)}">${esc(k)}</a>`).join('')}</div></dd>` : ''}
            <dt>Classification</dt><dd>${conf(d.confidentiality)}${d.classification_rule ? `<div class="small muted" style="margin-top:4px">${esc(d.classification_rule)}${d.named_count ? ` ${plural(d.named_count, 'person or group', 'people or groups')} named.` : ''}${c.permissions ? ` <a href="" data-a="perms">Manage who can see it</a>` : ''}</div>` : ''}</dd>
            ${d.review_date ? `<dt>Next review</dt><dd>${esc(fmtDate(d.review_date))}${d.review_overdue ? ' <span style="color:var(--amber)">· overdue</span>' : ''}</dd>` : ''}
            ${d.last_reviewed ? `<dt>Last reviewed</dt><dd>${esc(fmtDate(d.last_reviewed))}</dd>` : ''}
            <dt>Created</dt><dd>${esc(fmtDate(d.created_at))}</dd>
            <dt>Usage</dt><dd>${plural(d.views, 'view')} by ${plural(d.viewers, 'person', 'people')} · ${plural(d.downloads, 'download')}</dd>
            <dt>Your access</dt><dd>${esc(r.level_name)}${d.inherit ? '' : ' · unique permissions'}</dd>
          </dl></div>
          ${r.suggest.length ? `<div class="panel-b" style="border-top:1px solid var(--line)"><div class="label" style="display:flex;gap:6px;align-items:center;margin-bottom:8px">${icon('sparkle', 'sm')}Suggested tags from the content</div>
            <div class="chips">${r.suggest.map((s) => `<button class="chip add" data-addterm="${s.id}" title="${esc(s.termset)}">${icon('plus', 'sm')}${esc(s.label)}</button>`).join('')}</div></div>` : ''}
        </div>
        <div class="panel"><div class="panel-h"><h3>Related documents</h3>${c.edit ? `<button class="btn sm ghost" data-a="link">${icon('link', 'sm')}Link</button>` : ''}</div>
          <div class="doc-rows">${r.related.map((x) => miniRow(x, c.edit ? `<button class="mini-btn" data-unlink="${x.id}" title="Remove link">${icon('x', 'sm')}</button>` : '')).join('') || '<div class="panel-b faint small">No linked documents yet.</div>'}</div>
          ${r.similar.length ? `<div class="panel-h" style="border-top:1px solid var(--line)"><h3 class="muted" style="font-size:13px">Similar by tags</h3></div><div class="doc-rows">${r.similar.map((x) => miniRow(x, `<span class="faint small">${x.shared} shared</span>`)).join('')}</div>` : ''}
        </div>
      </div>
    </div>`;

  // A scan of this document is being read right now (e.g. just uploaded): say so, and refresh when it finishes.
  if (r.ocr?.needed && ocrJobFor(r.ocr.version_id)) {
    const n = $('#ocrNotice');
    if (n) { n.querySelector('.grow').innerHTML = '<b>Reading the text…</b>This scan is being made searchable. Keep this tab open; the page updates when it finishes.'; n.querySelector('[data-a=ocr]')?.remove(); }
    const onDone = (job) => { if (job.versionId === r.ocr.version_id) { OCRQ.listeners.delete(onDone); if (location.hash.startsWith('#/doc/' + d.id)) navigate(); } };
    OCRQ.listeners.add(onDone);
  }

  const drawTab = (t) => {
    $$('.tabs button', page).forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    const body = $('#tabBody');
    if (t === 'comments') {
      body.innerHTML = `<div class="panel"><div class="panel-b">${r.comments.map((cm) => `<div class="comment">${avatar(cm.name)}<div><div class="meta"><b style="color:var(--text)">${esc(cm.name)}</b> · ${ago(cm.created_at)}
        ${cm.user_id === S.user.id || S.user.is_admin ? ` · <a href="" data-delc="${cm.id}">Delete</a>` : ''}</div><p>${renderMentions(cm.body)}</p></div></div>`).join('') || '<p class="faint" style="margin:0 0 10px">No comments yet. Ask a question or leave review notes — type @ and a name to notify a colleague.</p>'}
        <div style="margin-top:12px;display:grid;gap:8px"><textarea class="input" id="cBody" placeholder="Add a comment… use @Name to mention someone"></textarea>
        <div class="btn-row" style="justify-content:flex-end"><button class="btn primary" id="cSend">${icon('send', 'sm')}Comment</button></div></div></div></div>`;
      $('#cSend').onclick = async () => { const b = $('#cBody').value.trim(); if (!b) return; await run(api('docs.comment', { id, body: b }), 'Comment added.'); go(`#/doc/${id}?tab=comments`); };
      mentionAssist($('#cBody'));
    }
    if (t === 'versions') {
      body.innerHTML = `<div class="panel"><div class="panel-h"><h3>Version history</h3>${r.versions.length > 1 ? `<button class="btn sm" data-a="compare">${icon('compare', 'sm')}Compare versions</button>` : ''}</div>
        <div style="overflow-x:auto"><table class="ver-table"><thead><tr><th>Version</th><th>Status</th><th>Uploaded</th><th>Note</th><th>Size</th><th></th></tr></thead><tbody>
        ${r.versions.map((v) => `<tr><td>${revDelta(v.label, v.is_published ? 'pub' : '')}</td>
          <td>${v.is_published ? '<span class="status published">Published</span>' : v.is_current ? statusTag(d.status) : v.label.endsWith('.0') ? '<span class="faint">Superseded</span>' : '<span class="faint">Draft</span>'}</td>
          <td>${esc(v.uploader || '')}<div class="faint small">${esc(fmtDate(v.created_at, true))}</div></td>
          <td class="small">${esc(v.comment || '')}<div class="faint mono" style="font-size:11px" title="SHA-256 checksum">${esc(v.sha256.slice(0, 12))}</div></td>
          <td class="nowrap">${fmtSize(v.size)}</td>
          <td class="nowrap"><a class="btn sm ghost" href="download.php?id=${d.id}&v=${v.id}" title="Download">${icon('download', 'sm')}</a>
            ${c.restore_version && !v.is_current ? `<button class="btn sm ghost" data-restore="${v.id}" title="Restore this version">${icon('undo', 'sm')}Restore</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div></div>`;
    }
    if (t === 'approvals') {
      body.innerHTML = `<div class="panel"><div class="panel-b">${r.approvals.length ? `<ul class="timeline">${r.approvals.map((a) => `<li class="${a.decision === 'approved' ? 'pub' : ''}">
        <b>Version ${esc(a.version)}</b> — ${{ pending: '<span class="status pending">Waiting</span>', approved: '<span class="status published">Approved</span>', rejected: '<span class="status rejected">Changes requested</span>', cancelled: '<span class="faint">Withdrawn</span>' }[a.decision]}
        <div class="when">Requested by ${esc(a.requester || '—')} · ${esc(fmtDate(a.requested_at, true))}${a.decided_at ? ` · decided by ${esc(a.decider || '—')} ${esc(fmtDate(a.decided_at, true))}` : ''}</div>
        ${a.note ? `<div class="small" style="margin-top:4px">“${esc(a.note)}”</div>` : ''}</li>`).join('')}</ul>` : '<p class="faint" style="margin:0">No approval requests yet.</p>'}</div></div>`;
    }
    if (t === 'activity') {
      body.innerHTML = `<div class="panel"><ul class="feed">${r.activity.map((a) => `<li>${avatar(a.name || 'System')}<div><b>${esc(a.name || 'System')}</b> ${esc(ACTION_TEXT[a.action] || a.action.replace(/_/g, ' '))}
        ${a.details && !['view'].includes(a.action) ? `<span class="faint"> — ${esc(a.details)}</span>` : ''}<span class="when">${esc(fmtDate(a.created_at, true))}</span></div></li>`).join('')}</ul></div>`;
    }
  };
  drawTab(tab);

  page.addEventListener('click', async (e) => {
    const t = e.target;
    const tb = t.closest('[data-tab]'); if (tb) return drawTab(tb.dataset.tab);
    const dc = t.closest('[data-delc]'); if (dc) { e.preventDefault(); if (await confirmBox('Delete this comment?', { danger: true, ok: 'Delete' })) { await run(api('docs.comment_delete', { id: +dc.dataset.delc })); go(`#/doc/${id}?tab=comments`); } return; }
    const rs = t.closest('[data-restore]'); if (rs) { if (await confirmBox(S.settings.approvals ? 'Restore this version as a new draft? The current version stays in history.' : 'Publish this old version again as the newest version? Nothing is lost — the current version stays in history.', { ok: 'Restore' })) { await run(api('docs.restore_version', { id, version_id: +rs.dataset.restore }), (x) => x.message); navigate(); } return; }
    const at = t.closest('[data-addterm]'); if (at) { await run(api('docs.update', { id, add_term: +at.dataset.addterm }), 'Tag added.'); return navigate(); }
    const ul = t.closest('[data-unlink]'); if (ul) { e.preventDefault(); await run(api('docs.link', { id, related_id: +ul.dataset.unlink, remove: '1' }), 'Link removed.'); return navigate(); }
    const a = t.closest('[data-a]'); if (!a) return;
    const act = a.dataset.a;
    if (act === 'fav') { await api('docs.favorite', { id }); return navigate(); }
    if (act === 'version') return openUpload({ documentId: id, onDone: navigate });
    if (act === 'approve') { const note = await promptBox({ title: 'Approve and publish', label: 'Note for the author (optional)', textarea: true, required: false, ok: 'Approve & publish' }); if (note === null) return; await run(api('docs.approve', { id, note }), (x) => x.message); try { sessionStorage.setItem('km-pressed', String(id)); } catch (e) {} refreshCounts(); return navigate(); }
    if (act === 'publish') { if (!await confirmBox('Publish this version? Everyone with access to the library will be able to read it, and it can’t be deleted afterwards.', { ok: 'Publish' })) return; await run(api('docs.approve', { id }), (x) => x.message); try { sessionStorage.setItem('km-pressed', String(id)); } catch (e) {} return navigate(); }
    if (act === 'reject') { const note = await promptBox({ title: 'Request changes', label: 'What should the author change?', textarea: true, ok: 'Send back' }); if (!note) return; await run(api('docs.reject', { id, note }), (x) => x.message); refreshCounts(); return navigate(); }
    if (act === 'submit') { const note = await promptBox({ title: 'Send for approval', label: 'Message for the approver (optional)', textarea: true, required: false, ok: 'Send for approval' }); if (note === null) return; await run(api('docs.submit', { id, note }), 'Sent for approval.'); return navigate(); }
    if (act === 'withdraw') { await run(api('docs.cancel_request', { id }), 'Request withdrawn.'); return navigate(); }
    if (act === 'checkin') { await run(api('docs.checkout', { id, action: 'in' }), 'Released.'); return navigate(); }
    if (act === 'edit') return editProps(r, navigate);
    if (act === 'link') return linkDoc(id);
    if (act === 'compare') return compareVersions(id, r.versions);
    if (act === 'more') return moreMenu(a, r);
    if (act === 'reviewed') return markReviewed(d, navigate);
    if (act === 'perms') { e.preventDefault(); return openPermissions('document', d.id, d.title, navigate); }
    if (act === 'ocrview') {
      const showingText = !!$('#previewBody .ocr-text');
      $('#previewBody').innerHTML = showingText ? preview : ocrTextView(r.ocr.text, words);
      a.textContent = showingText ? 'View recognised text' : 'View file';
      return;
    }
    if (act === 'ocr') {
      if (!ocrEnqueue({ docId: d.id, versionId: r.ocr.version_id, title: d.title, ext: r.ocr.ext })) return toast('Already being read.');
      const n = $('#ocrNotice'); if (n) n.querySelector('.grow').innerHTML = '<b>Reading the text…</b>Keep this tab open. You can carry on using the Hub; this page updates when it finishes.';
      a.disabled = true;
      const onDone = (job) => { if (job.versionId === r.ocr.version_id) { OCRQ.listeners.delete(onDone); if (location.hash.startsWith('#/doc/' + d.id)) navigate(); } };
      OCRQ.listeners.add(onDone);
      return;
    }
  });
});

function miniRow(x, right = '') {
  return `<a class="doc-row" href="#/doc/${x.id}">${fileIcon(x.ext, 'sm')}<div style="min-width:0"><div class="t">${esc(x.title)}</div><div class="s">${esc(x.doc_number || '')} · ${esc(x.library)}</div></div><span class="r">${right}</span></a>`;
}
function renderMentions(body) {
  let out = esc(body);
  (S.dir?.people || []).forEach((p) => { const n = esc('@' + p.name); if (out.includes(n)) out = out.split(n).join(`<a class="mention" href="#/person/${p.id}">${n}</a>`); });
  return out;
}
function mentionAssist(ta) {
  let menu = null;
  const close = () => { menu?.remove(); menu = null; };
  ta.parentElement.style.position = 'relative';
  ta.addEventListener('input', () => {
    const before = ta.value.slice(0, ta.selectionStart);
    const m = before.match(/@([\w .'-]{0,30})$/);
    if (!m) return close();
    const q = m[1].toLowerCase();
    const list = (S.dir?.people || []).filter((p) => p.name.toLowerCase().startsWith(q) || p.name.toLowerCase().includes(' ' + q)).slice(0, 6);
    if (!list.length) return close();
    if (!menu) { menu = document.createElement('div'); menu.className = 'tp-menu'; menu.style.top = ta.offsetHeight + 'px'; ta.parentElement.appendChild(menu); }
    menu.innerHTML = list.map((p) => `<button type="button" data-p="${esc(p.name)}">${avatar(p.name)} ${esc(p.name)}<span class="path">${esc(p.department || '')}</span></button>`).join('');
    menu.onmousedown = (e) => {
      const b = e.target.closest('[data-p]'); if (!b) return; e.preventDefault();
      const start = before.length - m[0].length;
      ta.value = ta.value.slice(0, start) + '@' + b.dataset.p + ' ' + ta.value.slice(ta.selectionStart);
      close(); ta.focus();
    };
  });
  ta.addEventListener('blur', () => setTimeout(close, 150));
}

function moreMenu(anchor, r) {
  const d = r.doc, c = d.can;
  const items = [
    c.checkout && !d.checked_out_by ? ['lock', 'Check out (lock for editing)', async () => { await run(api('docs.checkout', { id: d.id, action: 'out' }), (x) => x.message); navigate(); }] : null,
    c.edit ? ['edit', 'Edit properties', () => editProps(r, navigate)] : null,
    ['link', 'Copy link', () => { navigator.clipboard?.writeText(location.origin + location.pathname + '#/doc/' + d.id); toast('Link copied.'); }],
    c.move ? ['move', 'Move', () => openMove([d.id], navigate)] : null,
    c.permissions ? ['shield', 'Manage permissions', () => openPermissions('document', d.id, d.title, navigate)] : null,
    S.user.is_admin ? ['activity', 'Full audit trail', () => go(`#/admin/audit?object_type=document&object_id=${d.id}`)] : null,
    c.delete ? ['trash', 'Delete', async () => { if (!await confirmBox('Move this document and all its versions to the recycle bin?', { danger: true, ok: 'Delete' })) return; await run(api('docs.delete', { id: d.id }), 'Moved to the recycle bin.'); go('#/lib/' + d.library_id); }] : null,
  ].filter(Boolean);
  const m = modal({ title: 'More actions', body: `<div style="display:grid;gap:4px">${items.map((it, i) => `<button class="btn ghost" style="justify-content:flex-start" data-i="${i}">${icon(it[0])}${esc(it[1])}</button>`).join('')}</div>` });
  m.el.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) { m.close(); items[+b.dataset.i][2](); } });
}

async function editProps(r, onDone) {
  const d = r.doc;
  const values = {};
  r.props.forEach((p) => { values[p.field_id] = p.type === 'user' ? p.value?.id : p.value; });
  const m = modal({ title: 'Edit properties', size: 'wide', body: `
    <div class="field"><label>Title</label><input class="input" id="eTitle" value="${esc(d.title)}"></div>
    <div class="grid3">
      <div class="field"><label>Content type</label><select class="input" id="eCt"><option value="">General document</option>${S.tax.content_types.map((c) => `<option value="${c.id}" ${c.id === d.content_type_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Classification</label><select class="input" id="eConf" ${d.can.classify ? '' : 'disabled title="Only the author, an approver or someone with Full control can change this"'}>${['public', 'internal', 'confidential', 'restricted'].map((c) => `<option value="${c}" ${d.confidentiality === c ? 'selected' : ''}>${c.charAt(0).toUpperCase() + c.slice(1)}</option>`).join('')}</select></div>
      <div class="field"><label for="eReview">Next review date</label><input class="input" type="date" id="eReview" value="${esc(d.review_date || '')}" min="${localISODate(1)}"><span class="hint">Leave empty for no periodic review.</span></div>
    </div>
    ${d.level >= 4 ? `<div class="field"><label>Document number</label><input class="input mono" id="eNum" value="${esc(d.doc_number || '')}"></div>` : ''}
    <div class="hint conf-hint ${isSensitive(d.confidentiality) ? 'warn' : ''}" id="eConfHint">${esc(CONF_HELP[d.confidentiality])}${d.confidentiality === 'restricted' ? '' : ''}</div>
    <div id="eFields"></div>
    <div class="field"><label>Description</label><textarea class="input" id="eDesc">${esc(d.description)}</textarea></div>
    <div class="field"><label>Keywords</label><input class="input" id="eKw" value="${esc(d.keywords)}"></div>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>Save properties</button>` });
  let props = renderFieldInputs(m.$('#eFields'), fieldsForType(d.content_type_id), values);
  m.$('#eConf').addEventListener('change', (e) => {
    const v = e.target.value, h = m.$('#eConfHint');
    h.textContent = CONF_HELP[v] + (v === 'restricted' && d.confidentiality !== 'restricted' ? ' Saving switches this document to its own permission list — add people under ⋯ → Manage permissions.' : '')
      + (d.confidentiality === 'restricted' && v !== 'restricted' ? ' Saving returns it to the library’s permissions and removes the people named on it.' : '');
    h.classList.toggle('warn', isSensitive(v));
  });
  m.$('#eCt').addEventListener('change', () => { props = renderFieldInputs(m.$('#eFields'), fieldsForType(m.$('#eCt').value), values); });
  m.$('[data-ok]').onclick = async () => {
    const miss = props.missing(); if (miss.length) return toast('Fill in: ' + miss.join(', '), 'err');
    const payload = { id: d.id, title: m.$('#eTitle').value, description: m.$('#eDesc').value, keywords: m.$('#eKw').value, content_type_id: +m.$('#eCt').value || 0,
      confidentiality: m.$('#eConf').value, review_date: m.$('#eReview').value, meta: props.collect() };
    if (m.$('#eNum')) payload.doc_number = m.$('#eNum').value;
    await run(api('docs.update', payload), 'Properties saved.');
    m.close(); onDone();
  };
}

async function linkDoc(id) {
  const m = modal({ title: 'Link a related document', body: `<div class="field"><label>Find a document</label><input class="input" id="lq" placeholder="Title or document number"></div><div id="lres" class="doc-rows"></div>` });
  m.$('#lq').addEventListener('input', debounce(async (e) => {
    const q = e.target.value.trim(); if (q.length < 2) { m.$('#lres').innerHTML = ''; return; }
    const r = await api('search.suggest', undefined, { query: { q } });
    m.$('#lres').innerHTML = r.docs.filter((x) => x.id !== id).map((x) => `<a class="doc-row" href="" data-pick="${x.id}">${fileIcon(x.ext, 'sm')}<div><div class="t">${esc(x.title)}</div><div class="s">${esc(x.doc_number || '')}</div></div><span class="r">${icon('plus', 'sm')}</span></a>`).join('') || '<p class="faint small">No matches.</p>';
  }, 200));
  m.$('#lres').addEventListener('click', async (e) => { const a = e.target.closest('[data-pick]'); if (!a) return; e.preventDefault(); await run(api('docs.link', { id, related_id: +a.dataset.pick }), 'Linked.'); m.close(); navigate(); });
}

async function compareVersions(id, versions) {
  const opt = (sel) => versions.map((v) => `<option value="${v.id}" ${v.id === sel ? 'selected' : ''}>${esc(v.label)} — ${esc(fmtDate(v.created_at))}</option>`).join('');
  const m = modal({ title: 'Compare versions', size: 'xwide', body: `<div class="grid2"><div class="field"><label>Older</label><select class="input" id="va">${opt(versions[1]?.id)}</select></div>
    <div class="field"><label>Newer</label><select class="input" id="vb">${opt(versions[0].id)}</select></div></div>
    <p class="faint small" style="margin:0">Compares the text content. Added lines are green, removed lines are red.</p><div class="diff" id="vd"></div>` });
  const draw = async () => {
    const r = await api('docs.compare', undefined, { query: { id, a: m.$('#va').value, b: m.$('#vb').value } });
    m.$('#vd').innerHTML = (r.a.text || r.b.text) ? lineDiff(r.a.text, r.b.text) : '<span class="faint">No text could be read from these files (for example scanned PDFs or drawings).</span>';
  };
  m.$('#va').onchange = draw; m.$('#vb').onchange = draw; draw();
}
function lineDiff(a, b) {
  const A = a.split('\n').slice(0, 1500), B = b.split('\n').slice(0, 1500);
  const n = A.length, mm = B.length, L = Array.from({ length: n + 1 }, () => new Uint16Array(mm + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = mm - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  let i = 0, j = 0; const out = [];
  while (i < n && j < mm) {
    if (A[i] === B[j]) { out.push(esc(A[i])); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) { out.push(`<del>${esc(A[i]) || ' '}</del>`); i++; }
    else { out.push(`<ins>${esc(B[j]) || ' '}</ins>`); j++; }
  }
  while (i < n) out.push(`<del>${esc(A[i++]) || ' '}</del>`);
  while (j < mm) out.push(`<ins>${esc(B[j++]) || ' '}</ins>`);
  return out.join('\n');
}

function ocrTextView(text, words) {
  return `<div class="ocr-text"><p class="faint small" style="margin:0 0 12px">Text recognised automatically from the scan. It's used for search and may contain small reading errors — the file itself is the official version.</p><pre>${highlight(text || '', words)}</pre></div>`;
}

function markReviewed(d, onDone) {
  const months = d.review_months || 12;
  const m = modal({ title: 'Mark as reviewed', body: `<p style="margin:0" class="muted">Confirm “${esc(d.title)}” has been checked and is still correct. If anything needed to change, upload a new version first.</p>
    <div class="field"><label for="rvNext">Next review date</label><input class="input" type="date" id="rvNext" value="${localISODate(0, months)}" min="${localISODate(1)}">
      <span class="hint">${d.review_months ? `This document type is reviewed every ${d.review_months} months.` : 'Suggested: one year from today.'}</span></div>
    <label class="check"><input type="checkbox" id="rvNone"><span>No further review needed</span></label>
    <div class="field"><label for="rvNote">Note <span class="faint">(optional)</span></label><input class="input" id="rvNote" placeholder="e.g. Checked against current procurement policy"></div>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>${icon('check', 'sm')}Mark as reviewed</button>` });
  m.$('#rvNone').onchange = (e) => { m.$('#rvNext').disabled = e.target.checked; };
  m.$('[data-ok]').onclick = async () => {
    await run(api('docs.reviewed', { id: d.id, next: m.$('#rvNone').checked ? '' : m.$('#rvNext').value, note: m.$('#rvNote').value }), (x) => x.message);
    m.close(); onDone();
  };
}
/* Home, collections, search, approvals, people, profile, recycle bin */
'use strict';

const FEED_TEXT = { upload: 'uploaded', new_version: 'added a new version of', approve: 'approved', publish: 'published', comment: 'commented on', reject: 'requested changes to' };

function docRows(docs, right = (d) => ago(d.modified)) {
  return docs.map((d) => `<a class="doc-row" href="#/doc/${d.id}">${fileIcon(d.ext, 'sm')}<div style="min-width:0"><div class="t">${esc(d.title)}</div>
    <div class="s">${esc(d.doc_number || d.filename)} · ${esc(d.library)}</div></div><span class="r">${right(d)}</span></a>`).join('');
}

/* ================= Home ================= */
route('/', async (page) => {
  const r = await api('dash.home');
  setTitle('Home');
  const u = S.user;
  const h = new Date().getHours();
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  page.innerHTML = `
    <div class="hello"><div><h1>${greet}, ${esc(u.name.split(' ')[0])}</h1><p>${esc(S.settings.welcome_text || '')}</p></div>
      <div class="btn-row"><button class="btn primary" id="hUp">${icon('upload')}Upload documents</button><a class="btn" href="#/search">${icon('search')}Search</a></div></div>
    <div class="queue">
      ${S.settings.approvals ? `<a href="#/approvals" class="${r.pending ? 'attn' : ''}"><span class="n">${r.pending}</span><div><b>Waiting for your approval</b><span>${r.pending ? 'Review and publish' : 'Nothing to review'}</span></div></a>
      <a href="#/my/mine"><span class="n">${r.myDrafts}</span><div><b>Your drafts & returns</b><span>Not yet published</span></div></a>`
      : `<a href="#/my/new"><span class="n">${r.newWeek}</span><div><b>New this week</b><span>Published in the last 7 days</span></div></a>
      <a href="#/my/mine"><span class="n">${r.myCount}</span><div><b>Your documents</b><span>${r.myDrafts ? `${r.myDrafts} not yet published` : 'Everything you uploaded'}</span></div></a>`}
      <a href="#/my/review" class="${r.review.length ? 'attn' : ''}"><span class="n">${r.review.length}</span><div><b>Due for review</b><span>Overdue or due within 30 days</span></div></a>
      <a href="#/my/favorites" class="lime"><span class="n">${r.favs.length}</span><div><b>Favourites</b><span>Documents you follow</span></div></a>
    </div>
    <div class="home-grid">
      <div>
        <div class="section-h" style="margin-top:0"><h2>Libraries</h2><span class="faint small">${r.totals.documents} published documents · ${r.totals.versions} versions</span></div>
        <div class="libs">${r.libs.map((l) => `<a class="lib-card" href="#/lib/${l.id}" style="--c:${esc(l.color)}"><div class="lc-top"><span class="lc-ico">${icon(LIB_ICONS[l.icon] || 'folder')}</span><b>${esc(l.name)}</b></div>
          <p>${esc(l.description || '')}</p><div class="lc-meta"><span>${plural(l.count, 'document')}</span><span>${LEVELS[l.level]}</span></div></a>`).join('') || '<p class="faint">No libraries are shared with you yet. An administrator can grant access.</p>'}</div>
        ${r.viewed.length ? `<div class="section-h"><h2>Pick up where you left off</h2><a href="#/my/recent">All recent</a></div><div class="panel doc-rows">${docRows(r.viewed.slice(0, 5))}</div>` : ''}
        <div class="section-h"><h2>Recently updated</h2></div>
        <div class="panel doc-rows">${docRows(r.recent, (d) => `${statusTag(d.status)}<div>${ago(d.modified)}</div>`) || '<div class="empty">No documents yet.</div>'}</div>
      </div>
      <div class="side-stack">
        <div class="panel"><div class="panel-h"><h3>Announcements</h3>${u.is_admin || u.is_head ? `<button class="btn sm ghost" id="annNew">${icon('plus', 'sm')}Post</button>` : ''}</div>
          ${r.ann.map((a) => `<div class="ann"><b>${a.pinned ? `<span class="pin" title="Pinned">${icon('bookmark', 'sm')}</span> ` : ''}${esc(a.title)}</b><p>${esc(a.body)}</p>
            <span class="faint small">${esc(a.author || '')} · ${ago(a.created_at)}</span>${u.is_admin ? ` · <a href="" class="small" data-ann-del="${a.id}">Remove</a>` : ''}</div>`).join('') || '<div class="panel-b faint small">No announcements.</div>'}</div>
        ${r.review.length ? `<div class="panel"><div class="panel-h"><h3>Review due</h3></div><div class="doc-rows">${docRows(r.review, (d) => d.review_date < localISODate() ? `<span style="color:var(--red)">Overdue</span><div>${esc(fmtDate(d.review_date))}</div>` : `<span style="color:var(--amber)">Due</span><div>${esc(fmtDate(d.review_date))}</div>`)}</div></div>` : ''}
        <div class="panel"><div class="panel-h"><h3>Activity</h3></div><ul class="feed">${r.feed.map((f) => `<li>${avatar(f.who)}<div><b>${esc(f.who)}</b> ${FEED_TEXT[f.action] || f.action} <a href="#/doc/${f.doc_id}">${esc(f.title)}</a><span class="when">${esc(f.library)} · ${ago(f.when)}</span></div></li>`).join('') || '<li class="faint">Quiet so far.</li>'}</ul></div>
      </div>
    </div>`;
  $('#hUp').onclick = () => openUpload({});
  $('#annNew')?.addEventListener('click', async () => {
    const m = modal({ title: 'Post an announcement', body: `<div class="field"><label>Title</label><input class="input" id="aT"></div><div class="field"><label>Message</label><textarea class="input" id="aB"></textarea></div>
      ${u.is_admin ? '<label class="check"><input type="checkbox" id="aP"> Pin to the top</label>' : ''}`, foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>Post</button>` });
    m.$('[data-ok]').onclick = async () => { await run(api('admin.announcement_save', { title: m.$('#aT').value, body: m.$('#aB').value, pinned: m.$('#aP')?.checked ? 1 : 0 }), 'Posted.'); m.close(); navigate(); };
  });
  page.addEventListener('click', async (e) => { const a = e.target.closest('[data-ann-del]'); if (!a) return; e.preventDefault(); await run(api('admin.announcement_delete', { id: +a.dataset.annDel }), 'Removed.'); navigate(); });
});

/* ================= Collections ================= */
const COLLECTIONS = {
  favorites: ['Favourites', 'Documents you follow. You get a notification when a new version is published.', 'star'],
  mine: ['My documents', 'Everything you have uploaded, including any unpublished drafts.', 'file'],
  new: ['New this week', 'Documents published or updated with a new version in the last 7 days.', 'clock'],
  recent: ['Recent', 'Documents you viewed, downloaded or uploaded lately.', 'clock'],
  checked_out: ['Checked out to me', 'Documents you locked for editing. Upload a new version to check them in.', 'lock'],
  review: ['Due for review', 'Documents whose review date is past or within the next 30 days.', 'history'],
};
route('/my/(\\w+)', async (page, [kind]) => {
  const c = COLLECTIONS[kind]; if (!c) throw new Error('Unknown list.');
  const r = await api('dash.collection', undefined, { query: { kind } });
  setTitle(c[0]);
  const sel = new Set();
  page.innerHTML = `<div class="page-head"><div class="grow"><h1>${c[0]}</h1><p>${c[1]}</p></div></div>
    <div class="seg" style="margin-bottom:14px">${Object.entries(COLLECTIONS).map(([k, v]) => `<button class="${k === kind ? 'on' : ''}" data-k="${k}">${icon(v[2], 'sm')}${v[0]}</button>`).join('')}</div>
    <div id="cl">${r.docs.length ? docTable(r.docs, { showLib: true, selectable: false, sort: '' }) : emptyState(c[2], 'Nothing here yet', kind === 'favorites' ? 'Open a document and choose “Add to favourites” to follow it.' : 'This list fills up as you work.')}</div>`;
  page.addEventListener('click', (e) => {
    const k = e.target.closest('[data-k]'); if (k) return go('#/my/' + k.dataset.k);
    const tr = e.target.closest('tr[data-id]'); if (tr) go('#/doc/' + tr.dataset.id);
  });
});

/* ================= Search ================= */
route('/search', async (page, _, params) => {
  await loadTax();
  setTitle('Search');
  const st = { q: params.q || '', terms: params.terms ? params.terms.split(',').map(Number) : [], ct: [], status: [], ext: [], libs: [], since: '', sort: 'relevance', view: 20 };
  page.innerHTML = `
    <div class="search-hero"><h1 style="margin-bottom:14px">Search</h1>
      <form class="search-box" id="sf">${icon('search')}<input id="sq" value="${esc(st.q)}" placeholder="Search inside documents, numbers, tags and people" autocomplete="off"><button class="btn primary">Search</button></form>
      <div class="search-tips">Try <code data-ins='type:pdf '>type:pdf</code><code data-ins='lib:ENG '>lib:ENG</code><code data-ins='ct:DWG '>ct:DWG</code><code data-ins='tag:"Fire Water System" '>tag:"…"</code><code data-ins='owner:grace '>owner:name</code><code data-ins='status:pending '>status:pending</code><code data-ins='after:2026-01-01 '>after:date</code><code data-ins='"exact phrase" '>"exact phrase"</code></div></div>
    <div class="search-layout"><aside class="lib-nav" id="sFacets"></aside><section id="sRes"><div class="loading"><div class="boot-mark"></div></div></section></div>`;
  const idx = termIndex();
  const runSearch = async () => {
    const q = { q: st.q, terms: st.terms, ct: st.ct, status: st.status, ext: st.ext, libs: st.libs, since: st.since, sort: st.sort };
    history.replaceState(null, '', '#/search?' + new URLSearchParams({ ...(st.q ? { q: st.q } : {}), ...(st.terms.length ? { terms: st.terms.join(',') } : {}) }).toString());
    $('#sRes').innerHTML = '<div class="loading"><div class="boot-mark"></div></div>';
    const r = await api('search.query', undefined, { query: q });
    const words = [...r.parsed.words, ...r.parsed.phrases];
    const f = r.facets;
    const facet = (title, key, items, show = 6) => items.length ? `<div style="margin-bottom:14px"><h4>${title}</h4><div class="facet">${items.map((it, i) => `<label class="${i >= show ? 'hidden more-' + key : ''}"><input type="checkbox" data-f="${key}" value="${esc(it.v)}" ${st[key].map(String).includes(String(it.v)) ? 'checked' : ''}><span>${esc(it.l)}</span><span class="n">${it.n}</span></label>`).join('')}
      ${items.length > show ? `<button class="more" data-more="${key}">Show ${items.length - show} more</button>` : ''}</div></div>` : '';
    $('#sFacets').innerHTML = `<div style="margin-bottom:14px"><h4>Modified</h4><select class="input" id="since"><option value="">Any time</option>${[['7d', 'Past week'], ['30d', 'Past month'], ['90d', 'Past 3 months'], ['365d', 'Past year']].map(([v, l]) => `<option value="${v}" ${st.since === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`
      + facet('Library', 'libs', f.libraries.map((x) => ({ v: x.id, l: x.label, n: x.n })))
      + facet('Content type', 'ct', f.content_types.map((x) => ({ v: x.id, l: x.label, n: x.n })))
      + Object.entries(f.terms).map(([set, ts]) => facet(set, 'terms', ts.sort((a, b) => b.n - a.n).map((t) => ({ v: t.id, l: t.label, n: t.n })), 5)).join('')
      + facet('Status', 'status', Object.entries(f.status).map(([k, n]) => ({ v: k, l: STATUS[k], n })))
      + facet('File type', 'ext', Object.entries(f.ext).map(([k, n]) => ({ v: k, l: k.toUpperCase(), n })));
    const chips = [...st.terms.map((t) => ['terms', t, idx[t]?.label || 'Tag'])];
    $('#sRes').innerHTML = `
      <div class="toolbar"><b>${r.total} result${r.total === 1 ? '' : 's'}</b>${st.q ? `<span class="muted">for “${esc(st.q)}”</span>` : ''}
        <div style="margin-left:auto" class="btn-row"><select class="input" id="sSort" style="width:auto;height:34px"><option value="relevance">Most relevant</option><option value="modified" ${st.sort === 'modified' ? 'selected' : ''}>Newest</option><option value="title" ${st.sort === 'title' ? 'selected' : ''}>Title A–Z</option><option value="views" ${st.sort === 'views' ? 'selected' : ''}>Most viewed</option></select>
        <button class="btn sm" id="sSave">${icon('bookmark', 'sm')}Save search</button>${r.total ? `<a class="btn sm" href="download.php?zip=1&ids=${r.docs.slice(0, 300).map((d) => d.id).join(',')}">${icon('download', 'sm')}Download all</a>` : ''}</div></div>
      ${chips.length ? `<div class="active-filters">${chips.map(([k, v, l]) => `<span class="chip">${icon('tag', 'sm')}${esc(l)}<span class="x" data-rm="${k}" data-v="${v}">${icon('x', 'sm')}</span></span>`).join('')}</div>` : ''}
      ${r.related_terms.length ? `<div class="active-filters"><span class="faint small" style="align-self:center">Narrow by tag:</span>${r.related_terms.filter((t) => !st.terms.includes(t.id)).map((t) => `<button class="chip add" data-addt="${t.id}">${icon('tag', 'sm')}${esc(t.label)} <span class="faint">${esc(t.termset)}</span></button>`).join('')}</div>` : ''}
      ${r.people.length ? `<div class="people-strip">${r.people.map((p) => `<a class="person-chip" href="#/person/${p.id}">${avatar(p.name)}<div><b>${esc(p.name)}</b><small>${esc(p.job_title || '')}${p.department ? ' · ' + esc(p.department) : ''}</small></div></a>`).join('')}</div>` : ''}
      <div id="sList">${r.docs.slice(0, st.view).map((d) => `<div class="result">${fileIcon(d.ext)}<div style="min-width:0">
        <a class="rt" href="#/doc/${d.id}${words.length ? '?hl=' + encodeURIComponent(words.join(' ')) : ''}">${highlight(d.title, words)}</a>
        <div class="rm"><span class="mono">${esc(d.doc_number || '')}</span><span class="pill"><span class="sw" style="background:${esc(d.library_color)}"></span>${esc(d.library)}</span>${d.content_type ? `<span>${esc(d.content_type)}</span>` : ''}<span>v${esc(d.version)}</span>${isSensitive(d.confidentiality) ? conf(d.confidentiality) : ''}${d.status !== 'published' ? statusTag(d.status) : ''}<span>${esc(d.owner)} · ${ago(d.modified)}</span></div>
        ${d.snippet ? `<p class="snippet">${highlight(d.snippet, words)}</p>` : d.description ? `<p class="snippet">${esc(d.description.slice(0, 220))}</p>` : ''}
        ${d.terms.length ? `<div class="chips" style="margin-top:8px">${d.terms.slice(0, 6).map((t) => `<button class="chip ghost" data-addt="${t.id}">${esc(t.label)}</button>`).join('')}</div>` : ''}</div></div>`).join('')
      || emptyState('search', st.q || st.terms.length ? 'No documents match' : 'Search the whole hub', st.q ? 'Check the spelling, remove a filter, or search for a tag instead. Content of scanned PDFs can’t be searched.' : 'Type words from the title, the document number, or text inside the file.')}</div>
      ${r.docs.length > st.view ? `<div style="text-align:center;margin-top:16px"><button class="btn" id="sMore">Show more results</button></div>` : ''}`;
    $('#sMore')?.addEventListener('click', () => { st.view += 30; runSearch(); });
    $('#sSort').onchange = (e) => { st.sort = e.target.value; runSearch(); };
    $('#since').onchange = (e) => { st.since = e.target.value; runSearch(); };
    $('#sSave').onclick = async () => { const name = await promptBox({ title: 'Save this search', label: 'Name', value: st.q || 'My search', ok: 'Save' }); if (name) await run(api('search.save', { name, query: { q: st.q, terms: st.terms } }), 'Saved. Find it on the search page.'); };
  };
  page.addEventListener('submit', (e) => { e.preventDefault(); st.q = $('#sq').value.trim(); st.view = 20; runSearch(); });
  page.addEventListener('change', (e) => { const t = e.target; if (t.dataset.f) { const v = ['libs', 'ct', 'terms'].includes(t.dataset.f) ? +t.value : t.value; st[t.dataset.f] = t.checked ? [...st[t.dataset.f], v] : st[t.dataset.f].filter((x) => String(x) !== String(v)); runSearch(); } });
  page.addEventListener('click', (e) => {
    const ins = e.target.closest('[data-ins]'); if (ins) { const i = $('#sq'); i.value = (i.value.trim() + ' ' + ins.dataset.ins).trimStart(); i.focus(); return; }
    const at = e.target.closest('[data-addt]'); if (at) { const id = +at.dataset.addt; if (!st.terms.includes(id)) st.terms.push(id); return runSearch(); }
    const rm = e.target.closest('[data-rm]'); if (rm) { st[rm.dataset.rm] = st[rm.dataset.rm].filter((x) => String(x) !== rm.dataset.v); return runSearch(); }
    const mo = e.target.closest('[data-more]'); if (mo) { $$('.more-' + mo.dataset.more, page).forEach((x) => x.classList.remove('hidden')); mo.remove(); }
    const sv = e.target.closest('[data-saved]'); if (sv) { const q = JSON.parse(sv.dataset.saved); st.q = q.q || ''; st.terms = q.terms || []; $('#sq').value = st.q; runSearch(); }
    const sd = e.target.closest('[data-unsave]'); if (sd) { e.stopPropagation(); api('search.unsave', { id: +sd.dataset.unsave }).then(() => sd.closest('.chip').remove()); }
  });
  if (st.q || st.terms.length) await runSearch();
  else {
    const saved = await api('search.saved');
    $('#sFacets').innerHTML = '';
    $('#sRes').innerHTML = (saved.items.length ? `<h3 style="margin-bottom:10px">Saved searches</h3><div class="chips" style="margin-bottom:24px">${saved.items.map((s) => `<span class="chip"><button class="chip" style="padding:0;background:none;height:auto" data-saved='${esc(s.query)}'>${icon('bookmark', 'sm')}${esc(s.name)}</button><span class="x" data-unsave="${s.id}">${icon('x', 'sm')}</span></span>`).join('')}</div>` : '')
      + `<h3 style="margin-bottom:10px">Browse by tag</h3>` + (S.tax.termsets.map((s) => `<div style="margin-bottom:16px"><div class="label" style="margin-bottom:6px">${esc(s.name)}</div><div class="chips">${s.terms.filter((t) => !t.parent_id && t.docs).map((t) => `<button class="chip ghost" data-addt="${t.id}">${esc(t.label)} <span class="faint">${t.docs}</span></button>`).join('') || '<span class="faint small">No documents tagged yet.</span>'}</div></div>`).join(''));
    $('#sq').focus();
  }
});

/* ================= Approvals ================= */
route('/approvals', async (page, _, params) => {
  setTitle('Approvals');
  if (!S.settings.approvals) { page.innerHTML = emptyState('check', 'Approvals are switched off', 'Documents are published as soon as they’re uploaded. An administrator can switch approvals back on in Settings.'); return; }
  const tab = params.tab || 'queue';
  const r = await api('approvals.' + (tab === 'mine' ? 'mine' : tab === 'history' ? 'history' : 'queue'));
  const sel = new Set();
  const isQ = tab === 'queue';
  page.innerHTML = `<div class="page-head"><div class="grow"><h1>Approvals</h1><p>Documents become visible to readers only after a department head approves them. Each approval promotes the draft to the next major version.</p></div></div>
    <div class="tabs"><button data-t="queue" class="${isQ ? 'on' : ''}">${icon('inbox', 'sm')}Waiting for me</button><button data-t="mine" class="${tab === 'mine' ? 'on' : ''}">${icon('send', 'sm')}My requests</button><button data-t="history" class="${tab === 'history' ? 'on' : ''}">${icon('history', 'sm')}Decided</button></div>
    <div id="abulk"></div>
    ${r.items.length ? `<div class="table-wrap"><table class="docs"><thead><tr>${isQ ? '<th class="cb"><input type="checkbox" data-all></th>' : ''}<th>Document</th><th>Library</th><th>Version</th><th>Requested by</th><th>${isQ ? 'Waiting' : 'Decision'}</th>${isQ ? '<th></th>' : ''}</tr></thead><tbody>
      ${r.items.map((a) => `<tr data-id="${a.doc.id}">${isQ ? `<td class="cb"><input type="checkbox" data-s="${a.doc.id}"></td>` : ''}
        <td><div class="doc-title">${fileIcon(a.doc.ext)}<div><div class="tt">${esc(a.doc.title)}</div><div class="nn">${esc(a.doc.doc_number || '')}</div>${a.note ? `<div class="small muted">“${esc(a.note)}”</div>` : ''}</div></div></td>
        <td class="nowrap">${esc(a.doc.library)}</td><td class="ver">${esc(a.version)}</td>
        <td class="nowrap">${esc(a.requester || '')}<div class="faint small">${esc(fmtDate(a.requested_at, true))}</div></td>
        <td class="nowrap">${isQ ? `<span style="color:${a.waiting_hours > 48 ? 'var(--red)' : a.waiting_hours > 24 ? 'var(--amber)' : 'inherit'}">${a.waiting_hours < 1 ? 'Just now' : a.waiting_hours < 48 ? a.waiting_hours + ' h' : Math.round(a.waiting_hours / 24) + ' days'}</span>`
          : `${{ approved: '<span class="status published">Approved</span>', rejected: '<span class="status rejected">Changes requested</span>', pending: '<span class="status pending">Waiting</span>' }[a.decision] || a.decision}<div class="faint small">${esc(a.decider || '')} ${a.decided_at ? esc(fmtDate(a.decided_at)) : ''}</div>`}</td>
        ${isQ ? `<td class="nowrap"><button class="btn sm approve" data-ap="${a.doc.id}">${icon('check', 'sm')}Approve</button> <button class="btn sm" data-rj="${a.doc.id}">Return</button></td>` : ''}</tr>`).join('')}
    </tbody></table></div>` : emptyState(isQ ? 'stamp' : 'inbox', isQ ? 'No approvals waiting' : 'Nothing here yet', isQ ? 'When someone sends a document for approval in a library you can approve, it appears here and you get a notification.' : 'Requests you send and decisions you make show up here.')}`;
  const drawBulk = () => { $('#abulk').innerHTML = sel.size ? `<div class="bulk"><b>${sel.size} selected</b><button class="btn sm" data-bulk="approve">${icon('check', 'sm')}Approve all</button><button class="btn sm" data-bulk="reject">Return all</button></div>` : ''; };
  page.addEventListener('click', async (e) => {
    const t = e.target;
    const tb = t.closest('[data-t]'); if (tb) return go('#/approvals?tab=' + tb.dataset.t);
    if (t.matches('[data-all]')) { $$('[data-s]', page).forEach((c) => { c.checked = t.checked; t.checked ? sel.add(+c.dataset.s) : sel.delete(+c.dataset.s); }); return drawBulk(); }
    if (t.matches('[data-s]')) { t.checked ? sel.add(+t.dataset.s) : sel.delete(+t.dataset.s); return drawBulk(); }
    const ap = t.closest('[data-ap]'); if (ap) { await run(api('docs.approve', { id: +ap.dataset.ap }), (x) => x.message); refreshCounts(); return navigate(); }
    const rj = t.closest('[data-rj]'); if (rj) { const note = await promptBox({ title: 'Request changes', label: 'What should the author change?', textarea: true, ok: 'Send back' }); if (!note) return; await run(api('docs.reject', { id: +rj.dataset.rj, note }), (x) => x.message); refreshCounts(); return navigate(); }
    const bk = t.closest('[data-bulk]'); if (bk) {
      let note = '';
      if (bk.dataset.bulk === 'reject') { note = await promptBox({ title: 'Return documents', label: 'Note for the authors', textarea: true, ok: 'Send back' }); if (!note) return; }
      else if (!await confirmBox(`Approve and publish ${sel.size} document(s)?`, { ok: 'Approve all' })) return;
      await run(api('approvals.bulk', { ids: [...sel], decision: bk.dataset.bulk, note }), (x) => `${x.done} done${x.skipped ? `, ${x.skipped} skipped` : ''}.`); refreshCounts(); return navigate();
    }
    const tr = t.closest('tr[data-id]'); if (tr && !t.closest('button,input,a')) go('#/doc/' + tr.dataset.id);
  });
});

/* ================= People ================= */
route('/people', async (page) => {
  const d = await loadDir(true);
  setTitle('People');
  let dept = '', q = '';
  page.innerHTML = `<div class="page-head"><div class="grow"><h1>People</h1><p>${d.people.length} colleagues across ${d.departments.length} departments.</p></div></div>
    <div class="toolbar"><div class="filter-input">${icon('search', 'sm')}<input class="input" id="pq" placeholder="Find by name or role"></div>
    <select class="input" id="pd" style="width:auto"><option value="">All departments</option>${d.departments.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></div><div class="dir-grid" id="pg"></div>`;
  const draw = () => {
    const list = d.people.filter((p) => (!dept || p.department_id === +dept) && (!q || (p.name + ' ' + p.job_title).toLowerCase().includes(q)));
    $('#pg').innerHTML = list.map((p) => `<a class="dir-card" href="#/person/${p.id}">${avatar(p.name)}<div style="min-width:0"><b>${esc(p.name)}</b><small>${esc(p.job_title || roleName(p.role))}</small><small>${esc(p.department || '')}</small></div>${p.role === 'head' ? '<span class="role head" style="margin-left:auto">Head</span>' : ''}</a>`).join('') || '<p class="faint">No one matches.</p>';
  };
  $('#pq').oninput = (e) => { q = e.target.value.toLowerCase(); draw(); };
  $('#pd').onchange = (e) => { dept = e.target.value; draw(); };
  draw();
});

route('/person/(\\d+)', async (page, [id]) => {
  const r = await api('users.profile', undefined, { query: { id } });
  const p = r.person;
  setTitle(p.name);
  page.innerHTML = `<div class="crumbs"><a href="#/people">People</a></div>
    <div class="profile-head">${avatar(p.name, 'lg')}<div><h1>${esc(p.name)}</h1><p class="muted" style="margin:4px 0 0">${esc(p.job_title || '')}${p.department ? ' · ' + esc(p.department) : ''} · <span class="role ${p.role}">${roleName(p.role)}</span></p>
    <p class="small" style="margin:6px 0 0"><a href="mailto:${esc(p.email)}">${esc(p.email)}</a>${p.phone ? ' · ' + esc(p.phone) : ''}</p></div>
    ${S.user.is_admin ? `<a class="btn" style="margin-left:auto" href="#/admin/users?edit=${p.id}">${icon('edit', 'sm')}Manage</a>` : ''}</div>
    <div class="stat-row"><div class="stat"><b>${r.stats.uploads}</b><span>Documents authored</span></div><div class="stat"><b>${r.stats.approvals}</b><span>Approvals given</span></div><div class="stat"><b>${r.stats.comments}</b><span>Comments</span></div></div>
    <h2 style="margin-bottom:12px">Recent documents</h2>${r.docs.length ? `<div class="panel doc-rows">${docRows(r.docs)}</div>` : '<p class="faint">No documents you can see.</p>'}`;
});

route('/profile', async (page) => {
  const u = S.user;
  setTitle('Your profile');
  page.innerHTML = `<div class="page-head"><div class="grow"><h1>Your profile</h1><p>${esc(u.email)} · ${roleName(u.role)}${u.department ? ' · ' + esc(u.department) : ''}</p></div></div>
    <div class="two-col"><div class="panel"><div class="panel-h"><h3>Details</h3></div><div class="panel-b" style="display:grid;gap:14px">
      <div class="field"><label>Name</label><input class="input" id="pn" value="${esc(u.name)}"></div>
      <div class="field"><label>Job title</label><input class="input" id="pj" value="${esc(u.job_title || '')}"></div>
      <div class="field"><label>Phone</label><input class="input" id="pp" value="${esc(u.phone || '')}"></div>
      <div><button class="btn primary" id="psave">Save details</button></div></div></div>
    <div class="panel"><div class="panel-h"><h3>Password</h3></div><div class="panel-b" style="display:grid;gap:14px">
      <div class="field"><label>Current password</label><input class="input" type="password" id="c1" autocomplete="current-password"></div>
      <div class="field"><label>New password (8+ characters)</label><input class="input" type="password" id="c2" autocomplete="new-password"></div>
      <div><button class="btn" id="cpw">${icon('key', 'sm')}Change password</button></div></div></div>
    <div class="panel" id="mfaPanel"><div class="loading"><div class="boot-mark"></div></div></div></div>`;
  mfaProfilePanel($('#mfaPanel'));
  $('#psave').onclick = async () => { await run(api('auth.profile', { name: $('#pn').value, job_title: $('#pj').value, phone: $('#pp').value }), 'Saved.'); S.user.name = $('#pn').value; S.user.job_title = $('#pj').value; S.user.phone = $('#pp').value; };
  $('#cpw').onclick = async () => { await run(api('auth.change_password', { current: $('#c1').value, new: $('#c2').value }), 'Password changed.'); $('#c1').value = $('#c2').value = ''; };
});

/* ================= Recycle bin ================= */
route('/recycle', async (page) => {
  const r = await api('docs.recycle');
  setTitle('Recycle bin');
  page.innerHTML = `<div class="page-head"><div class="grow"><h1>Recycle bin</h1><p>${S.user.is_admin ? 'Everything deleted across the hub.' : 'Documents you deleted.'} Items are kept for ${r.retention_days} days with all their versions, then an administrator can remove them for good.</p></div>
    ${S.user.is_admin && r.items.length ? `<button class="btn danger" id="purgeOld">${icon('trash', 'sm')}Empty items older than ${r.retention_days} days</button>` : ''}</div>
    ${r.items.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Document</th><th>Library</th><th>Versions</th><th>Deleted</th><th></th></tr></thead><tbody>
      ${r.items.map((d) => `<tr><td><b>${esc(d.title)}</b><div class="faint small mono">${esc(d.doc_number || d.filename || '')}</div></td><td>${esc(d.library)}</td><td>${d.versions} · ${fmtSize(d.size)}</td>
        <td>${esc(d.deleted_by_name || '')}<div class="faint small">${esc(fmtDate(d.deleted_at, true))}</div></td>
        <td class="nowrap"><button class="btn sm" data-restore="${d.id}">${icon('undo', 'sm')}Restore</button>${S.user.is_admin ? ` <button class="btn sm danger" data-purge="${d.id}">Delete forever</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : emptyState('trash', 'The recycle bin is empty', 'Deleted documents stay here so they can be restored.')}`;
  page.addEventListener('click', async (e) => {
    const rs = e.target.closest('[data-restore]'); if (rs) { await run(api('docs.restore', { id: +rs.dataset.restore }), (x) => x.message); return navigate(); }
    const pg = e.target.closest('[data-purge]'); if (pg) { if (!await confirmBox('Delete this document and every version permanently? This cannot be undone.', { danger: true, ok: 'Delete forever' })) return; await run(api('docs.purge', { id: +pg.dataset.purge }), 'Deleted permanently.'); return navigate(); }
    if (e.target.closest('#purgeOld')) { if (!await confirmBox(`Permanently delete everything older than ${r.retention_days} days?`, { danger: true, ok: 'Empty' })) return; await run(api('docs.purge', { expired: '1' }), (x) => `${x.purged} removed.`); navigate(); }
  });
});
/* Administration: people, departments, groups, libraries & permissions, term store, analytics, audit, settings */
'use strict';

const ADMIN_TABS = [['users', 'People'], ['departments', 'Departments'], ['groups', 'Groups'], ['libraries', 'Libraries & permissions'], ['requests', 'Access requests'],
  ['taxonomy', 'Properties & term store'], ['ocr', 'Searchable text'], ['analytics', 'Analytics'], ['audit', 'Audit log'], ['settings', 'Settings']];
function adminNav(on) { return `<nav class="admin-nav">${ADMIN_TABS.map(([k, l]) => `<a href="#/admin/${k}" class="${k === on ? 'on' : ''}">${l}</a>`).join('')}</nav>`; }
function guardAdmin() { if (!S.user.is_admin) throw new Error('Only administrators can open this page.'); }

/* ================= People ================= */
route('/admin/users', async (page, _, params) => {
  guardAdmin();
  const [r, dir] = await Promise.all([api('users.list'), loadDir(true)]);
  setTitle('People & access');
  let q = '', fRole = '', fDept = '', showInactive = false;
  page.innerHTML = `${adminNav('users')}<div class="page-head"><div class="grow"><h1>People & access</h1><p>Each person signs in with their own email and password. Their role and department decide what they can see and approve.</p></div>
    <div class="btn-row"><button class="btn" id="uImp">${icon('upload', 'sm')}Import CSV</button><button class="btn primary" id="uNew">${icon('plus', 'sm')}Add person</button></div></div>
    <div class="toolbar"><div class="filter-input">${icon('search', 'sm')}<input class="input" id="uq" placeholder="Search name or email"></div>
      <select class="input" id="ur" style="width:auto"><option value="">All roles</option><option value="admin">Administrators</option><option value="head">Department heads</option><option value="member">Members</option><option value="viewer">Viewers</option></select>
      <select class="input" id="ud" style="width:auto"><option value="">All departments</option>${dir.departments.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select>
      <label class="check small"><input type="checkbox" id="ui"> Show deactivated</label></div>
    <div class="table-wrap"><table class="list"><thead><tr><th>Name</th><th>Department</th><th>Role</th><th>Two-step</th><th>Groups</th><th>Documents</th><th>Last sign-in</th></tr></thead><tbody id="ub"></tbody></table></div>`;
  const draw = () => {
    $('#ub').innerHTML = r.users.filter((u) => (showInactive || u.active) && (!fRole || u.role === fRole) && (!fDept || +u.department_id === +fDept) && (!q || (u.name + u.email).toLowerCase().includes(q)))
      .map((u) => `<tr class="click" data-u="${u.id}" style="${u.active ? '' : 'opacity:.55'}"><td><div style="display:flex;gap:10px;align-items:center">${avatar(u.name)}<div><b>${esc(u.name)}</b>${u.locked_until && new Date(u.locked_until.replace(' ', 'T')) > new Date() ? ` <span class="pill" style="color:var(--red)">${icon('lock', 'sm')}Locked</span>` : ''}${u.active ? '' : ' <span class="pill">Deactivated</span>'}<div class="faint small">${esc(u.email)}</div></div></div></td>
        <td>${esc(u.department || '—')}<div class="faint small">${esc(u.job_title || '')}</div></td><td><span class="role ${u.role}">${roleName(u.role)}</span></td>
        <td class="small nowrap">${u.mfa_enabled ? `<span style="color:var(--green)">${icon('shield', 'sm')} On</span>` : u.mfa_required ? '<span style="color:var(--amber)">Set up at next sign-in</span>' : '<span class="faint">Off</span>'}</td>
        <td class="small">${u.groups.map((g) => esc(g.name)).join(', ') || '<span class="faint">—</span>'}</td><td>${u.docs}</td><td class="small muted">${u.last_login ? ago(u.last_login) : 'Never'}</td></tr>`).join('');
  };
  draw();
  $('#uq').oninput = (e) => { q = e.target.value.toLowerCase(); draw(); };
  $('#ur').onchange = (e) => { fRole = e.target.value; draw(); };
  $('#ud').onchange = (e) => { fDept = e.target.value; draw(); };
  $('#ui').onchange = (e) => { showInactive = e.target.checked; draw(); };
  $('#uNew').onclick = () => editUser(null, dir);
  $('#uImp').onclick = () => importUsers();
  $('#ub').onclick = (e) => { const tr = e.target.closest('[data-u]'); if (tr) editUser(r.users.find((u) => u.id === +tr.dataset.u), dir); };
  if (params.edit) { const u = r.users.find((x) => x.id === +params.edit); if (u) editUser(u, dir); }
});

function showTempPassword(name, email, pw) {
  modal({ title: 'Share these sign-in details', body: `<p style="margin:0">Give ${esc(name)} these details privately. They’ll be asked to choose their own password at first sign-in.</p>
    <div class="titleblock" style="grid-template-columns:1fr 1fr"><div class="last"><small>Email</small><div class="v">${esc(email)}</div></div><div class="last"><small>Temporary password</small><div class="v mono">${esc(pw)}</div></div></div>
    <p class="faint small" style="margin:0">Sign-in address: ${esc(location.origin + location.pathname)}</p>`, foot: '<button class="btn primary" data-close>Done</button>' });
}

async function editUser(u, dir) {
  const groups = dir.groups;
  const m = modal({ title: u ? u.name : 'Add a person', size: 'wide', body: `
    <div class="grid2">
      <div class="field"><label>Full name</label><input class="input" id="eN" value="${esc(u?.name || '')}"></div>
      <div class="field"><label>Work email (sign-in)</label><input class="input" type="email" id="eE" value="${esc(u?.email || '')}"></div>
      <div class="field"><label>Department</label><select class="input" id="eD"><option value="">None</option>${dir.departments.map((d) => `<option value="${d.id}" ${+u?.department_id === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Role</label><select class="input" id="eR">${['member', 'head', 'viewer', 'admin'].map((r) => `<option value="${r}" ${(u?.role || 'member') === r ? 'selected' : ''}>${roleName(r)}</option>`).join('')}</select>
        <span class="hint">Heads approve documents. Viewers can only read. Admins manage everything.</span></div>
      <div class="field"><label>Job title</label><input class="input" id="eJ" value="${esc(u?.job_title || '')}"></div>
      <div class="field"><label>Phone</label><input class="input" id="eP" value="${esc(u?.phone || '')}"></div>
      <div class="field" style="grid-column:1/-1"><label>Groups</label><div class="chips">${groups.map((g) => `<label class="chip ghost" style="cursor:pointer"><input type="checkbox" value="${g.id}" data-g ${u?.groups?.some((x) => x.id === g.id) ? 'checked' : ''} style="accent-color:var(--teal)"> ${esc(g.name)}</label>`).join('') || '<span class="faint small">No groups yet — create them under Groups.</span>'}</div></div>
      ${u ? `<div class="field"><label>Password</label><div id="ePwWrap"><button type="button" class="btn" id="ePwShow">${icon('key', 'sm')}Set a new password…</button></div><span class="hint">Leave this alone to keep the current password. To give someone a temporary password, use “Reset password” below.</span></div>`
        : `<div class="field"><label for="ePw">Password</label><input class="input" type="password" id="ePw" name="km-new-${Date.now()}" placeholder="Leave blank to generate one" autocomplete="new-password" data-lpignore="true" data-1p-ignore data-bwignore></div>`}
      ${u ? `<label class="check" style="align-self:end"><input type="checkbox" id="eA" ${u.active ? 'checked' : ''}><span><b>Active</b><br><span class="small muted">Deactivated people can’t sign in. Their documents stay.</span></span></label>` : ''}
    </div>
    ${u ? `<div id="eAccess" class="panel" style="padding:14px"><div class="label">Where ${esc(u.name.split(' ')[0])} has access</div><div class="loading"><div class="boot-mark"></div></div></div>` : ''}`,
    foot: `${u ? `<button class="btn left" data-reset>${icon('key', 'sm')}Reset password</button>` : ''}${u?.mfa_enabled ? `<button class="btn" data-mfareset title="For a lost or replaced phone">${icon('shield', 'sm')}Reset two-step</button>` : ''}<button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>${u ? 'Save changes' : 'Add person'}</button>` });
  if (u) api('users.access_report', undefined, { query: { id: u.id } }).then((r) => {
    m.$('#eAccess').innerHTML = `<div class="label" style="margin-bottom:8px">Where ${esc(u.name.split(' ')[0])} has access</div><div class="hbars">${r.libraries.map((l) => `<div class="hbar"><span class="lbl">${esc(l.name)}</span>
      <span class="trk"><i style="width:${l.level * 25}%;background:${esc(l.color)}"></i></span><span class="v small">${esc(l.level_name)}</span></div>${l.unique_folders.map((f) => `<div class="hbar"><span class="lbl faint">↳ ${esc(f.name)}</span><span class="trk"><i style="width:${f.level * 25}%;background:${esc(l.color)};opacity:.6"></i></span><span class="v small">${LEVELS[f.level]}</span></div>`).join('')}`).join('')}</div>`;
  }).catch(() => {});
  m.$('[data-ok]').onclick = async () => {
    const r = await run(api('users.save', { id: u?.id || 0, name: m.$('#eN').value, email: m.$('#eE').value, department_id: +m.$('#eD').value || 0, role: m.$('#eR').value,
      job_title: m.$('#eJ').value, phone: m.$('#eP').value, password: m.$('#ePw')?.value || '', active: u ? (m.$('#eA').checked ? 1 : 0) : 1, groups: m.$$('[data-g]:checked').map((c) => +c.value), unlock: 1 }), u ? 'Saved.' : 'Person added.');
    m.close(); S.dir = null;
    if (r.temp_password) showTempPassword(m.$('#eN').value, m.$('#eE').value, r.temp_password);
    navigate();
  };
  m.$('#ePwShow')?.addEventListener('click', () => {
    m.$('#ePwWrap').innerHTML = `<input class="input" type="password" id="ePw" name="km-new-${Date.now()}" placeholder="New password (8+ characters)" autocomplete="new-password" data-lpignore="true" data-1p-ignore data-bwignore>`;
    m.$('#ePw').focus();
  });
  m.$('[data-mfareset]')?.addEventListener('click', async () => {
    if (!await confirmBox(`Reset two-step verification for ${u.name}? Use this when they lost or replaced their phone. Their current authenticator codes, recovery codes and trusted devices stop working.`, { ok: 'Reset two-step', danger: true })) return;
    await run(api('users.mfa_reset', { id: u.id }), (x) => x.message);
    m.close(); navigate();
  });
  m.$('[data-reset]')?.addEventListener('click', async () => {
    if (!await confirmBox(`Generate a new temporary password for ${u.name}? Their current password stops working.`, { ok: 'Reset password' })) return;
    const r = await run(api('users.reset_password', { id: u.id }));
    m.close(); showTempPassword(u.name, u.email, r.temp_password);
  });
}

function importUsers() {
  const m = modal({ title: 'Import people from CSV', size: 'wide', body: `<p style="margin:0" class="muted">One person per line: <span class="mono">name, email, department code or name, role, job title</span>. Roles: admin, head, member, viewer.</p>
    <textarea class="input mono" id="csv" rows="10" placeholder="name,email,department,role,job title&#10;Jane Doe,jane.doe@tgisl.co.ke,ENG,member,Process Engineer"></textarea>
    <input type="file" accept=".csv,text/csv" id="csvf">`, foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>Import</button>` });
  m.$('#csvf').onchange = async (e) => { const f = e.target.files[0]; if (f) m.$('#csv').value = await f.text(); };
  m.$('[data-ok]').onclick = async () => {
    const r = await run(api('users.import', { csv: m.$('#csv').value }));
    m.close(); S.dir = null;
    const rows = r.created.map((c) => `${c.name},${c.email},${c.temp_password}`).join('\n');
    const mm = modal({ title: `${r.created.length} people added`, size: 'wide', body: `${r.created.length ? `<p style="margin:0">Temporary passwords (shown once — copy them now):</p><textarea class="input mono" rows="8" readonly>name,email,temporary password\n${esc(rows)}</textarea>` : ''}
      ${r.skipped.length ? `<div class="alert amber">${icon('alert')}<div>${r.skipped.map(esc).join('<br>')}</div></div>` : ''}`, foot: '<button class="btn primary" data-close>Done</button>', onClose: navigate });
  };
}

/* ================= Departments ================= */
route('/admin/departments', async (page) => {
  guardAdmin();
  const r = await api('users.departments');
  setTitle('Departments');
  page.innerHTML = `${adminNav('departments')}<div class="page-head"><div class="grow"><h1>Departments</h1><p>People belong to one department. Give a whole department access to a library in one step, and mark people as heads to let them approve.</p></div><button class="btn primary" id="dNew">${icon('plus', 'sm')}Add department</button></div>
    <div class="table-wrap"><table class="list"><thead><tr><th>Department</th><th>Code</th><th>Heads (approvers)</th><th>People</th></tr></thead><tbody>
    ${r.departments.map((d) => `<tr class="click" data-d="${d.id}"><td><span class="pill"><span class="sw" style="background:${esc(d.color)}"></span>${esc(d.name)}</span><div class="faint small">${esc(d.description || '')}</div></td><td class="mono">${esc(d.code)}</td><td>${esc(d.heads || '') || '<span style="color:var(--amber)">No head assigned</span>'}</td><td>${d.people}</td></tr>`).join('')}</tbody></table></div>`;
  const edit = (d) => {
    const m = modal({ title: d ? d.name : 'Add department', body: `<div class="grid2"><div class="field"><label>Name</label><input class="input" id="dn" value="${esc(d?.name || '')}"></div>
      <div class="field"><label>Code</label><input class="input mono" id="dc" value="${esc(d?.code || '')}"></div></div>
      <div class="field"><label>Description</label><input class="input" id="dd" value="${esc(d?.description || '')}"></div><div class="field"><label>Colour</label><input type="color" class="input" id="dco" value="${esc(d?.color || '#1479B8')}" style="padding:4px;width:90px"></div>`,
      foot: `${d ? `<button class="btn danger left" data-del>Delete</button>` : ''}<button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>Save</button>` });
    m.$('[data-ok]').onclick = async () => { await run(api('users.department_save', { id: d?.id || 0, name: m.$('#dn').value, code: m.$('#dc').value, description: m.$('#dd').value, color: m.$('#dco').value }), 'Saved.'); S.dir = null; m.close(); navigate(); };
    m.$('[data-del]')?.addEventListener('click', async () => { if (!await confirmBox('Delete this department? Its library permissions are removed too.', { danger: true, ok: 'Delete' })) return; await run(api('users.department_delete', { id: d.id }), 'Deleted.'); S.dir = null; m.close(); navigate(); });
  };
  $('#dNew').onclick = () => edit(null);
  page.addEventListener('click', (e) => { const tr = e.target.closest('[data-d]'); if (tr) edit(r.departments.find((x) => x.id === +tr.dataset.d)); });
});

/* ================= Groups ================= */
route('/admin/groups', async (page) => {
  guardAdmin();
  const [r, dir] = await Promise.all([api('users.groups'), loadDir(true)]);
  setTitle('Groups');
  page.innerHTML = `${adminNav('groups')}<div class="page-head"><div class="grow"><h1>Groups</h1><p>Cross-department teams — for example a HAZOP review team or a tender committee. Grant a group access to a library or a single confidential folder.</p></div><button class="btn primary" id="gNew">${icon('plus', 'sm')}New group</button></div>
    ${r.groups.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Group</th><th>Members</th></tr></thead><tbody>${r.groups.map((g) => `<tr class="click" data-g="${g.id}"><td><b>${esc(g.name)}</b><div class="faint small">${esc(g.description || '')}</div></td><td class="small">${g.members.map((x) => esc(x.name)).join(', ') || '<span class="faint">No members</span>'}</td></tr>`).join('')}</tbody></table></div>` : emptyState('users', 'No groups yet', 'Create a group to give a cross-department team access in one step.')}`;
  const edit = (g) => {
    const mem = new Set((g?.members || []).map((x) => x.id));
    const m = modal({ title: g ? g.name : 'New group', size: 'wide', body: `<div class="grid2"><div class="field"><label>Name</label><input class="input" id="gn" value="${esc(g?.name || '')}"></div><div class="field"><label>Description</label><input class="input" id="gd" value="${esc(g?.description || '')}"></div></div>
      <div class="field"><label>Members</label><input class="input" id="gq" placeholder="Filter people"><div id="gl" style="max-height:300px;overflow:auto;border:1px solid var(--line);border-radius:9px;padding:6px"></div></div>`,
      foot: `${g ? `<button class="btn danger left" data-del>Delete</button>` : ''}<button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>Save group</button>` });
    const draw = (q = '') => { m.$('#gl').innerHTML = dir.people.filter((p) => !q || p.name.toLowerCase().includes(q)).map((p) => `<label class="check" style="padding:5px 6px"><input type="checkbox" value="${p.id}" ${mem.has(p.id) ? 'checked' : ''}><span>${esc(p.name)} <span class="faint small">${esc(p.department || '')}</span></span></label>`).join(''); };
    draw();
    m.$('#gq').oninput = (e) => draw(e.target.value.toLowerCase());
    m.$('#gl').onchange = (e) => { e.target.checked ? mem.add(+e.target.value) : mem.delete(+e.target.value); };
    m.$('[data-ok]').onclick = async () => { await run(api('users.group_save', { id: g?.id || 0, name: m.$('#gn').value, description: m.$('#gd').value, members: [...mem] }), 'Group saved.'); S.dir = null; m.close(); navigate(); };
    m.$('[data-del]')?.addEventListener('click', async () => { if (!await confirmBox('Delete this group? Any access granted to it is removed.', { danger: true, ok: 'Delete' })) return; await run(api('users.group_delete', { id: g.id }), 'Deleted.'); S.dir = null; m.close(); navigate(); });
  };
  $('#gNew').onclick = () => edit(null);
  page.addEventListener('click', (e) => { const tr = e.target.closest('[data-g]'); if (tr) edit(r.groups.find((x) => x.id === +tr.dataset.g)); });
});

/* ================= Libraries ================= */
route('/admin/libraries', async (page) => {
  guardAdmin();
  const [r, dir] = await Promise.all([api('libraries.list', undefined, { query: { all: 1 } }), loadDir()]);
  setTitle('Libraries & permissions');
  page.innerHTML = `${adminNav('libraries')}<div class="page-head"><div class="grow"><h1>Libraries & permissions</h1><p>Libraries are the top-level repositories. Permissions set on a library flow down to its folders and documents unless a folder or document is given its own.</p></div><button class="btn primary" id="lNew">${icon('plus', 'sm')}New library</button></div>
    <div class="table-wrap"><table class="list"><thead><tr><th>Library</th><th>Owner</th><th>Approval</th><th>Documents</th><th>Storage</th><th></th></tr></thead><tbody>
    ${r.libraries.map((l) => `<tr><td><span class="pill"><span class="sw" style="background:${esc(l.color)}"></span>${esc(l.name)}</span> <span class="mono faint small">${esc(l.code)}</span><div class="faint small">${esc(l.description || '')}</div></td>
      <td>${esc(l.department || '—')}</td><td class="small">${!S.settings.approvals ? '<span class="faint">Direct publish</span>' : +l.approval_required ? (l.approval_mode === 'owner_head' ? 'Owner dept. head' : 'Any dept. head') : '<span class="faint">Not required</span>'}</td><td>${l.count}</td><td>${fmtSize(l.size)}</td>
      <td class="nowrap"><button class="btn sm" data-perm="${l.id}">${icon('shield', 'sm')}Permissions</button> <button class="btn sm ghost" data-edit="${l.id}">${icon('settings', 'sm')}</button> <a class="btn sm ghost" href="#/lib/${l.id}">${icon('open', 'sm')}</a></td></tr>`).join('')}</tbody></table></div>
    <div class="panel" style="margin-top:22px"><div class="panel-h"><h3>Check someone’s access</h3></div><div class="panel-b"><div style="display:grid;grid-template-columns:1fr 1fr auto;gap:10px">
      <select class="input" id="ckU">${dir.people.map((p) => `<option value="${p.id}">${esc(p.name)} — ${esc(p.department || roleName(p.role))}</option>`).join('')}</select>
      <select class="input" id="ckL">${r.libraries.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select><button class="btn" id="ckGo">Check</button></div><div id="ckRes" style="margin-top:14px"></div></div></div>`;
  $('#lNew').onclick = () => editLibrary();
  $('#ckGo').onclick = async () => {
    const x = await api('libraries.check', undefined, { query: { user_id: $('#ckU').value, scope: 'library', id: $('#ckL').value } });
    $('#ckRes').innerHTML = `<div class="alert ${x.level ? 'teal' : 'red'}">${icon(x.level ? 'check' : 'lock')}<div class="grow"><b>${esc(x.name)}: ${esc(x.level_name)}</b>
      ${x.role === 'admin' ? 'Administrators always have Full control.' : x.explain.grants.length ? 'Granted through: ' + x.explain.grants.map((g) => `${esc(g.label)} (${LEVELS[g.level]})`).join(', ') : 'No permission entry on this library matches this person.'}
      ${x.role === 'head' && x.level ? '<br>As a department head they can also approve documents here (subject to the library’s approval rule).' : ''}</div></div>`;
  };
  page.addEventListener('click', (e) => {
    const p = e.target.closest('[data-perm]'); if (p) { const l = r.libraries.find((x) => x.id === +p.dataset.perm); return openPermissions('library', l.id, l.name, navigate); }
    const ed = e.target.closest('[data-edit]'); if (ed) editLibrary(r.libraries.find((x) => x.id === +ed.dataset.edit));
  });
});

route('/admin/requests', async (page) => {
  guardAdmin();
  const r = await api('libraries.requests');
  setTitle('Access requests');
  page.innerHTML = `${adminNav('requests')}<div class="page-head"><div class="grow"><h1>Access requests</h1><p>People ask for access from a library they can’t open. Granting adds them to that library’s permissions.</p></div></div>
    ${r.requests.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Person</th><th>Library</th><th>Reason</th><th>Asked</th><th></th></tr></thead><tbody>${r.requests.map((q) => `<tr><td><b>${esc(q.user_name)}</b><div class="faint small">${esc(q.department || '')}</div></td><td>${esc(q.library)}</td><td class="small">${esc(q.reason || '—')}</td><td class="small">${ago(q.created_at)}</td>
      <td class="nowrap">${q.status === 'open' ? `<select class="input" data-lv="${q.id}" style="width:auto;height:31px;display:inline-block"><option value="1">Read</option><option value="2">Contribute</option></select> <button class="btn sm approve" data-grant="${q.id}">Grant</button> <button class="btn sm" data-decline="${q.id}">Decline</button>` : `<span class="faint small">${q.status === 'granted' ? 'Granted' : 'Declined'} by ${esc(q.decided_name || '')}</span>`}</td></tr>`).join('')}</tbody></table></div>` : emptyState('key', 'No access requests', 'Requests appear here when someone asks to join a library.')}`;
  page.addEventListener('click', async (e) => {
    const g = e.target.closest('[data-grant]'); if (g) { await run(api('libraries.request_decide', { id: +g.dataset.grant, decision: 'grant', level: +$(`[data-lv="${g.dataset.grant}"]`).value }), 'Access granted.'); return navigate(); }
    const d = e.target.closest('[data-decline]'); if (d) { await run(api('libraries.request_decide', { id: +d.dataset.decline, decision: 'decline' }), 'Declined.'); navigate(); }
  });
});

/* ================= Term store ================= */
route('/admin/taxonomy', async (page, _, params) => {
  guardAdmin();
  const tax = await loadTax(true);
  setTitle('Properties & term store');
  const tab = params.tab || 'terms';
  let setId = +params.set || tax.termsets[0]?.id;
  page.innerHTML = `${adminNav('taxonomy')}<div class="page-head"><div class="grow"><h1>Properties & term store</h1><p>Define the metadata every document carries. Term sets give a controlled vocabulary (with synonyms) used for tagging, the browse-by-tag navigation and search.</p></div></div>
    <div class="tabs"><button data-t="terms" class="${tab === 'terms' ? 'on' : ''}">${icon('tree', 'sm')}Term store</button><button data-t="fields" class="${tab === 'fields' ? 'on' : ''}">${icon('tag', 'sm')}Properties</button><button data-t="types" class="${tab === 'types' ? 'on' : ''}">${icon('file', 'sm')}Content types</button></div><div id="tx"></div>`;
  const tx = $('#tx');
  const drawTerms = () => {
    const set = tax.termsets.find((s) => s.id === setId);
    const branch = (pid) => set.terms.filter((t) => (t.parent_id || null) === pid).map((t) => `<li><div><span class="${t.deprecated ? 'dep' : ''}">${esc(t.label)}</span>${t.synonyms ? `<span class="syn">· ${esc(t.synonyms)}</span>` : ''}<span class="faint small">${t.docs ? plural(t.docs, 'document') : ''}</span>
      <span class="acts"><button class="mini-btn" data-addchild="${t.id}" title="Add child term">${icon('plus', 'sm')}</button><button class="mini-btn" data-editterm="${t.id}" title="Edit">${icon('edit', 'sm')}</button><button class="mini-btn" data-merge="${t.id}" title="Merge into another term">${icon('compare', 'sm')}</button><button class="mini-btn" data-delterm="${t.id}" title="Delete">${icon('trash', 'sm')}</button></span></div>
      ${set.terms.some((c) => c.parent_id === t.id) ? `<ul>${branch(t.id)}</ul>` : ''}</li>`).join('');
    tx.innerHTML = `<div class="tax-layout"><div class="panel"><div class="panel-h"><h3>Term sets</h3><button class="btn sm ghost" data-newset>${icon('plus', 'sm')}</button></div>
      <ul class="tree" style="padding:8px">${tax.termsets.map((s) => `<li><button class="node ${s.id === setId ? 'on' : ''}" data-set="${s.id}">${icon('tree', 'sm')}<span>${esc(s.name)}</span><span class="n">${s.terms.length}</span></button></li>`).join('')}</ul></div>
      <div class="panel">${set ? `<div class="panel-h"><div style="flex:1"><h3>${esc(set.name)}</h3><span class="faint small">${esc(set.description || set.group_name)}${set.navigable ? ' · shown in library navigation' : ''}</span></div>
        <button class="btn sm" data-editset="${set.id}">${icon('settings', 'sm')}Set options</button><button class="btn sm primary" data-addchild="">${icon('plus', 'sm')}Add term</button></div>
        <div class="panel-b"><ul class="tree term-tree">${branch(null) || '<li class="faint">No terms yet.</li>'}</ul>
        <p class="faint small" style="margin:14px 0 0">Synonyms make search smarter: a search for “bullet” also finds documents tagged “Mounded Bullets”, and uploads mentioning a synonym get the term suggested.</p></div>` : emptyState('tree', 'No term sets', 'Create a term set such as Plant Area or Discipline.')}</div></div>`;
  };
  const drawFields = () => {
    tx.innerHTML = `<div class="panel"><div class="panel-h"><h3>Properties</h3><button class="btn sm primary" data-newfield>${icon('plus', 'sm')}New property</button></div>
      <table class="list"><thead><tr><th>Property</th><th>Type</th><th>Used by</th><th>Rules</th></tr></thead><tbody>${tax.fields.map((f) => `<tr class="click" data-field="${f.id}"><td><b>${esc(f.name)}</b><div class="faint small">${esc(f.description || '')}</div></td>
      <td>${{ text: 'Text', number: 'Number', date: 'Date', choice: 'Choice', term: 'Managed term', user: 'Person', bool: 'Yes / No' }[f.type]}${f.type === 'term' ? ` <span class="faint small">· ${esc(tax.termsets.find((s) => s.id === f.termset_id)?.name || '')}</span>` : ''}${f.type === 'choice' ? ` <span class="faint small">· ${esc((f.options || []).join(', '))}</span>` : ''}</td>
      <td class="small">${tax.content_types.filter((c) => c.fields.includes(f.id)).map((c) => esc(c.name)).join(', ') || '<span class="faint">—</span>'}</td><td class="small">${[f.required ? 'Required' : '', f.multi ? 'Multiple values' : ''].filter(Boolean).join(' · ')}</td></tr>`).join('')}</tbody></table></div>`;
  };
  const drawTypes = () => {
    tx.innerHTML = `<div class="panel"><div class="panel-h"><h3>Content types</h3><button class="btn sm primary" data-newtype>${icon('plus', 'sm')}New content type</button></div>
      <table class="list"><thead><tr><th>Content type</th><th>Code</th><th>Properties</th><th>Review cycle</th><th>Documents</th></tr></thead><tbody>${tax.content_types.map((c) => `<tr class="click" data-type="${c.id}"><td><span class="pill"><span class="sw" style="background:${esc(c.color)}"></span>${esc(c.name)}</span></td><td class="mono">${esc(c.code)}</td>
      <td class="small">${c.fields.map((id) => esc(tax.fields.find((f) => f.id === id)?.name || '')).join(', ') || '<span class="faint">—</span>'}</td><td class="small">${c.review_months ? 'Every ' + c.review_months + ' months' : '<span class="faint">—</span>'}</td><td>${c.docs}</td></tr>`).join('')}</tbody></table></div>`;
  };
  ({ terms: drawTerms, fields: drawFields, types: drawTypes })[tab]();

  const reload = async (extra = '') => { await loadTax(true); go(`#/admin/taxonomy?tab=${tab}${setId ? '&set=' + setId : ''}${extra}`); };
  const termModal = (t, parentId) => {
    const set = tax.termsets.find((s) => s.id === setId);
    const m = modal({ title: t ? 'Edit term' : 'Add term', body: `<div class="field"><label>Label</label><input class="input" id="tl" value="${esc(t?.label || '')}"></div>
      <div class="field"><label>Synonyms</label><input class="input" id="ts" value="${esc(t?.synonyms || '')}" placeholder="Comma separated — e.g. bullet, mounded storage"></div>
      ${t ? `<div class="field"><label>Parent</label><select class="input" id="tp"><option value="">Top level</option>${set.terms.filter((x) => x.id !== t.id).map((x) => `<option value="${x.id}" ${x.id === t.parent_id ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></div>
      <label class="check"><input type="checkbox" id="td" ${t.deprecated ? 'checked' : ''}><span><b>Deprecated</b><br><span class="small muted">Kept on existing documents but no longer offered for tagging.</span></span></label>` : ''}`,
      foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>Save term</button>` });
    m.$('[data-ok]').onclick = async () => {
      const payload = { id: t?.id || 0, termset_id: setId, label: m.$('#tl').value, synonyms: m.$('#ts').value };
      if (t) { payload.parent_id = +m.$('#tp').value || 0; payload.deprecated = m.$('#td').checked ? 1 : 0; } else payload.parent_id = parentId || 0;
      await run(api('taxonomy.term_save', payload), 'Term saved.'); m.close(); reload();
    };
  };
  const setModal = (s) => {
    const m = modal({ title: s ? 'Term set options' : 'New term set', body: `<div class="field"><label>Name</label><input class="input" id="sn" value="${esc(s?.name || '')}"></div>
      <div class="field"><label>Description</label><input class="input" id="sd" value="${esc(s?.description || '')}"></div>
      <label class="check"><input type="checkbox" id="snav" ${!s || s.navigable ? 'checked' : ''}><span><b>Use for navigation</b><br><span class="small muted">Show this term set as a browse tree in every library.</span></span></label>`,
      foot: `${s ? '<button class="btn danger left" data-del>Delete term set</button>' : ''}<button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>Save</button>` });
    m.$('[data-ok]').onclick = async () => { const r = await run(api('taxonomy.termset_save', { id: s?.id || 0, name: m.$('#sn').value, description: m.$('#sd').value, navigable: m.$('#snav').checked ? 1 : 0 }), 'Saved.'); setId = r.id; m.close(); reload(); };
    m.$('[data-del]')?.addEventListener('click', async () => { if (!await confirmBox('Delete this term set and remove its tags from all documents?', { danger: true, ok: 'Delete' })) return; await run(api('taxonomy.termset_delete', { id: s.id }), 'Deleted.'); setId = 0; m.close(); reload(); });
  };
  const fieldModal = (f) => {
    const m = modal({ title: f ? 'Edit property' : 'New property', body: `<div class="grid2"><div class="field"><label>Name</label><input class="input" id="fn" value="${esc(f?.name || '')}"></div>
      <div class="field"><label>Type</label><select class="input" id="ft">${[['text', 'Text'], ['number', 'Number'], ['date', 'Date'], ['choice', 'Choice from a list'], ['term', 'Managed term (term store)'], ['user', 'Person'], ['bool', 'Yes / No']].map(([v, l]) => `<option value="${v}" ${f?.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <div class="field" id="fTs"><label>Term set</label><select class="input" id="fts">${tax.termsets.map((s) => `<option value="${s.id}" ${f?.termset_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
      <div class="field" id="fOp"><label>Choices (one per line)</label><textarea class="input" id="fop">${esc((f?.options || []).join('\n'))}</textarea></div>
      <div class="field"><label>Help text</label><input class="input" id="fd" value="${esc(f?.description || '')}"></div>
      <label class="check"><input type="checkbox" id="fr" ${f?.required ? 'checked' : ''}> Required on upload</label><label class="check" id="fM"><input type="checkbox" id="fm" ${f?.multi ? 'checked' : ''}> Allow several terms</label>`,
      foot: `${f ? '<button class="btn danger left" data-del>Delete</button>' : ''}<button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>Save property</button>` });
    const sync = () => { const t = m.$('#ft').value; m.$('#fTs').classList.toggle('hidden', t !== 'term'); m.$('#fM').classList.toggle('hidden', t !== 'term'); m.$('#fOp').classList.toggle('hidden', t !== 'choice'); };
    m.$('#ft').onchange = sync; sync();
    m.$('[data-ok]').onclick = async () => { await run(api('taxonomy.field_save', { id: f?.id || 0, name: m.$('#fn').value, type: m.$('#ft').value, termset_id: +m.$('#fts').value, options: m.$('#fop').value, description: m.$('#fd').value, required: m.$('#fr').checked ? 1 : 0, multi: m.$('#fm').checked ? 1 : 0 }), 'Property saved.'); m.close(); reload(); };
    m.$('[data-del]')?.addEventListener('click', async () => { if (!await confirmBox('Delete this property and its values on every document?', { danger: true, ok: 'Delete' })) return; await run(api('taxonomy.field_delete', { id: f.id }), 'Deleted.'); m.close(); reload(); });
  };
  const typeModal = (c) => {
    const m = modal({ title: c ? c.name : 'New content type', size: 'wide', body: `<div class="grid3"><div class="field"><label>Name</label><input class="input" id="cn" value="${esc(c?.name || '')}"></div>
      <div class="field"><label>Code</label><input class="input mono" id="cc" value="${esc(c?.code || '')}" maxlength="8"><span class="hint">Goes into document numbers</span></div>
      <div class="field"><label>Review every (months)</label><input class="input" type="number" min="0" id="cr" value="${c?.review_months || 0}"><span class="hint">0 = no review reminder</span></div></div>
      <div class="field"><label>Description</label><input class="input" id="cd" value="${esc(c?.description || '')}"></div><div class="field"><label>Colour</label><input type="color" class="input" id="cco" value="${esc(c?.color || '#5B6B73')}" style="padding:4px;width:90px"></div>
      <div class="field"><label>Properties shown for this type</label><div class="chips">${tax.fields.map((f) => `<label class="chip ghost" style="cursor:pointer"><input type="checkbox" data-cf value="${f.id}" ${c?.fields.includes(f.id) ? 'checked' : ''} style="accent-color:var(--teal)"> ${esc(f.name)}</label>`).join('')}</div></div>`,
      foot: `${c ? '<button class="btn danger left" data-del>Delete</button>' : ''}<button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>Save content type</button>` });
    m.$('[data-ok]').onclick = async () => { await run(api('taxonomy.type_save', { id: c?.id || 0, name: m.$('#cn').value, code: m.$('#cc').value, review_months: +m.$('#cr').value, description: m.$('#cd').value, color: m.$('#cco').value, fields: m.$$('[data-cf]:checked').map((x) => +x.value) }), 'Saved.'); m.close(); reload(); };
    m.$('[data-del]')?.addEventListener('click', async () => { if (!await confirmBox('Delete this content type?', { danger: true, ok: 'Delete' })) return; await run(api('taxonomy.type_delete', { id: c.id }), 'Deleted.'); m.close(); reload(); });
  };

  page.addEventListener('click', async (e) => {
    const t = e.target;
    const tb = t.closest('[data-t]'); if (tb) return go('#/admin/taxonomy?tab=' + tb.dataset.t);
    const s = t.closest('[data-set]'); if (s) { setId = +s.dataset.set; return drawTerms(); }
    if (t.closest('[data-newset]')) return setModal(null);
    const es = t.closest('[data-editset]'); if (es) return setModal(tax.termsets.find((x) => x.id === +es.dataset.editset));
    const ac = t.closest('[data-addchild]'); if (ac) return termModal(null, +ac.dataset.addchild || 0);
    const set = tax.termsets.find((x) => x.id === setId);
    const et = t.closest('[data-editterm]'); if (et) return termModal(set.terms.find((x) => x.id === +et.dataset.editterm));
    const dt = t.closest('[data-delterm]'); if (dt) {
      try { await api('taxonomy.term_delete', { id: +dt.dataset.delterm }); toast('Term deleted.'); }
      catch (err) { if (err.data?.in_use && await confirmBox(err.message + ' Delete the term and remove it from those documents?', { danger: true, ok: 'Delete anyway' })) await run(api('taxonomy.term_delete', { id: +dt.dataset.delterm, force: '1' }), 'Term deleted.'); else if (!err.data?.in_use) toast(err.message, 'err'); }
      return reload();
    }
    const mg = t.closest('[data-merge]'); if (mg) {
      const from = set.terms.find((x) => x.id === +mg.dataset.merge);
      const m = modal({ title: `Merge “${from.label}”`, body: `<p style="margin:0" class="muted">Documents tagged “${esc(from.label)}” move to the term you choose, and “${esc(from.label)}” becomes its synonym.</p><div class="field"><label>Merge into</label><select class="input" id="mt">${set.terms.filter((x) => x.id !== from.id).map((x) => `<option value="${x.id}">${esc(x.label)}</option>`).join('')}</select></div>`,
        foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>Merge</button>` });
      m.$('[data-ok]').onclick = async () => { await run(api('taxonomy.term_merge', { from: from.id, to: +m.$('#mt').value }), 'Merged.'); m.close(); reload(); };
      return;
    }
    if (t.closest('[data-newfield]')) return fieldModal(null);
    const fr = t.closest('[data-field]'); if (fr) return fieldModal(tax.fields.find((x) => x.id === +fr.dataset.field));
    if (t.closest('[data-newtype]')) return typeModal(null);
    const ty = t.closest('[data-type]'); if (ty) return typeModal(tax.content_types.find((x) => x.id === +ty.dataset.type));
  });
});

/* ================= Analytics ================= */
route('/admin/analytics', async (page) => {
  guardAdmin();
  const r = await api('admin.stats');
  setTitle('Analytics');
  const bars = (rows, label = 'name', valKey = 'n', color) => { const max = Math.max(1, ...rows.map((x) => +x[valKey])); return `<div class="hbars">${rows.map((x) => `<div class="hbar"><span class="lbl" title="${esc(x[label])}">${esc(x[label])}</span><span class="trk"><i style="width:${(+x[valKey] / max) * 100}%;background:${esc(color || x.color || 'var(--teal)')}"></i></span><span class="v">${x[valKey]}</span></div>`).join('') || '<p class="faint small">No data yet.</p>'}</div>`; };
  const months = []; const now = new Date();
  for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); months.push({ k, label: d.toLocaleString('en-GB', { month: 'short' }), n: +(r.months.find((m) => m.m === k)?.n || 0) }); }
  const mmax = Math.max(1, ...months.map((m) => m.n));
  const st = Object.fromEntries(r.byStatus.map((x) => [x.status, +x.n]));
  page.innerHTML = `${adminNav('analytics')}<div class="page-head"><div class="grow"><h1>Analytics</h1><p>How the hub is used and where knowledge needs attention.</p></div></div>
    <div class="stat-row">
      <div class="stat"><b>${st.published || 0}</b><span>Published documents</span></div>
      ${S.settings.approvals ? `<div class="stat ${st.pending ? 'warn' : ''}"><b>${st.pending || 0}</b><span>Waiting for approval${r.stale ? ` · ${r.stale} over 3 days` : ''}</span></div>
      <div class="stat"><b>${r.approvalTime ? Math.round(r.approvalTime) + ' h' : '—'}</b><span>Average time to approve</span></div>`
      : `<div class="stat"><b>${(st.draft || 0) + (st.rejected || 0)}</b><span>Unpublished drafts</span></div>`}
      <div class="stat"><b>${r.active}</b><span>Active people (30 days)</span></div>
      <div class="stat"><b>${fmtSize(r.storage)}</b><span>Storage used</span></div>
      <div class="stat ${r.overdue ? 'warn' : ''}"><b>${r.overdue}</b><span>Reviews overdue</span></div>
      <div class="stat ${r.neverTagged ? 'warn' : ''}"><b>${r.neverTagged}</b><span>Documents without tags</span></div>
    </div>
    <div class="panel" style="margin-bottom:18px"><div class="panel-h"><h3>Versions uploaded per month</h3></div><div class="panel-b"><div class="cols">${months.map((m) => `<div class="c"><i style="height:${(m.n / mmax) * 82}%"><b>${m.n || ''}</b></i>${m.label}</div>`).join('')}</div></div></div>
    <div class="two-col">
      <div class="panel"><div class="panel-h"><h3>Documents by library</h3></div><div class="panel-b">${bars(r.byLib)}</div></div>
      <div class="panel"><div class="panel-h"><h3>Documents by department</h3></div><div class="panel-b">${bars(r.byDept)}</div></div>
      <div class="panel"><div class="panel-h"><h3>By content type</h3></div><div class="panel-b">${bars(r.byType)}</div></div>
      <div class="panel"><div class="panel-h"><h3>Top contributors · 90 days</h3></div><div class="panel-b">${bars(r.contributors, 'name', 'n', 'var(--violet)')}</div></div>
      <div class="panel"><div class="panel-h"><h3>Most viewed</h3></div><div class="doc-rows">${r.top.map((d) => `<a class="doc-row" href="#/doc/${d.id}"><span class="faint">${icon('eye', 'sm')}</span><div style="min-width:0"><div class="t">${esc(d.title)}</div><div class="s">${esc(d.doc_number || '')} · ${esc(d.library)}</div></div><span class="r">${d.views}</span></a>`).join('')}</div></div>
      <div class="panel"><div class="panel-h"><h3>What people search for · 30 days</h3></div><div class="panel-b">${bars(r.searches, 'q', 'n', 'var(--amber)')}<p class="faint small" style="margin:12px 0 0">Frequent searches with few results show gaps in the knowledge base.</p></div></div>
    </div>`;
});

/* ================= Audit ================= */
route('/admin/audit', async (page, _, params) => {
  guardAdmin();
  const dir = await loadDir();
  setTitle('Audit log');
  const f = { user_id: params.user_id || '', action: params.action || '', object_type: params.object_type || '', object_id: params.object_id || '', from: '', to: '', q: '', page: 1 };
  page.innerHTML = `${adminNav('audit')}<div class="page-head"><div class="grow"><h1>Audit log</h1><p>Every sign-in, view, download, upload, approval and permission change, with who did it and from where.</p></div><button class="btn" id="aCsv">${icon('download', 'sm')}Export CSV</button></div>
    <div class="toolbar"><select class="input" id="aU" style="width:auto"><option value="">Everyone</option>${dir.people.map((p) => `<option value="${p.id}" ${+f.user_id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
    <select class="input" id="aA" style="width:auto"><option value="">All actions</option></select><input class="input" type="date" id="aF" style="width:auto"><input class="input" type="date" id="aT" style="width:auto">
    <div class="filter-input">${icon('search', 'sm')}<input class="input" id="aQ" placeholder="Search details"></div>${f.object_id ? `<span class="chip">Document #${esc(f.object_id)}<span class="x" id="aClr">${icon('x', 'sm')}</span></span>` : ''}</div>
    <div class="table-wrap"><table class="list"><thead><tr><th>When</th><th>Person</th><th>Action</th><th>Item</th><th>Details</th><th>IP</th></tr></thead><tbody id="aB"></tbody></table><div class="pager" id="aP"></div></div>`;
  const load = async () => {
    const r = await api('admin.audit', undefined, { query: f });
    const sel = $('#aA'); if (sel.options.length === 1) sel.innerHTML += r.actions.map((a) => `<option ${a === f.action ? 'selected' : ''}>${esc(a)}</option>`).join('');
    $('#aB').innerHTML = r.rows.map((x) => `<tr><td class="nowrap small">${esc(fmtDate(x.created_at, true))}</td><td>${esc(x.user_name || 'System')}</td><td><span class="pill">${esc(x.action)}</span></td>
      <td class="small">${x.object_type === 'document' && x.object_id ? `<a href="#/doc/${x.object_id}">${esc(x.object_name || '#' + x.object_id)}</a>` : esc(x.object_type + (x.object_id ? ' #' + x.object_id : ''))}</td><td class="small muted">${esc(x.details || '')}</td><td class="small faint mono">${esc(x.ip)}</td></tr>`).join('') || '<tr><td colspan="6" class="faint">No entries match.</td></tr>';
    $('#aP').innerHTML = `${r.total} entries · page ${r.page} of ${Math.max(1, r.pages)} <button class="btn sm" ${r.page <= 1 ? 'disabled' : ''} data-pg="-1">Previous</button><button class="btn sm" ${r.page >= r.pages ? 'disabled' : ''} data-pg="1">Next</button>`;
  };
  const set = (k) => (e) => { f[k] = e.target.value; f.page = 1; load(); };
  $('#aU').onchange = set('user_id'); $('#aA').onchange = set('action'); $('#aF').onchange = set('from'); $('#aT').onchange = set('to'); $('#aQ').oninput = debounce(set('q'), 300);
  $('#aClr')?.addEventListener('click', () => go('#/admin/audit'));
  $('#aP').onclick = (e) => { const b = e.target.closest('[data-pg]'); if (b) { f.page += +b.dataset.pg; load(); } };
  $('#aCsv').onclick = () => { location.href = 'api.php?r=admin.audit&format=csv&' + qs(f); };
  load();
});

/* ================= Settings ================= */
route('/admin/settings', async (page) => {
  guardAdmin();
  const { settings: s } = await api('admin.settings');
  setTitle('Settings');
  const sv = s.server;
  page.innerHTML = `${adminNav('settings')}<div class="page-head"><div class="grow"><h1>Settings</h1></div><button class="btn primary" id="sSave">Save settings</button></div>
    <div class="two-col">
      <div class="panel"><div class="panel-h"><h3>Identity</h3></div><div class="panel-b" style="display:grid;gap:14px">
        <div class="field"><label>Platform name</label><input class="input" data-k="site_name" value="${esc(s.site_name)}"></div>
        <div class="field"><label>Organisation</label><input class="input" data-k="org_name" value="${esc(s.org_name)}"></div>
        <div class="field"><label>Welcome text</label><textarea class="input" data-k="welcome_text">${esc(s.welcome_text)}</textarea></div>
        <div class="field"><label>Site address</label><input class="input" data-k="base_url" value="${esc(s.base_url)}" placeholder="https://km.arginternational.ae/"><span class="hint">Used for links in notification emails.</span></div></div></div>
      <div class="panel"><div class="panel-h"><h3>Documents</h3></div><div class="panel-b" style="display:grid;gap:14px">
        <div class="field"><label>Document number pattern</label><input class="input mono" data-k="number_pattern" value="${esc(s.number_pattern)}"><span class="hint">Tokens: {LIB} library code, {TYPE} content-type code, {SEQ} running number, {YYYY} / {YY} year.</span></div>
        <div class="grid2"><div class="field"><label>Max upload (MB)</label><input class="input" type="number" data-k="max_upload_mb" value="${esc(s.max_upload_mb)}"><span class="hint">Server allows ${esc(sv.upload_max_filesize)} per file / ${esc(sv.post_max_size)} per request.</span></div>
        <div class="field"><label>Keep deleted items (days)</label><input class="input" type="number" data-k="recycle_days" value="${esc(s.recycle_days)}"></div></div>
        <div class="field"><label>Allowed file types</label><textarea class="input mono" data-k="allowed_ext" rows="3">${esc(s.allowed_ext)}</textarea></div></div></div>
      <div class="panel"><div class="panel-h"><h3>Publishing</h3></div><div class="panel-b" style="display:grid;gap:14px">
        <label class="check"><input type="checkbox" data-k="approval_workflow" ${s.approval_workflow === '1' ? 'checked' : ''}><span><b>Require approval before documents are published</b><br><span class="small muted">Off: anyone with Contribute access publishes straight away. On: uploads wait for a department head (per library rule). Switching it off publishes everything still waiting.</span></span></label>
        <p class="small muted" style="margin:0">Either way, published documents can’t be deleted by staff — only administrators can, through the recycle bin.</p></div></div>
      <div class="panel"><div class="panel-h"><h3>Two-step verification</h3><span class="faint small">${s.mfa_counts.on} of ${s.mfa_counts.people} people have it on</span></div><div class="panel-b" style="display:grid;gap:14px">
        <div class="field"><label>Who must use it</label><select class="input" data-k="mfa_policy">
          <option value="optional" ${s.mfa_policy === 'optional' ? 'selected' : ''}>Optional — each person decides on their profile</option>
          <option value="privileged" ${s.mfa_policy === 'privileged' ? 'selected' : ''}>Required for administrators and department heads</option>
          <option value="all" ${s.mfa_policy === 'all' ? 'selected' : ''}>Required for everyone</option></select>
          <span class="hint">People who must use it and haven't set it up are asked to scan a QR code at their next sign-in. Turn it on for your own account first.</span></div>
        <div class="field"><label>“Trust this device” lasts (days)</label><input class="input" type="number" min="0" max="365" data-k="mfa_remember_days" value="${esc(s.mfa_remember_days)}"><span class="hint">0 asks for a code at every sign-in.</span></div></div></div>
      <div class="panel"><div class="panel-h"><h3>Security & notifications</h3></div><div class="panel-b" style="display:grid;gap:14px">
        <div class="field"><label>Sign out after inactivity (minutes)</label><input class="input" type="number" data-k="session_minutes" value="${esc(s.session_minutes)}"></div>
        <label class="check"><input type="checkbox" data-k="email_notifications" ${s.email_notifications === '1' ? 'checked' : ''}><span><b>Also send notifications by email</b><br><span class="small muted">Uses the server’s mail function. Create the sender mailbox in cPanel → Email Accounts first.</span></span></label>
        <div class="field"><label>Sender address</label><input class="input" data-k="mail_from" value="${esc(s.mail_from)}" placeholder="no-reply@arginternational.ae"></div></div></div>
      <div class="panel"><div class="panel-h"><h3>Server</h3></div><div class="panel-b"><dl class="kv">
        <dt>Version</dt><dd>${esc(sv.app_version)}</dd><dt>PHP</dt><dd>${esc(sv.php)}</dd><dt>Database</dt><dd>${esc(sv.mysql)}</dd><dt>Memory</dt><dd>${esc(sv.memory_limit)}</dd>
        <dt>ZIP support</dt><dd>${sv.zip ? 'Yes' : '<span style="color:var(--red)">Missing — enable the zip extension in cPanel → Select PHP Version</span>'}</dd>
        <dt>Storage</dt><dd>${sv.storage_writable ? 'Writable' : '<span style="color:var(--red)">Not writable — check folder permissions</span>'}</dd></dl></div></div>
    </div>`;
  $('#sSave').onclick = async () => {
    const out = {};
    $$('[data-k]', page).forEach((el) => { out[el.dataset.k] = el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value; });
    const flowChanged = (out.approval_workflow === '1') !== !!S.settings.approvals;
    if (flowChanged && out.approval_workflow !== '1' && !await confirmBox('Switch off approvals? Every document still waiting for approval will be published now.', { ok: 'Switch off' })) return;
    await run(api('admin.settings_save', out), 'Settings saved.');
    Object.assign(S.settings, { site_name: out.site_name, org_name: out.org_name, welcome_text: out.welcome_text });
    if (flowChanged) location.reload();
  };
});
/* Text recognition (OCR) in the browser: makes scanned / picture-only PDFs and images searchable.
   Engine: tesseract.js + PDF.js, served from assets/ocr (no outside services; files never leave the company). */
'use strict';

const OCR_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'];
const OCRQ = { jobs: [], running: null, worker: null, idleTimer: null, done: 0, failed: 0, listeners: new Set() };
const absUrl = (p) => new URL(p, location.href).href;

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src; s.dataset.src = src; s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the text-recognition engine (' + src + '). Check that the assets/ocr folder was uploaded.'));
    document.head.appendChild(s);
  });
}

async function ocrWorker() {
  clearTimeout(OCRQ.idleTimer);
  if (OCRQ.worker) return OCRQ.worker;
  await loadScriptOnce('assets/ocr/tesseract.min.js');
  OCRQ.worker = await Tesseract.createWorker('eng', 1, {   // 1 = LSTM engine (accurate, uses the smaller core build)
    workerPath: absUrl('assets/ocr/worker.min.js'),
    corePath: absUrl('assets/ocr/core'),
    langPath: absUrl('assets/ocr/lang'),
    gzip: false,
    workerBlobURL: false,
    logger: (m) => { if (OCRQ.running && m.status === 'recognizing text') OCRQ.running.pageProgress = m.progress; notifyOcr(); },
  });
  // Automatic page layout (3). The library default (6, "one block of text") can skip rows in tables.
  await OCRQ.worker.setParameters({ tessedit_pageseg_mode: '3', preserve_interword_spaces: '1' });
  return OCRQ.worker;
}
async function pdfLib() {
  await loadScriptOnce('assets/ocr/pdf.min.js');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'assets/ocr/pdf.worker.min.js';
  return window.pdfjsLib;
}

/** Draws an image file onto a canvas (decoding is done by the browser, so WEBP/GIF/BMP work too). */
async function imageToCanvas(blob, maxSide = 3600) {
  const bmp = await createImageBitmap(blob);
  // small pictures are enlarged (up to 2×): recognition is far more accurate when letters are larger
  let k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  if (bmp.width < 2200) k = Math.min(2, 2200 / bmp.width, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close && bmp.close();
  return c;
}

/**
 * Reads the text of a file. PDFs: pages that already contain real text keep it; picture-only pages are recognised.
 * Returns { text, pages, ranPages, confidence }.
 */
async function recogniseFile(blob, ext, job) {
  ext = String(ext).toLowerCase();
  const worker = await ocrWorker();
  if (ext !== 'pdf') {
    job.pages = 1; job.page = 1; notifyOcr();
    const { data } = await worker.recognize(await imageToCanvas(blob));
    return { text: data.text || '', pages: 1, ranPages: 1, confidence: Math.round(data.confidence || 0) };
  }
  const lib = await pdfLib();
  const pdf = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
  job.pages = pdf.numPages; notifyOcr();
  const parts = []; let ran = 0, confSum = 0;
  for (let n = 1; n <= pdf.numPages; n++) {
    job.page = n; job.pageProgress = 0; notifyOcr();
    const page = await pdf.getPage(n);
    const tc = await page.getTextContent();
    const native = tc.items.map((i) => i.str + (i.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+/g, ' ').trim();
    if (native.replace(/\s/g, '').length >= 40) { parts.push(native); page.cleanup(); continue; }
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(4.5, Math.max(2, 2600 / base.width));     // ~300 dpi for an A4 page: best accuracy in tests
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    const { data } = await worker.recognize(c);
    parts.push(((native ? native + '\n' : '') + (data.text || '')).trim());
    ran++; confSum += data.confidence || 0;
    c.width = c.height = 0; page.cleanup();
  }
  pdf.destroy();
  return { text: parts.join('\n\n'), pages: pdf.numPages || job.pages, ranPages: ran, confidence: ran ? Math.round(confSum / ran) : 100 };
}

/* ---------- Background queue ---------- */
/** Adds a document version to the background queue. source: a File (just uploaded) or nothing (fetched from the server). */
function ocrEnqueue({ docId, versionId, title, ext, file = null }) {
  if (!OCR_EXT.includes(String(ext).toLowerCase())) return false;
  if (OCRQ.running?.versionId === versionId || OCRQ.jobs.some((j) => j.versionId === versionId)) return false;
  OCRQ.jobs.push({ docId, versionId, title, ext, file, state: 'queued', page: 0, pages: 0, pageProgress: 0 });
  notifyOcr();
  if (!OCRQ.running) runOcrQueue();
  return true;
}
function ocrJobFor(versionId) { return OCRQ.running?.versionId === versionId ? OCRQ.running : OCRQ.jobs.find((j) => j.versionId === versionId) || null; }

async function runOcrQueue() {
  while (OCRQ.jobs.length) {
    const job = OCRQ.jobs.shift();
    OCRQ.running = job; job.state = 'running'; notifyOcr();
    try {
      let blob = job.file;
      if (!blob) {
        const res = await fetch(`download.php?id=${job.docId}&v=${job.versionId}&inline=1`, { credentials: 'same-origin' });
        if (!res.ok) throw new Error((await res.text()).slice(0, 160) || 'Could not open the file (' + res.status + ').');
        blob = await res.blob();
      }
      const r = await recogniseFile(blob, job.ext, job);
      const saved = await api('docs.ocr_save', { id: job.docId, version_id: job.versionId, text: r.text.slice(0, 400000), pages: r.pages, ocr_pages_run: r.ranPages, confidence: r.confidence });
      job.state = 'done'; job.words = saved.words || 0; OCRQ.done++;
      if (r.ranPages) toast(saved.words ? `“${job.title}” is now searchable — ${saved.words} words recognised.` : `No readable text was found in “${job.title}”.`, saved.words ? '' : 'err');
    } catch (e) {
      job.state = 'failed'; job.error = e.message; OCRQ.failed++;
      toast(`Couldn't read text from “${job.title}”: ${e.message}`, 'err', 7000);
    }
    OCRQ.listeners.forEach((fn) => { try { fn(job); } catch (e) {} });
    OCRQ.running = null; notifyOcr();
  }
  // free the engine's memory after a quiet period
  OCRQ.idleTimer = setTimeout(async () => { if (!OCRQ.running && !OCRQ.jobs.length && OCRQ.worker) { await OCRQ.worker.terminate().catch(() => {}); OCRQ.worker = null; } }, 120000);
}

/* ---------- Progress chip ---------- */
function notifyOcr() {
  let chip = document.getElementById('ocrChip');
  const job = OCRQ.running;
  if (!job && !OCRQ.jobs.length) { chip?.remove(); return; }
  if (!chip) { chip = document.createElement('div'); chip.id = 'ocrChip'; chip.className = 'ocr-chip'; chip.setAttribute('role', 'status'); document.body.appendChild(chip); }
  const pct = job && job.pages ? Math.round(((job.page - 1) + (job.pageProgress || 0)) / job.pages * 100) : 0;
  const waiting = OCRQ.jobs.length;
  chip.innerHTML = `<span class="ocr-spin" aria-hidden="true"></span><div><b>Making ${waiting ? (waiting + 1) + ' documents' : 'a document'} searchable</b>
    <span>${job ? esc(job.title) + (job.pages > 1 ? ` · page ${job.page} of ${job.pages}` : '') : 'Starting…'}</span>
    <i class="ocr-bar"><i style="width:${pct}%"></i></i></div>`;
  chip.title = 'Text is read in this browser tab. Keep the tab open until it finishes.';
}
window.addEventListener('beforeunload', (e) => { if (OCRQ.running || OCRQ.jobs.length) { e.preventDefault(); e.returnValue = ''; } });

/* ---------- Admin: make existing documents searchable ---------- */
route('/admin/ocr', async (page) => {
  guardAdmin();
  const r = await api('docs.ocr_queue');
  setTitle('Searchable text');
  page.innerHTML = `${adminNav('ocr')}<div class="page-head"><div class="grow"><h1>Searchable text</h1>
    <p>Scanned PDFs, pictures pasted into Word, and photos contain no real text, so search can't see the words in them. Text recognition (OCR) reads those words so they become searchable. It runs in this browser tab — nothing is sent outside the company.</p></div>
    ${r.items.length ? `<button class="btn primary" id="ocrAll">${icon('sparkle', 'sm')}Make all ${r.items.length} searchable</button>` : ''}</div>
    <div class="stat-row"><div class="stat ${r.items.length ? 'warn' : ''}"><b>${r.items.length}</b><span>Documents without searchable text</span></div><div class="stat"><b>${r.done}</b><span>${r.done === 1 ? 'Version' : 'Versions'} already recognised</span></div></div>
    ${r.items.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Document</th><th>Library</th><th>Version</th><th>Size</th><th>Status</th></tr></thead><tbody>
      ${r.items.map((x) => `<tr data-v="${x.version_id}"><td><div class="doc-title">${fileIcon(x.ext, 'sm')}<div><a class="tt" href="#/doc/${x.id}">${esc(x.title)}</a><div class="nn">${esc(x.doc_number || '')}</div></div></div></td>
        <td>${esc(x.library)}</td><td class="ver">${esc(x.version)}${x.is_current ? '' : ' <span class="faint small">(published)</span>'}</td><td class="nowrap">${fmtSize(x.size)}</td>
        <td class="nowrap" data-st="${x.version_id}"><button class="btn sm" data-one="${x.version_id}">Make searchable</button></td></tr>`).join('')}
    </tbody></table></div>
    <p class="faint small">Allow roughly 5–15 seconds per page. Keep this tab open while it works; you can use other pages of the Hub meanwhile.</p>`
    : emptyState('check', 'Every document has searchable text', 'New scans and pictures are read automatically when they are uploaded.')}`;
  const byV = Object.fromEntries(r.items.map((x) => [x.version_id, x]));
  const paint = () => {
    r.items.forEach((x) => {
      const cell = page.querySelector(`[data-st="${x.version_id}"]`); if (!cell) return;
      const j = ocrJobFor(x.version_id);
      if (x._done) cell.innerHTML = x._done;
      else if (j && j.state === 'running') cell.innerHTML = `<span class="status pending">Reading${j.pages > 1 ? ` page ${j.page} of ${j.pages}` : '…'}</span>`;
      else if (j) cell.innerHTML = '<span class="faint">Waiting…</span>';
    });
  };
  const onJob = (job) => {
    const x = byV[job.versionId]; if (!x) return;
    x._done = job.state === 'done' ? `<span class="status published">${job.words} words</span>` : `<span class="status rejected" title="${esc(job.error || '')}">Failed</span>`;
    paint();
  };
  OCRQ.listeners.add(onJob);
  const timer = setInterval(paint, 700);
  const add = (x) => ocrEnqueue({ docId: x.id, versionId: x.version_id, title: x.title, ext: x.ext });
  page.querySelector('#ocrAll')?.addEventListener('click', (e) => { r.items.forEach(add); e.target.disabled = true; paint(); });
  page.addEventListener('click', (e) => { const b = e.target.closest('[data-one]'); if (b) { add(byV[+b.dataset.one]); paint(); } });
  return () => { OCRQ.listeners.delete(onJob); clearInterval(timer); };
});
'use strict';
boot();
