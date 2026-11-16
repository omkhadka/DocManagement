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
