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
        <span class="faint"> · Your access: ${LEVELS[folderLevel]}${+lib.approval_required ? ' · Publishing needs a department head’s approval' : ''}</span></p></div>
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
      ${canContribute() ? `<button class="btn sm" data-bulk="move">${icon('move', 'sm')}Move</button><button class="btn sm" data-bulk="delete">${icon('trash', 'sm')}Delete</button>` : ''}
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
  const last = approvals.find((x) => x.decision === 'approved');
  const statusTxt = { published: 'Approved for use', pending: 'Awaiting approval', rejected: 'Returned for changes', draft: 'Draft — not for use' }[d.status] || d.status;
  return `<div class="titleblock">
    <div class="tb-num"><small>Document number</small><div class="v mono">${esc(d.doc_number || '—')}</div></div>
    <div class="tb-rev"><small>Rev</small>${revDelta(d.version, 'big')}</div>
    <div class="tb-stamp nr">${docStamp(d, approvals, { size: opts.size || 104, press: !!opts.press })}</div>
    <div><small>Type</small><div class="v">${esc(d.content_type || 'General document')}</div></div>
    <div><small>Class</small><div class="v">${esc(d.confidentiality.charAt(0).toUpperCase() + d.confidentiality.slice(1))}</div></div>
    <div><small>Author</small><div class="v">${esc(d.owner)}</div></div>
    <div><small>Date</small><div class="v">${esc(parseDate(d.modified)?.toLocaleDateString('en-GB') || '')}</div></div>
    <div class="nb"><small>Library</small><div class="v">${esc(d.library)}</div></div>
    <div class="nb"><small>Approved by</small><div class="v">${esc(last?.decider || '—')}</div></div>
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
      <div class="field"><label>Who can approve?</label><select class="input" id="lMode"><option value="any_head">Any department head with read access</option><option value="owner_head" ${lib?.approval_mode === 'owner_head' ? 'selected' : ''}>Only heads of the owning department</option></select></div>
    </div>
    <label class="check"><input type="checkbox" id="lAppr" ${!lib || +lib.approval_required ? 'checked' : ''}><span><b>Require approval before publishing</b><br><span class="muted small">Uploads stay as drafts (visible to the author and approvers) until a department head approves them.</span></span></label>`,
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
