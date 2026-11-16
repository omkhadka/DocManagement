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
