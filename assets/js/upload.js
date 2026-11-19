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
const CONF_RANK = { public: 0, internal: 1, confidential: 2, restricted: 3 };
const CONF_NAME = { public: 'Public', internal: 'Internal', confidential: 'Confidential', restricted: 'Restricted' };

async function openUpload({ libraryId = null, folderId = null, documentId = null, files = [], onDone } = {}) {
  await Promise.all([loadTax(), loadDir(), loadLibs()]);
  const writable = S.libs.filter((l) => l.level >= 2);
  let doc = null;
  if (documentId) doc = (await api('docs.get', undefined, { query: { id: documentId } })).doc;
  if (!documentId && !writable.length && !libraryId) return toast("You don't have upload access to any library yet. Ask an administrator.", 'err');
  const canPublish = S.user.is_admin || S.user.is_head;
  const toto = !doc && !!S.settings.ai;     // Toto reads new uploads before they are published
  const queue = [];
  let lib = libraryId || writable[0]?.id, folder = folderId || null;
  let props = null;
  let ctTouched = false, finished = false;
  const tagSel = new Set();                 // general tags (terms with no matching property on the content type)
  let sensChoice = null;                    // single file: 'raise' | 'keep' once the person decided on Toto's warning

  const m = modal({ title: doc ? 'Upload a new version' : 'Upload documents', size: 'wide', onClose: () => { queue.forEach((q) => { if (q.scan) q.scan.cancelled = true; }); if (!finished) unstage(queue.filter((q) => q.token && q.state !== 'done')); }, body: `
    ${doc ? `<div class="alert teal">${fileIcon(doc.ext, 'sm')}<div class="grow"><b>${esc(doc.title)}</b><span class="mono small">${esc(doc.doc_number || '')} · current version ${esc(doc.version)}</span></div></div>` : `
    <div class="grid2"><div class="field"><label>Library</label><select class="input" id="uLib">${writable.map((l) => `<option value="${l.id}" ${l.id === lib ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Folder</label><select class="input" id="uFolder"><option value="">Library root</option></select></div></div>`}
    <div class="drop" id="uDrop" tabindex="0" role="button">${icon('upload')}<b>${doc ? 'Choose the updated file' : 'Drop files here or choose files'}</b><span class="small">${esc((S.settings.allowed_ext || []).slice(0, 12).join(', ').toUpperCase())}… up to ${Math.min(S.settings.max_upload_mb, S.settings.server_upload_mb || 9999)} MB each</span>
      <input type="file" id="uFile" ${doc ? '' : 'multiple'} hidden></div>
    <div class="uq" id="uQueue"></div>
    <div id="uToto"></div>
    <div id="uSuggest"></div>
    ${doc ? `<div class="field"><label>What changed in this version?</label><input class="input" id="uComment" placeholder="e.g. Updated hold time after client comments"></div>` : `
    <div id="uSingle" class="hidden" style="display:grid;gap:14px"><div class="field"><label for="uTitle">Title</label><input class="input" id="uTitle" placeholder="Defaults to the file name"></div>
      <div class="field hidden" id="uNoWrap"><label for="uNo">Document number <span class="faint">(Full control only)</span></label><input class="input mono" id="uNo" placeholder="Leave empty to number it automatically"></div></div>
    <div class="grid3">
      <div class="field"><label for="uCt">Content type</label><select class="input" id="uCt"><option value="">General document</option>${S.tax.content_types.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="uConf">Classification</label><select class="input" id="uConf"><option value="internal">Internal</option><option value="public">Public</option><option value="confidential">Confidential</option><option value="restricted">Restricted</option></select></div>
      <div class="field"><label for="uReview">Next review date <span class="faint">(optional)</span></label><input class="input" type="date" id="uReview" min="${localISODate(1)}"><span class="hint">When this document should be checked again — not the document's own date.</span></div>
    </div>
    <div class="hint conf-hint" id="uConfHint">${esc(CONF_HELP.internal)}</div>
    <div id="uFields"></div>
    <div class="field hidden" id="uTagsWrap"><label>Tags</label><div class="chips" id="uTags"></div><span class="hint">Click a tag to switch it on or off. Tags make the document easier to find and filter.</span></div>
    <div class="field"><label for="uDesc">Description</label><textarea class="input" id="uDesc" rows="2" style="min-height:64px" placeholder="What is this document for? Searchable."></textarea></div>
    <div class="field"><label for="uKw">Keywords</label><input class="input" id="uKw" placeholder="Comma separated — e.g. hydrotest, jetty, NCR-112"></div>`}
    <div class="field"><label>After upload</label><div class="mode-pick" id="uMode"></div></div>`,
    foot: `<span class="left faint small" id="uInfo"></span><button class="btn" data-close>Cancel</button><button class="btn primary" data-ok disabled>${icon('upload', 'sm')}Upload</button>` });

  const libObj = () => S.libs.find((l) => l.id === +lib) || {};
  const single = () => !doc && queue.length === 1 && !queue[0].existing && !queue[0].asVersionOf;
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
    drawQueue(); drawToto();
  };
  const drawQueue = () => {
    m.$('#uQueue').innerHTML = queue.map((q, i) => {
      let st = fmtSize(q.file.size), cls = '', extra = '';
      if (q.state === 'done') { st = esc(q.msg); cls = 'ok'; }
      else if (q.state === 'error') { st = esc(q.msg); cls = 'err'; }
      else if (q.state === 'uploading') st = (q.token ? 'Publishing… ' : 'Uploading… ') + Math.round(q.progress) + '%';
      else if (q.state === 'analyzing') st = q.progress < 100 ? `Sending… ${Math.round(q.progress)}%` : `${totoMark()} Toto is reading the file…`;
      else if (q.scan?.state === 'reading') {
        const pct = q.scan.pages ? Math.round(((q.scan.page || 1) - 1 + (q.scan.pageProgress || 0)) / q.scan.pages * 100) : 0;
        st = `${totoMark()} ${q.scan.page ? `Toto is reading the scanned text${q.scan.pages > 1 ? ` — page ${q.scan.page} of ${q.scan.pages}` : ''} · ${pct}%` : 'Scan found — waiting to read its text…'}`;
        extra = `<div class="bar"><i style="width:${pct}%"></i></div>`;
      }
      else if (q.asVersionOf) { st = `Will become a new version of “${esc(q.asVersionOf.title)}”`; cls = 'v'; extra = `<button class="linklike small" data-novers="${i}">Upload as a separate document instead</button>`; }
      else if (q.existing) { st = `Same name exists — will become a new version of “${esc(q.existing.title)}” (now ${esc(q.existing.version)})${q.existing.locked ? ' · checked out' : ''}`; cls = 'v'; }
      else if (q.toto) {
        const t = q.toto, bits = [];
        if (q.exact?.length) bits.push(`<span class="st err">The very same file is already in: ${q.exact.map((d) => `<a href="#/doc/${d.id}" target="_blank">${esc(d.title)}</a>`).join(', ')}</span>`);
        const nd = t.near_duplicates?.[0];
        if (nd && !q.exact?.length) bits.push(`<span class="st v">${totoMark()} ${nd.match}% the same as <a href="#/doc/${nd.id}" target="_blank">“${esc(nd.title)}”</a>${nd.doc_number ? ` <span class="mono">${esc(nd.doc_number)}</span>` : ''}${nd.can_version ? ` — <button class="linklike" data-asver="${i}">make it a new version of that document</button>` : ''}</span>`);
        if (t.sensitive?.level && !single()) bits.push(`<span class="st warn">${totoMark()} Looks ${esc(CONF_NAME[t.sensitive.level])}: ${esc(t.sensitive.reasons.filter((r) => r.level === t.sensitive.level).map((r) => r.label).join('; '))}</span>`);
        if (!bits.length && !single()) bits.push(`<span class="st">${fmtSize(q.file.size)} · ${totoMark()} ${esc(totoBrief(t))}</span>`);
        if (bits.length) { st = ''; extra = bits.join(''); }
      }
      return `<div class="uq-item">${fileIcon(q.file.name.split('.').pop(), 'sm')}<div style="min-width:0"><div class="nm">${esc(q.file.name)}</div>${st ? `<div class="st ${cls}">${st}</div>` : ''}${extra ? `<div class="uq-toto">${extra}</div>` : ''}${['uploading', 'analyzing'].includes(q.state) && q.progress < 100 ? `<div class="bar"><i style="width:${q.progress}%"></i></div>` : ''}</div>
        ${q.state && q.state !== 'analyzing' ? (q.state === 'done' && q.id ? `<a class="btn sm" href="#/doc/${q.id}">Open</a>` : '') : `<button class="mini-btn" data-rmq="${i}" title="Remove">${icon('x', 'sm')}</button>`}</div>`;
    }).join('');
    const busy = queue.some((q) => q.state === 'analyzing');
    m.$('[data-ok]').disabled = busy || !queue.some((q) => !q.state);
    m.$('#uSingle')?.classList.toggle('hidden', !single());
    m.$('#uInfo').innerHTML = busy ? `${totoMark()} Toto is reading ${plural(queue.filter((q) => q.state === 'analyzing').length, 'file')}…` : queue.length ? `${queue.length} file${queue.length > 1 ? 's' : ''}` : '';
  };

  /* ---- Toto: suggestions ---- */
  const markFilled = (el, on = true) => {
    if (!el) return;
    el.classList.toggle('toto-filled', on);
    const lab = el.closest('.field')?.querySelector('label');
    if (!lab) return;
    lab.querySelector('.toto-tag')?.remove();
    if (on) lab.insertAdjacentHTML('beforeend', ' ' + totoTag());
  };
  const fill = (el, value) => { if (!el || value == null || value === '' || el.value) return false; el.value = value; markFilled(el); el.dataset.toto = '1'; return true; };
  const clearFills = () => {   // a second file was added: single-file suggestions no longer apply to the whole batch
    m.$$('[data-toto="1"]').forEach((el) => { if (el.id === 'uCt') { el.value = ''; ctTouched = false; drawProps(); } else el.value = ''; delete el.dataset.toto; markFilled(el, false); });
    tagSel.clear(); drawTags(); sensChoice = null;
  };
  const totoBrief = (t) => {
    const n = (t.terms || []).filter((x) => x.auto).length;
    return [t.content_type?.auto ? t.content_type.name : '', n ? plural(n, 'tag') : '', t.sensitive?.level ? '' : 'no sensitive data seen'].filter(Boolean).join(' · ') || 'nothing to suggest';
  };
  const fieldFor = (re, types) => (props ? fieldsForType(m.$('#uCt').value).find((f) => types.includes(f.type) && re.test(f.name)) : null);
  const applyFieldHints = (t) => {   // revision, document date and number into matching properties of the content type
    const put = (f, v) => { if (f && v) fill(m.$(`[data-fid="${f.id}"]`), v); };
    put(fieldFor(/\brev(ision)?\b/i, ['text', 'number', 'choice']), t.revision);
    put(fieldFor(/date|issued|effective/i, ['date']), t.date);
    put(fieldFor(/(doc(ument)?|drawing|dwg|ref(erence)?|procedure)\s*(no|number|#)|^number$/i, ['text']), t.doc_number);
  };
  const applyTerms = (t) => {
    (t.terms || []).filter((x) => x.auto).forEach((x) => { if (!props?.addTerm(x.id)) tagSel.add(x.id); });
    drawTags();
  };
  const applyToto = (q) => {
    const t = q.toto; if (!t || !single()) return;
    fill(m.$('#uTitle'), t.title);
    if (t.content_type?.auto && !ctTouched && !m.$('#uCt').value) { m.$('#uCt').value = t.content_type.id; m.$('#uCt').dataset.toto = '1'; markFilled(m.$('#uCt')); drawProps(); ctDefaults(); }
    applyFieldHints(t);
    applyTerms(t);
    if (t.keywords?.length) fill(m.$('#uKw'), t.keywords.join(', '));
    if (t.doc_number && libObj().level >= 4) m.$('#uNoWrap').classList.remove('hidden');
    drawToto();
  };
  const termById = (id) => termIndex()[id];
  const drawTags = () => {
    const w = m.$('#uTagsWrap'); if (!w) return;
    const offered = new Map();
    queue.forEach((q) => (q.toto?.terms || []).forEach((x) => { if (!offered.has(x.id)) offered.set(x.id, x); }));
    // terms that fit a property of the content type are offered there instead
    const inProps = new Set(fieldsForType(m.$('#uCt').value).filter((f) => f.type === 'term').map((f) => f.termset_id));
    const list = [...offered.values()].filter((x) => !inProps.has(x.termset_id) || tagSel.has(x.id));
    w.classList.toggle('hidden', !list.length || !single());
    m.$('#uTags').innerHTML = list.map((x) => `<button type="button" class="chip ${tagSel.has(x.id) ? 'on' : 'add'}" data-tag="${x.id}" title="${esc(x.termset)} · ${esc(x.why)}">${icon(tagSel.has(x.id) ? 'check' : 'plus', 'sm')}${esc(x.label)} <span class="faint">· ${esc(x.termset)}</span></button>`).join('');
  };
  const sensFor = (q) => q.toto?.sensitive?.level && CONF_RANK[q.toto.sensitive.level] > CONF_RANK[m.$('#uConf').value] ? q.toto.sensitive : null;
  const drawToto = () => {
    const host = m.$('#uToto'); if (!host || !toto) return;
    const ready = queue.filter((q) => q.toto && !q.state && !q.existing && !q.asVersionOf);
    if (!ready.length) { host.innerHTML = ''; return; }
    let html = '';
    if (single()) {
      const t = ready[0].toto, sens = sensFor(ready[0]);
      if (sens && sensChoice !== 'keep') {
        html += `<div class="alert amber toto-alert" id="uSens">${icon('shield')}<div class="grow"><b>${totoMark()} Toto found information that looks ${esc(CONF_NAME[sens.level])}</b>
          <ul class="toto-reasons">${sens.reasons.map((r) => `<li>${esc(r.label)}${r.count > 1 ? ` <span class="faint">× ${r.count}</span>` : ''}</li>`).join('')}</ul>
          <span class="small">${esc(CONF_HELP[sens.level])}</span></div>
          <div class="btn-col"><button class="btn sm primary" type="button" data-sens="raise">Make it ${esc(CONF_NAME[sens.level])}</button><button class="btn sm ghost" type="button" data-sens="keep">Keep ${esc(CONF_NAME[m.$('#uConf').value])}</button></div></div>`;
      }
      const scanNote = ready[0].scan?.state === 'done' && ready[0].scan.words ? `<div class="small muted">${icon('search', 'sm')} Read from the scan: ${ready[0].scan.words} words${ready[0].scan.partial ? ` (first ${ready[0].scan.ran} of ${ready[0].scan.total} pages — the rest is read after upload)` : ''}${ready[0].scan.confidence != null ? ` · ${ready[0].scan.confidence}% confidence` : ''}.</div>` : '';
      const filled = [t.title && m.$('#uTitle')?.dataset.toto ? 'title' : '', m.$('#uCt')?.dataset.toto ? 'content type' : '', (t.terms || []).some((x) => x.auto) ? 'tags' : '',
        m.$('#uKw')?.dataset.toto ? 'keywords' : '', m.$$('#uFields [data-toto="1"]').length ? 'properties' : ''].filter(Boolean);
      const more = (t.terms || []).filter((x) => !x.auto && !tagSel.has(x.id) && !(props?.pickers && Object.values(props.pickers).some((p) => p.get().includes(x.id))));
      html += `<div class="toto-box"><div class="toto-h">${totoMark()}<b>Toto read the file</b><span class="faint small">${filled.length ? 'and filled in the ' + filled.join(', ') + ' — check them before you upload.' : t.has_text ? 'There was nothing it could fill in with confidence.' : ready[0].scan?.state === 'reading' ? 'It is a scan, so Toto is reading its text first — suggestions follow in a moment. You can upload now if you prefer; the text is then read afterwards.' : ready[0].scan?.state === 'failed' ? 'It is a scan and its text could not be read here; it will be read again after upload.' : 'No readable text was found, even after reading the scan.'}</span></div>
        ${scanNote}
        ${t.doc_number && libObj().level >= 4 && !m.$('#uNo').value ? `<div class="small">The file is numbered <b class="mono">${esc(t.doc_number)}</b>${t.revision ? `, revision <b>${esc(t.revision)}</b>` : ''}. <button class="linklike" type="button" data-usenum>Use this number</button></div>` : ''}
        ${more.length ? `<div class="small muted" style="margin-top:6px">More tags it noticed:</div><div class="chips" style="margin-top:4px">${more.map((x) => `<button class="chip add" type="button" data-sg="${x.id}" title="${esc(x.why)}">${icon('plus', 'sm')}${esc(x.label)} <span class="faint">· ${esc(x.termset)}</span></button>`).join('')}</div>` : ''}
        ${t.similar?.length ? `<div class="small muted" style="margin-top:8px">Similar documents already here: ${t.similar.map((d) => `<a href="#/doc/${d.id}" target="_blank">${esc(d.title)}</a> <span class="faint">(${d.match}%)</span>`).join(', ')}</div>` : ''}</div>`;
    } else {
      const flagged = ready.filter((q) => sensFor(q));
      html += `<div class="toto-box"><div class="toto-h">${totoMark()}<b>Toto read ${plural(ready.length, 'file')}</b></div>
        <label class="check"><input type="checkbox" id="uTotoApply" checked><span>Give each file the tags and content type Toto suggests for it <span class="faint small">(only where it is confident; your choices above still apply to every file)</span></span></label>
        ${flagged.length ? `<label class="check" style="margin-top:6px"><input type="checkbox" id="uTotoRaise" checked><span><b>Raise ${plural(flagged.length, 'file')} to the classification Toto suggests</b> <span class="faint small">— ${flagged.map((q) => `${esc(q.file.name)} → ${esc(CONF_NAME[q.toto.sensitive.level])}`).join(', ')}</span></span></label>` : ''}</div>`;
    }
    host.innerHTML = html;
  };

  /* ---- staging: Toto reads each file once; the upload then refers to it ---- */
  const unstage = (items) => { const tokens = items.map((q) => q.token).filter(Boolean); if (tokens.length) api('docs.unstage', { tokens }).catch(() => {}); items.forEach((q) => { q.token = null; }); };
  const analyze = async (q) => {
    q.state = 'analyzing'; q.progress = 0; drawQueue();
    const fd = new FormData();
    fd.append('file', q.file); fd.append('library_id', lib); if (folder) fd.append('folder_id', folder);
    try {
      const r = await xhrUpload(fd, (p) => { q.progress = p; drawQueue(); }, 'docs.analyze');
      if (!queue.includes(q)) { unstage([{ token: r.token }]); return; }
      q.token = r.token; q.toto = r.toto || null; q.exact = r.exact_duplicates || []; q.needsOcr = r.needs_ocr;
      q.state = ''; drawQueue();
      if (single()) applyToto(q); else drawTags();
      drawToto();
      if (r.needs_ocr && OCR_EXT.includes(q.file.name.split('.').pop().toLowerCase())) readScan(q);
    } catch (e) {
      q.state = ''; q.toto = null; q.token = null; drawQueue();   // fall back to a plain upload
      toast(`Toto couldn't read ${q.file.name}: ${e.message}`, 'err');
    }
  };

  /* ---- scans: read the text in this browser (the same engine as everywhere else), then let Toto look again ---- */
  let scanChain = Promise.resolve(), scanTimer = null;
  const readScan = (q) => {
    q.scan = { state: 'reading', page: 0, pages: 0, pageProgress: 0 };
    drawQueue(); drawToto();
    if (!scanTimer) scanTimer = setInterval(() => { if (queue.some((x) => x.scan?.state === 'reading')) drawQueue(); else { clearInterval(scanTimer); scanTimer = null; } }, 500);
    scanChain = scanChain.then(async () => {
      if (!queue.includes(q) || !q.token || q.state) { q.scan.state = 'skipped'; return; }   // removed or already uploaded
      try {
        const ext = q.file.name.split('.').pop().toLowerCase();
        const r = await recogniseFile(q.file, ext, q.scan, { maxPages: 12 });
        OCRQ.current = null;
        if (!q.token || q.state || q.scan.cancelled) { q.scan.state = 'skipped'; return; }
        const partial = r.partial ? '1' : '0';
        const res = await api('docs.stage_text', { token: q.token, text: r.text.slice(0, 400000), pages: r.pages, ocr_pages_run: r.ranPages, confidence: r.confidence, partial });
        Object.assign(q.scan, { state: 'done', words: res.words, partial: r.partial, ran: Math.min(r.pages, 12), total: r.pages, confidence: r.ranPages ? r.confidence : null, full: res.full });
        if (res.toto) {
          q.toto = Object.assign({}, res.toto);
          if (single()) applyToto(q); else drawTags();
        }
      } catch (e) {
        OCRQ.current = null;
        q.scan.state = /expired/i.test(e.message) ? 'skipped' : 'failed';
      }
      drawQueue(); drawToto();
    });
  };

  const suggest = async () => {   // without Toto: suggestions from the file name, title and keywords only
    if (toto || doc || !queue.length || !props) return;
    const text = queue.map((q) => q.file.name.replace(/[_.-]+/g, ' ')).join(' ') + ' ' + (m.$('#uTitle')?.value || '') + ' ' + (m.$('#uDesc')?.value || '') + ' ' + (m.$('#uKw')?.value || '');
    const r = await api('docs.suggest', undefined, { query: { text } });
    const usable = r.suggest.filter((s) => fieldsForType(m.$('#uCt').value).some((f) => f.type === 'term' && f.termset_id === s.termset_id));
    m.$('#uSuggest').innerHTML = usable.length ? `<div class="alert teal">${icon('sparkle')}<div class="grow"><b>Suggested tags</b><div class="chips" style="margin-top:6px">${usable.map((s) => `<button class="chip add" data-sg="${s.id}" type="button">${icon('plus', 'sm')}${esc(s.label)} <span class="faint">· ${esc(s.termset)}</span></button>`).join('')}</div></div></div>` : '';
  };
  const addFiles = (list) => {
    const wasSingle = single();
    const added = [];
    for (const f of list) {
      const ext = f.name.split('.').pop().toLowerCase();
      if (S.settings.allowed_ext?.length && !S.settings.allowed_ext.includes(ext)) { toast(`.${ext} files aren't allowed here.`, 'err'); continue; }
      if (f.size > S.settings.max_upload_mb * 1048576) { toast(`${f.name} is larger than ${S.settings.max_upload_mb} MB.`, 'err'); continue; }
      if (doc) queue.length = 0;
      if (!queue.some((q) => q.file.name === f.name && q.file.size === f.size)) { const q = { file: f, state: '', progress: 0 }; queue.push(q); added.push(q); }
    }
    if (wasSingle && queue.length > 1) clearFills();
    drawQueue(); checkNames(); suggest();
    if (toto) added.forEach(analyze);
  };
  const drawProps = () => {
    if (doc) return;
    const keep = props ? props.collect() : {};
    props = renderFieldInputs(m.$('#uFields'), fieldsForType(m.$('#uCt').value));
    if (single()) { const q = queue[0]; if (q?.toto) { applyFieldHints(q.toto); applyTerms(q.toto); } }
    void keep; drawTags(); suggest();
  };
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
  m.$('#uQueue').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rmq]'); if (b) { const [q] = queue.splice(+b.dataset.rmq, 1); if (q.scan) q.scan.cancelled = true; unstage([q]); drawQueue(); if (single() && queue[0]?.toto) applyToto(queue[0]); drawTags(); drawToto(); return; }
    const av = e.target.closest('[data-asver]'); if (av) { const q = queue[+av.dataset.asver]; const nd = q.toto.near_duplicates[0]; q.asVersionOf = { id: nd.id, title: nd.title }; if (queue.length === 1) clearFills(); drawQueue(); drawToto(); return; }
    const nv = e.target.closest('[data-novers]'); if (nv) { queue[+nv.dataset.novers].asVersionOf = null; drawQueue(); if (single()) applyToto(queue[0]); drawToto(); }
  });
  const host = m.$('.modal-b');
  host.addEventListener('click', (e) => {
    const sg = e.target.closest('[data-sg]'); if (sg) { const id = +sg.dataset.sg; if (!props?.addTerm(id)) { tagSel.add(id); drawTags(); } sg.remove(); drawToto(); return; }
    const tg = e.target.closest('[data-tag]'); if (tg) { const id = +tg.dataset.tag; tagSel.has(id) ? tagSel.delete(id) : tagSel.add(id); drawTags(); return; }
    const sn = e.target.closest('[data-sens]'); if (sn) {
      const sens = sensFor(queue[0]); sensChoice = sn.dataset.sens;
      if (sensChoice === 'raise' && sens) { m.$('#uConf').value = sens.level; m.$('#uConf').dispatchEvent(new Event('change')); markFilled(m.$('#uConf')); }
      drawToto(); return;
    }
    if (e.target.closest('[data-usenum]')) { const q = queue[0]; m.$('#uNo').value = q.toto.doc_number; markFilled(m.$('#uNo')); drawToto(); }
  });
  host.addEventListener('input', (e) => { if (e.target.dataset?.toto) { delete e.target.dataset.toto; markFilled(e.target, false); } });
  m.$('#uLib')?.addEventListener('change', (e) => { lib = +e.target.value; folder = null; drawModes(); fillFolders(); if (!(libObj().level >= 4)) { m.$('#uNoWrap').classList.add('hidden'); m.$('#uNo').value = ''; } drawToto(); });
  m.$('#uFolder')?.addEventListener('change', (e) => { folder = +e.target.value || null; checkNames(); });
  m.$('#uCt')?.addEventListener('change', (e) => { if (e.isTrusted) { ctTouched = true; delete e.target.dataset.toto; markFilled(e.target, false); } drawProps(); ctDefaults(); drawToto(); });
  m.$('#uConf')?.addEventListener('change', (e) => { const h = m.$('#uConfHint'); h.textContent = CONF_HELP[e.target.value]; h.classList.toggle('warn', isSensitive(e.target.value)); if (e.isTrusted) markFilled(e.target, false); drawQueue(); drawToto(); });
  m.$('#uTitle')?.addEventListener('input', debounce(suggest, 400));
  m.$('#uKw')?.addEventListener('input', debounce(suggest, 400));

  drawModes(); await fillFolders(); drawProps(); addFiles(files);

  m.$('[data-ok]').onclick = async () => {
    const pending = queue.filter((q) => !q.state);
    if (!pending.length) return;
    if (props) { const miss = props.missing(); if (miss.length) return toast('Fill in: ' + miss.join(', '), 'err'); }
    if (single() && sensFor(queue[0]) && !sensChoice) { m.$('#uSens')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return toast('Toto found sensitive information — choose a classification first.', 'err'); }
    const mode = m.$('input[name=um]:checked')?.value || 'draft';
    const perFile = !!m.$('#uTotoApply')?.checked, raise = !!m.$('#uTotoRaise')?.checked;
    const btn = m.$('[data-ok]'); btn.disabled = true;
    let ok = 0;
    for (const q of pending) {
      const fd = new FormData();
      if (q.token) fd.append('stage_token', q.token); else fd.append('file', q.file);
      fd.append('submit', mode);
      if (doc) { fd.append('document_id', doc.id); fd.append('comment', m.$('#uComment').value); }
      else if (q.asVersionOf) { fd.append('document_id', q.asVersionOf.id); fd.append('comment', 'New version — Toto found it was nearly the same document'); }
      else {
        const t = q.toto;
        let ct = m.$('#uCt').value, conf = m.$('#uConf').value, kw = m.$('#uKw').value;
        const tags = new Set(single() ? tagSel : []);
        if (!single() && t && perFile) {
          if (!ct && t.content_type?.auto) ct = t.content_type.id;
          (t.terms || []).filter((x) => x.auto).forEach((x) => tags.add(x.id));
          if (!kw && t.keywords?.length) kw = t.keywords.join(', ');
        }
        if (!single() && raise && sensFor(q)) conf = q.toto.sensitive.level;
        fd.append('library_id', lib); if (folder) fd.append('folder_id', folder);
        fd.append('content_type_id', ct); fd.append('confidentiality', conf); fd.append('review_date', m.$('#uReview').value);
        fd.append('description', m.$('#uDesc').value); fd.append('keywords', kw);
        if (single() && m.$('#uTitle').value.trim()) fd.append('title', m.$('#uTitle').value.trim());
        else if (!single() && t?.title && perFile) fd.append('title', t.title);
        if (single() && m.$('#uNo')?.value.trim()) fd.append('doc_number', m.$('#uNo').value.trim());
        fd.append('meta', JSON.stringify(props && ct === m.$('#uCt').value ? props.collect() : {}));
        if (tags.size) fd.append('tags', [...tags].join(','));
        if (q.existing) fd.append('comment', 'New upload with the same file name');
      }
      if (q.scan?.state === 'reading') q.scan.cancelled = true;   // uploading now: the text is read in the background afterwards
      q.state = 'uploading'; drawQueue();
      try {
        const r = await xhrUpload(fd, (p) => { q.progress = p; drawQueue(); });
        q.state = 'done'; q.id = r.id; q.token = null; ok++;
        const verb = r.status === 'published' ? 'published' : r.status === 'pending' ? 'sent for approval' : 'saved as draft';
        q.msg = (r.versioned ? `Version ${r.version} of “${r.title}”` : `Version ${r.version}`) + ' · ' + verb + (r.indexed ? ' · text indexed' : '');
        if (r.needs_ocr && ocrEnqueue({ docId: r.id, versionId: r.version_id, title: r.title, ext: r.ext, file: q.file })) q.msg += ' · scan detected — reading its text in the background';
        if (r.duplicates?.length) { q.msg += ` · Same file also in: ${r.duplicates.map((d) => d.title).join(', ')}`; }
      } catch (e) { q.state = 'error'; q.msg = e.message; if (/expired/i.test(e.message)) q.token = null; }
      drawQueue();
    }
    m.$('#uToto') && (m.$('#uToto').innerHTML = '');
    btn.disabled = false;
    if (ok) { onDone && onDone(); refreshCounts(); loadLibs(true).then(renderSideLibs); }
    if (ok === pending.length) {
      finished = true;
      toast(ok === 1 ? 'Uploaded.' : `${ok} files uploaded.`);
      if (doc || ok === 1) { m.close(); const id = queue.find((q) => q.id)?.id; if (doc || !onDone) go('#/doc/' + id); }
      else { btn.textContent = 'Done'; btn.disabled = false; btn.onclick = () => m.close(); }
    }
  };
}

function xhrUpload(fd, onProgress, route = 'docs.upload') {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', 'api.php?r=' + route);
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
