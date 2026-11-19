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
        <div class="field"><label>Site address</label><input class="input" data-k="base_url" value="${esc(s.base_url)}" placeholder="https://km.taifagaskenya.co.ke"><span class="hint">Used for links in notification emails and for opening documents in Word, Excel and PowerPoint.</span></div></div></div>
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
      <div class="panel toto-panel"><div class="panel-h"><h3>${totoMark()}Toto — document assistant</h3><span class="faint small" id="totoStat"></span></div><div class="panel-b" style="display:grid;gap:14px">
        <label class="check"><input type="checkbox" data-k="ai_enabled" ${s.ai_enabled !== '0' ? 'checked' : ''}><span><b>Let Toto read uploads and suggest properties</b><br><span class="small muted">Suggests tags, content type, title, number and date; warns about salary, ID, bank and other personal data; spots near-copies; writes key points and finds similar documents. It runs entirely on this server — no paid service, and nothing is sent outside.</span></span></label>
        <label class="check"><input type="checkbox" data-k="ai_voice_input" ${s.ai_voice_input !== '0' ? 'checked' : ''}><span><b>Let people talk to Toto with the microphone</b><br><span class="small muted">Toto’s own voice is made by the browser on the computer. Turning speech into text is done by the browser’s speech service — in Chrome that is Google’s and in Edge Microsoft’s — so only the spoken question leaves the computer, never documents. Switch this off if even that is not allowed.</span></span></label>
        <div class="field"><label>Toto’s creator</label><input class="input" data-k="ai_creator" value="${esc(s.ai_creator || 'Om Khadka')}"><span class="hint">Toto tells everyone who asks that this person programmed the platform and him.</span></div>
        <div id="totoIdx" class="small muted"></div>
        <div><div class="label" style="margin-bottom:6px">What Toto has been taught</div><div id="totoFacts" class="small muted">Administrators teach Toto in Ask Toto: “remember that the site office opens at 7 am”.</div></div>
        <div class="btn-row"><button class="btn sm" id="totoRebuild">${icon('sparkle', 'sm')}Rebuild Toto's index</button><span class="small faint" id="totoProg"></span></div></div></div>
      <div class="panel"><div class="panel-h"><h3>${icon('edit')}Editing in Word, Excel &amp; PowerPoint</h3></div><div class="panel-b" style="display:grid;gap:10px">
        <p class="small muted" style="margin:0">When someone is asked for input on a document, they open it in their own Office app straight from the hub and save it back. That needs the server to let Office’s WebDAV requests through (some hosts block them). Test it here.</p>
        <div class="btn-row"><button class="btn sm" id="davTest">${icon('check', 'sm')}Test Office editing</button></div><div id="davRes" class="small"></div></div></div>
      <div class="panel"><div class="panel-h"><h3>Server</h3></div><div class="panel-b"><dl class="kv">
        <dt>Version</dt><dd>${esc(sv.app_version)}</dd><dt>PHP</dt><dd>${esc(sv.php)}</dd><dt>Database</dt><dd>${esc(sv.mysql)}</dd><dt>Memory</dt><dd>${esc(sv.memory_limit)}</dd>
        <dt>ZIP support</dt><dd>${sv.zip ? 'Yes' : '<span style="color:var(--red)">Missing — enable the zip extension in cPanel → Select PHP Version</span>'}</dd>
        <dt>Storage</dt><dd>${sv.storage_writable ? 'Writable' : '<span style="color:var(--red)">Not writable — check folder permissions</span>'}<div class="mono small" style="word-break:break-all">${esc(sv.storage_path)}</div>${sv.storage_public ? '<div class="small" style="color:var(--amber)">Inside the website folder — protected by .htaccess, but safer outside public_html.</div>' : '<div class="small muted">Outside the website folder — files can only be reached through the platform.</div>'}</dd></dl></div></div>
    </div>`;
  const totoStatus = async () => {
    const t = await api('admin.ai_status');
    $('#totoStat').textContent = t.on ? 'On' : 'Off';
    $('#totoIdx').innerHTML = `${t.indexed} of ${t.total} documents read${t.indexed && t.up_to_date < t.indexed ? ` (${t.indexed - t.up_to_date} out of date)` : ''} · key points for ${t.summaries}`
      + (t.flagged ? ` · <b style="color:var(--amber)">${plural(t.flagged, 'document looks', 'documents look')} more sensitive than its classification</b>` : '')
      + (t.needs_rebuild ? '<br><b>Rebuild the index once</b> so Toto knows the documents uploaded before it was added.' : t.last_rebuild ? `<br>Last rebuilt ${esc(fmtDate(t.last_rebuild, true))}.` : '');
    $('#totoRebuild').disabled = !t.on;
  };
  totoStatus();
  const totoFacts = async () => {
    const { facts } = await api('admin.ai_facts');
    if (facts.length) $('#totoFacts').innerHTML = `<ul class="toto-facts">${facts.map((f) => `<li><span>${esc(f.fact)}<span class="faint"> — ${esc(f.name || '')}, ${esc(fmtDate(f.created_at))}</span></span><button class="mini-btn" data-fact="${f.id}" title="Make Toto forget this">${icon('x', 'sm')}</button></li>`).join('')}</ul>`;
  };
  totoFacts();
  $('#totoFacts').addEventListener('click', async (e) => { const b = e.target.closest('[data-fact]'); if (!b) return; await run(api('admin.ai_fact_delete', { id: +b.dataset.fact }), 'Toto forgot it.'); totoFacts(); });
  $('#totoRebuild').onclick = async () => {
    const b = $('#totoRebuild'); b.disabled = true;
    let after = 0, done = 0;
    try {
      for (;;) {
        const r = await api('admin.ai_rebuild', { after });
        done += r.done; $('#totoProg').textContent = `Reading… ${done} done, ${r.left} to go`;
        if (!r.left) break; after = r.next;
      }
      $('#totoProg').textContent = `Finished — ${done} documents read.`; toast('Toto has read every document.');
    } catch (e) { toast(e.message, 'err'); }
    b.disabled = false; totoStatus();
  };
  $('#davTest').onclick = async () => {
    const out = $('#davRes'); out.innerHTML = 'Testing…';
    const rows = [];
    for (const m of ['OPTIONS', 'PROPFIND', 'LOCK', 'PUT', 'UNLOCK']) {
      let ok = false, why = '';
      try {
        const res = await fetch('dav/selftest/test.docx', { method: m, body: ['PUT', 'LOCK', 'PROPFIND'].includes(m) ? 'test' : undefined, credentials: 'omit', cache: 'no-store' });
        ok = res.headers.get('X-KM-Dav') === 'ok'; why = ok ? '' : `the server answered ${res.status}`;
      } catch (e) { why = 'blocked'; }
      rows.push(`<div>${ok ? '✅' : '❌'} <b>${m}</b>${why ? ' — ' + esc(why) : ''}</div>`);
    }
    const allOk = !rows.some((x) => x.includes('❌'));
    out.innerHTML = rows.join('') + (allOk ? '<p style="color:var(--green,#2E7D32)"><b>All good.</b> Word, Excel and PowerPoint can open and save documents from this server.</p>'
      : '<p style="color:var(--red)"><b>Your host blocks some of these.</b> Ask hosting support to allow the WebDAV methods PROPFIND, LOCK, UNLOCK and PUT for the <code>/dav/</code> folder of this site (usually a ModSecurity rule). Until then people can still use “Download → edit → upload your copy”.</p>');
  };
  $('#sSave').onclick = async () => {
    const out = {};
    $$('[data-k]', page).forEach((el) => { out[el.dataset.k] = el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value; });
    const flowChanged = (out.approval_workflow === '1') !== !!S.settings.approvals;
    if (flowChanged && out.approval_workflow !== '1' && !await confirmBox('Switch off approvals? Every document still waiting for approval will be published now.', { ok: 'Switch off' })) return;
    await run(api('admin.settings_save', out), 'Settings saved.');
    Object.assign(S.settings, { site_name: out.site_name, org_name: out.org_name, welcome_text: out.welcome_text });
    const totoChanged = (out.ai_enabled === '1') !== !!S.settings.ai;
    if (flowChanged || totoChanged) location.reload();
  };
});
