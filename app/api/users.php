<?php
declare(strict_types=1);

const ROLES = ['admin', 'head', 'member', 'viewer'];

/** Everyone can see the staff directory (used by pickers and @mentions). */
function api_users_directory() {
    me();
    $people = all('SELECT u.id, u.name, u.email, u.role, u.job_title, u.phone, u.department_id, d.name AS department, d.color AS department_color
        FROM users u LEFT JOIN departments d ON d.id=u.department_id WHERE u.active=1 ORDER BY u.name');
    foreach ($people as &$p) { $p['id'] = (int)$p['id']; $p['department_id'] = $p['department_id'] ? (int)$p['department_id'] : null; }
    $depts = all('SELECT id, name, code, color FROM departments ORDER BY name');
    foreach ($depts as &$d) $d['id'] = (int)$d['id'];
    $groups = all('SELECT id, name FROM user_groups ORDER BY name');
    foreach ($groups as &$g) $g['id'] = (int)$g['id'];
    return ['people' => $people, 'departments' => $depts, 'groups' => $groups];
}

function api_users_profile() {
    $u = me();
    $id = iarg('id');
    $p = one('SELECT u.id, u.name, u.email, u.role, u.job_title, u.phone, u.last_login, u.created_at, d.name AS department, d.color AS department_color
        FROM users u LEFT JOIN departments d ON d.id=u.department_id WHERE u.id=?', [$id]);
    if (!$p) fail('Person not found.', 404);
    $docs = array_slice(visible_doc_rows('d.owner_id=?', [$id], 'd.updated_at DESC', 200), 0, 12);
    $stats = ['uploads' => (int)val('SELECT COUNT(*) FROM documents WHERE owner_id=? AND deleted_at IS NULL', [$id]),
        'approvals' => (int)val("SELECT COUNT(*) FROM approvals WHERE decided_by=? AND decision='approved'", [$id]),
        'comments' => (int)val('SELECT COUNT(*) FROM comments WHERE user_id=?', [$id])];
    if (!is_admin($u) && $u['id'] !== (int)$id) unset($p['last_login']);
    return ['person' => $p, 'docs' => $docs, 'stats' => $stats];
}

function api_users_list() {
    require_admin();
    $rows = all('SELECT u.id, u.name, u.email, u.role, u.job_title, u.phone, u.department_id, u.active, u.last_login, u.created_at, u.locked_until, u.mfa_enabled, u.mfa_enabled_at,
        d.name AS department, (SELECT COUNT(*) FROM documents x WHERE x.owner_id=u.id AND x.deleted_at IS NULL) AS docs
        FROM users u LEFT JOIN departments d ON d.id=u.department_id ORDER BY u.active DESC, u.name');
    $gm = [];
    foreach (all('SELECT gm.user_id, g.id, g.name FROM group_members gm JOIN user_groups g ON g.id=gm.group_id') as $r) $gm[(int)$r['user_id']][] = ['id' => (int)$r['id'], 'name' => $r['name']];
    foreach ($rows as &$r) { $r['id'] = (int)$r['id']; $r['active'] = (int)$r['active']; $r['mfa_enabled'] = (int)$r['mfa_enabled']; $r['mfa_required'] = mfa_required_for_role($r['role']); $r['docs'] = (int)$r['docs']; $r['groups'] = $gm[$r['id']] ?? []; }
    return ['users' => $rows, 'mfa_policy' => mfa_policy()];
}

function api_users_save() {
    must_post();
    $admin = require_admin();
    $id = iarg('id');
    $email = strtolower(sarg('email', '', 190));
    $data = ['name' => sarg('name', '', 120), 'email' => $email, 'role' => in_array(sarg('role'), ROLES, true) ? sarg('role') : 'member',
        'department_id' => iarg('department_id') ?: null, 'job_title' => sarg('job_title', '', 120), 'phone' => sarg('phone', '', 40), 'active' => arg('active', 1) ? 1 : 0];
    if ($data['name'] === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) fail('Enter a name and a valid email.');
    if (val('SELECT id FROM users WHERE email=? AND id<>?', [$email, $id])) fail('Another person already uses this email.');
    if ($id === $admin['id'] && ($data['role'] !== 'admin' || !$data['active'])) fail("You can't remove your own administrator access.");
    $pw = (string)arg('password', '');
    $temp = null;
    if ($id) {
        $pwSet = false;
        if ($pw !== '') {
            if (strlen($pw) < 8) fail('Passwords need at least 8 characters.');
            $hash = (string)val('SELECT password_hash FROM users WHERE id=?', [$id]);
            if (!password_verify($pw, $hash)) {        // ignore a browser re-filling the same password
                $data['password_hash'] = password_hash($pw, PASSWORD_DEFAULT);
                if ($id !== $admin['id']) $data['must_change_pw'] = 1; // your own password is yours: no forced change
                $pwSet = true;
            }
        }
        update('users', $data, 'id=?', [$id]);
        audit('user_update', 'user', $id, $data['name'] . ' · ' . $data['role'] . ($data['active'] ? '' : ' · deactivated') . ($pwSet ? ' · password set by admin' : ''));
    } else {
        if ($pw === '') { $temp = substr(strtr(base64_encode(random_bytes(9)), '+/', 'Kx'), 0, 12); $pw = $temp; }
        if (strlen($pw) < 8) fail('Passwords need at least 8 characters.');
        $id = insert('users', $data + ['password_hash' => password_hash($pw, PASSWORD_DEFAULT), 'must_change_pw' => 1]);
        audit('user_create', 'user', $id, $data['name'] . ' · ' . $data['role']);
        notify([$id], 'welcome', 'Welcome to ' . setting('site_name', 'the Knowledge Hub'), 'Your account was created by ' . $admin['name'] . '.', '#/');
    }
    if (is_array(arg('groups'))) {
        q('DELETE FROM group_members WHERE user_id=?', [$id]);
        foreach (array_unique(array_map('intval', arg('groups'))) as $g) if ($g) insert('group_members', ['group_id' => $g, 'user_id' => $id]);
    }
    if (arg('unlock')) update('users', ['failed_logins' => 0, 'locked_until' => null], 'id=?', [$id]);
    return ['id' => $id, 'temp_password' => $temp];
}

function api_users_reset_password() {
    must_post();
    require_admin();
    $id = iarg('id');
    if (!val('SELECT id FROM users WHERE id=?', [$id])) fail('Person not found.');
    $temp = substr(strtr(base64_encode(random_bytes(9)), '+/', 'Kx'), 0, 12);
    update('users', ['password_hash' => password_hash($temp, PASSWORD_DEFAULT), 'must_change_pw' => 1, 'failed_logins' => 0, 'locked_until' => null], 'id=?', [$id]);
    audit('password_reset', 'user', $id);
    return ['temp_password' => $temp];
}

/** CSV columns: name, email, department code or name, role, job title */
function api_users_import() {
    must_post();
    require_admin();
    $csv = (string)arg('csv', '');
    $lines = array_filter(array_map('trim', preg_split('/\r?\n/', $csv)));
    $depts = [];
    foreach (all('SELECT id, name, code FROM departments') as $d) { $depts[strtolower($d['code'])] = (int)$d['id']; $depts[strtolower($d['name'])] = (int)$d['id']; }
    $created = []; $skipped = [];
    foreach ($lines as $i => $line) {
        $c = str_getcsv($line);
        if ($i === 0 && stripos($line, 'email') !== false) continue;
        [$name, $email, $dept, $role, $title] = array_pad(array_map('trim', $c), 5, '');
        $email = strtolower($email);
        if (!$name || !filter_var($email, FILTER_VALIDATE_EMAIL)) { $skipped[] = "Line " . ($i + 1) . ': missing name or email'; continue; }
        if (val('SELECT id FROM users WHERE email=?', [$email])) { $skipped[] = "$email already exists"; continue; }
        $temp = substr(strtr(base64_encode(random_bytes(9)), '+/', 'Kx'), 0, 12);
        $id = insert('users', ['name' => $name, 'email' => $email, 'department_id' => $depts[strtolower($dept)] ?? null,
            'role' => in_array(strtolower($role), ROLES, true) ? strtolower($role) : 'member', 'job_title' => $title,
            'password_hash' => password_hash($temp, PASSWORD_DEFAULT), 'must_change_pw' => 1]);
        $created[] = ['name' => $name, 'email' => $email, 'temp_password' => $temp];
        audit('user_create', 'user', $id, "$name (import)");
    }
    return ['created' => $created, 'skipped' => $skipped];
}

/* ---------- Departments ---------- */
function api_users_departments() {
    me();
    $rows = all('SELECT d.*, (SELECT COUNT(*) FROM users u WHERE u.department_id=d.id AND u.active=1) AS people,
        (SELECT GROUP_CONCAT(u.name ORDER BY u.name SEPARATOR \', \') FROM users u WHERE u.department_id=d.id AND u.role=\'head\' AND u.active=1) AS heads
        FROM departments d ORDER BY d.name');
    foreach ($rows as &$r) { $r['id'] = (int)$r['id']; $r['people'] = (int)$r['people']; }
    return ['departments' => $rows];
}
function api_users_department_save() {
    must_post(); require_admin();
    $id = iarg('id');
    $data = ['name' => sarg('name', '', 120), 'code' => strtoupper(preg_replace('/[^A-Za-z0-9]/', '', sarg('code', '', 16))), 'description' => sarg('description', '', 255),
        'color' => preg_match('/^#[0-9a-fA-F]{6}$/', sarg('color')) ? sarg('color') : '#0F7C7A'];
    if ($data['name'] === '' || $data['code'] === '') fail('A department needs a name and a code.');
    if (val('SELECT id FROM departments WHERE code=? AND id<>?', [$data['code'], $id])) fail('That code is already used.');
    if ($id) update('departments', $data, 'id=?', [$id]); else $id = insert('departments', $data);
    audit('department_save', 'department', $id, $data['name']);
    return ['id' => $id];
}
function api_users_department_delete() {
    must_post(); require_admin();
    $id = iarg('id');
    if ((int)val('SELECT COUNT(*) FROM users WHERE department_id=? AND active=1', [$id])) fail('Move the people in this department to another one first.');
    q("DELETE FROM permissions WHERE principal_type='department' AND principal_id=?", [(string)$id]);
    q('UPDATE libraries SET department_id=NULL WHERE department_id=?', [$id]);
    q('UPDATE users SET department_id=NULL WHERE department_id=?', [$id]);
    q('DELETE FROM departments WHERE id=?', [$id]);
    audit('department_delete', 'department', $id);
    return [];
}

/* ---------- Groups ---------- */
function api_users_groups() {
    me();
    $rows = all('SELECT * FROM user_groups ORDER BY name');
    $mem = [];
    foreach (all('SELECT gm.group_id, u.id, u.name FROM group_members gm JOIN users u ON u.id=gm.user_id WHERE u.active=1 ORDER BY u.name') as $m) $mem[(int)$m['group_id']][] = ['id' => (int)$m['id'], 'name' => $m['name']];
    foreach ($rows as &$r) { $r['id'] = (int)$r['id']; $r['members'] = $mem[$r['id']] ?? []; }
    return ['groups' => $rows];
}
function api_users_group_save() {
    must_post(); require_admin();
    $id = iarg('id');
    $data = ['name' => sarg('name', '', 120), 'description' => sarg('description', '', 255)];
    if ($data['name'] === '') fail('Give the group a name.');
    if ($id) update('user_groups', $data, 'id=?', [$id]); else $id = insert('user_groups', $data);
    if (is_array(arg('members'))) {
        q('DELETE FROM group_members WHERE group_id=?', [$id]);
        foreach (array_unique(array_map('intval', arg('members'))) as $m) if ($m) insert('group_members', ['group_id' => $id, 'user_id' => $m]);
    }
    audit('group_save', 'group', $id, $data['name']);
    return ['id' => $id];
}
function api_users_group_delete() {
    must_post(); require_admin();
    $id = iarg('id');
    q("DELETE FROM permissions WHERE principal_type='group' AND principal_id=?", [(string)$id]);
    q('DELETE FROM group_members WHERE group_id=?', [$id]);
    q('DELETE FROM user_groups WHERE id=?', [$id]);
    audit('group_delete', 'group', $id);
    return [];
}

/** Where does this person have access? (admin) */
function api_users_access_report() {
    require_admin();
    $id = iarg('id');
    $row = one('SELECT id, role, department_id FROM users WHERE id=?', [$id]);
    if (!$row) fail('Person not found.');
    $t = ['id' => (int)$row['id'], 'role' => $row['role'], 'department_id' => $row['department_id'] !== null ? (int)$row['department_id'] : null,
        'groups' => array_map('intval', array_column(all('SELECT group_id FROM group_members WHERE user_id=?', [$id]), 'group_id'))];
    $ctx = perm_ctx($t);
    $out = [];
    foreach (all('SELECT id, name, color FROM libraries WHERE deleted_at IS NULL ORDER BY name') as $l) {
        $lv = $ctx['lib'][(int)$l['id']] ?? 0;
        $uniq = [];
        foreach ($ctx['folderInfo'] as $fid => $f) {
            if ((int)$f['library_id'] !== (int)$l['id'] || (int)$f['inherit']) continue;
            $uniq[] = ['id' => $fid, 'name' => (string)val('SELECT name FROM folders WHERE id=?', [$fid]), 'level' => $ctx['folder'][$fid] ?? 0];
        }
        $out[] = ['id' => (int)$l['id'], 'name' => $l['name'], 'color' => $l['color'], 'level' => $lv, 'level_name' => LEVEL_NAMES[$lv], 'unique_folders' => $uniq];
    }
    return ['libraries' => $out];
}

/** Lost phone: switch off a person's two-step verification so they can set it up again. */
function api_users_mfa_reset() {
    must_post();
    $a = require_admin();
    $id = iarg('id');
    $u = one('SELECT id, name, role FROM users WHERE id=?', [$id]);
    if (!$u) fail('Person not found.', 404);
    mfa_clear($id);
    update('users', ['failed_logins' => 0, 'locked_until' => null], 'id=?', [$id]);
    audit('mfa_reset', 'user', $id, $u['name']);
    notify([$id], 'security', 'Your two-step verification was reset', $a['name'] . ' reset it.' . (mfa_required_for_role($u['role']) ? ' You will set it up again at your next sign-in.' : ''), '#/profile');
    return ['message' => mfa_required_for_role($u['role']) ? "Reset. {$u['name']} will scan a new QR code at the next sign-in." : "Reset. Two-step verification is now off for {$u['name']}."];
}
