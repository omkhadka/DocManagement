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
