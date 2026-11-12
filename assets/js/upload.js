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
      if (q.state === 'done') { st = q.msg; cls = 'ok'; }
      else if (q.state === 'error') { st = q.msg; cls = 'err'; }
      else if (q.state === 'uploading') st = 'Uploading… ' + Math.round(q.progress) + '%';
      else if (q.existing) { st = `Same name exists — will become a new version of “${q.existing.title}” (now ${q.existing.version})${q.existing.locked ? ' · checked out' : ''}`; cls = 'v'; }
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
