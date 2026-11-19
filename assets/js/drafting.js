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

/** The seal's ring text: the platform name and DOCUMENT CONTROL. */
function sealRing() { return String(S.settings.site_name || 'KM Platform').toUpperCase().replace(/\s+/g, ' ').trim().slice(0, 24) + ' ★ DOCUMENT CONTROL ★ '; }

/** Round company seal: "<platform> · DOCUMENT CONTROL" ring, APPROVED band, initials and date. */
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
          <textPath href="#${id}" startOffset="0" textLength="274" lengthAdjust="spacing">${esc(sealRing())}</textPath></text>
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
    confidential: ['CONFIDENTIAL', 'DO NOT SHARE'], restricted: ['RESTRICTED', 'NAMED ACCESS ONLY'] }[kind] || [String(kind).toUpperCase(), sub];
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
