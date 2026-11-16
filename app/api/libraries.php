<?php
declare(strict_types=1);

function api_libraries_list() {
    $u = me();
    $ctx = perm_ctx($u);
    $counts = []; $sizes = [];
    foreach (all('SELECT d.library_id, COUNT(*) n, COALESCE(SUM(v.size),0) s FROM documents d LEFT JOIN document_versions v ON v.id=d.current_version_id
        WHERE d.deleted_at IS NULL AND d.published_version_id IS NOT NULL GROUP BY d.library_id') as $r) { $counts[(int)$r['library_id']] = (int)$r['n']; $sizes[(int)$r['library_id']] = (int)$r['s']; }
    $out = [];
    foreach (all('SELECT l.*, d.name AS department FROM libraries l LEFT JOIN departments d ON d.id=l.department_id WHERE l.deleted_at IS NULL ORDER BY l.name') as $l) {
        $lv = $ctx['lib'][(int)$l['id']] ?? 0;
        $all = sarg('all') === '1';
        if ($lv < 1 && !$all) continue;
        $out[] = ['id' => (int)$l['id'], 'name' => $l['name'], 'code' => $l['code'], 'description' => $l['description'], 'icon' => $l['icon'], 'color' => $l['color'],
            'department_id' => $l['department_id'] ? (int)$l['department_id'] : null, 'department' => $l['department'],
            'approval_required' => (int)$l['approval_required'], 'approval_mode' => $l['approval_mode'],
            'level' => $lv, 'count' => $lv < 1 ? 0 : max(0, ($counts[(int)$l['id']] ?? 0) - (hidden_counts($u)['lib'][(int)$l['id']] ?? 0)), 'size' => $lv < 1 ? 0 : ($sizes[(int)$l['id']] ?? 0)];
    }
    return ['libraries' => $out];
}

function folder_tree(int $libId, array $ctx): array {
    $rows = all('SELECT id, parent_id, name, inherit FROM folders WHERE library_id=? AND deleted_at IS NULL ORDER BY name', [$libId]);
    $counts = [];
    foreach (all('SELECT folder_id, COUNT(*) n FROM documents WHERE library_id=? AND deleted_at IS NULL AND folder_id IS NOT NULL AND published_version_id IS NOT NULL GROUP BY folder_id', [$libId]) as $r)
        $counts[(int)$r['folder_id']] = (int)$r['n'];
    $out = [];
    foreach ($rows as $r) {
        $lv = $ctx['folder'][(int)$r['id']] ?? 0;
        if ($lv < 1) continue;
        $out[] = ['id' => (int)$r['id'], 'parent_id' => $r['parent_id'] ? (int)$r['parent_id'] : null, 'name' => $r['name'],
            'inherit' => (int)$r['inherit'], 'level' => $lv, 'count' => max(0, ($counts[(int)$r['id']] ?? 0) - (hidden_counts()['folder'][(int)$r['id']] ?? 0))];
    }
    return $out;
}

function api_libraries_get() {
    $u = me();
    $id = iarg('id');
    $l = one('SELECT l.*, d.name AS department FROM libraries l LEFT JOIN departments d ON d.id=l.department_id WHERE l.id=? AND l.deleted_at IS NULL', [$id]);
    if (!$l) fail('This library does not exist.', 404);
    $ctx = perm_ctx($u);
    $lv = $ctx['lib'][$id] ?? 0;
    $folders = folder_tree($id, $ctx);
    if ($lv < 1 && !$folders) {
        $open = (int)val("SELECT COUNT(*) FROM access_requests WHERE user_id=? AND library_id=? AND status='open'", [$u['id'], $id]);
        return ['denied' => true, 'library' => ['id' => $id, 'name' => $l['name'], 'color' => $l['color'], 'description' => $l['description']], 'requested' => $open > 0];
    }
    $l['id'] = (int)$l['id'];
    $l['level'] = $lv;
    return ['library' => $l, 'folders' => $folders];
}

function api_libraries_save() {
    must_post();
    $u = require_admin();
    $id = iarg('id');
    $code = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', sarg('code', '', 16)));
    $data = ['name' => sarg('name', '', 120), 'code' => $code, 'description' => sarg('description', '', 255), 'icon' => sarg('icon', 'folder', 32),
        'color' => preg_match('/^#[0-9a-fA-F]{6}$/', sarg('color')) ? sarg('color') : '#0F7C7A',
        'department_id' => iarg('department_id') ?: null, 'approval_required' => arg('approval_required') ? 1 : 0,
        'approval_mode' => sarg('approval_mode') === 'owner_head' ? 'owner_head' : 'any_head'];
    if ($data['name'] === '' || $code === '') fail('Give the library a name and a short code.');
    if (val('SELECT id FROM libraries WHERE code=? AND id<>? AND deleted_at IS NULL', [$code, $id])) fail("The code $code is already used by another library.");
    if ($id) { update('libraries', $data, 'id=?', [$id]); audit('library_update', 'library', $id, $data['name']); }
    else {
        $id = insert('libraries', $data + ['created_by' => $u['id']]);
        if ($data['department_id']) insert('permissions', ['scope_type' => 'library', 'scope_id' => $id, 'principal_type' => 'department',
            'principal_id' => (string)$data['department_id'], 'level' => 2, 'created_by' => $u['id']]);
        audit('library_create', 'library', $id, $data['name']);
    }
    return ['id' => $id];
}

function api_libraries_delete() {
    must_post();
    require_admin();
    $id = iarg('id');
    $n = (int)val('SELECT COUNT(*) FROM documents WHERE library_id=? AND deleted_at IS NULL', [$id]);
    if ($n) fail("Move or delete the $n documents in this library first.");
    update('libraries', ['deleted_at' => now()], 'id=?', [$id]);
    audit('library_delete', 'library', $id);
    return [];
}

function api_libraries_folder_save() {
    must_post();
    $u = me();
    $id = iarg('id');
    $name = trim(preg_replace('/[\/\\\\]+/', '-', sarg('name', '', 160)));
    if ($name === '') fail('Give the folder a name.');
    if ($id) {
        $f = one('SELECT * FROM folders WHERE id=? AND deleted_at IS NULL', [$id]);
        if (!$f) fail('Folder not found.', 404);
        if (container_level((int)$f['library_id'], $id) < LVL_FULL) fail('You need Full control to rename this folder.', 403);
        update('folders', ['name' => $name], 'id=?', [$id]);
        audit('folder_rename', 'folder', $id, $name);
        return ['id' => $id];
    }
    $lib = iarg('library_id'); $parent = iarg('parent_id') ?: null;
    if (!val('SELECT id FROM libraries WHERE id=? AND deleted_at IS NULL', [$lib])) fail('Library not found.', 404);
    // the parent folder must belong to the same library (otherwise access on one library could open a door into another)
    if ($parent && !val('SELECT id FROM folders WHERE id=? AND library_id=? AND deleted_at IS NULL', [$parent, $lib])) fail('That folder is not in this library.');
    if (container_level($lib, $parent) < LVL_CONTRIBUTE) fail('You need Contribute access here to create folders.', 403);
    if (val('SELECT id FROM folders WHERE library_id=? AND ' . ($parent ? 'parent_id=?' : 'parent_id IS NULL') . ' AND name=? AND deleted_at IS NULL',
        $parent ? [$lib, $parent, $name] : [$lib, $name])) fail("A folder named \"$name\" already exists here.");
    $id = insert('folders', ['library_id' => $lib, 'parent_id' => $parent, 'name' => $name, 'created_by' => $u['id']]);
    audit('folder_create', 'folder', $id, $name);
    return ['id' => $id];
}

function api_libraries_folder_delete() {
    must_post();
    $id = iarg('id');
    $f = one('SELECT * FROM folders WHERE id=? AND deleted_at IS NULL', [$id]);
    if (!$f) fail('Folder not found.', 404);
    if (container_level((int)$f['library_id'], $id) < LVL_FULL) fail('You need Full control to delete this folder.', 403);
    // collect subtree
    $ids = [$id]; $frontier = [$id];
    while ($frontier) {
        $kids = array_map('intval', array_column(all('SELECT id FROM folders WHERE parent_id IN (' . in_list($frontier) . ') AND deleted_at IS NULL'), 'id'));
        $ids = array_merge($ids, $kids); $frontier = $kids;
    }
    $n = (int)val('SELECT COUNT(*) FROM documents WHERE folder_id IN (' . in_list($ids) . ') AND deleted_at IS NULL');
    if ($n) fail("This folder still holds $n documents. Move or delete them first.");
    q('UPDATE folders SET deleted_at=? WHERE id IN (' . in_list($ids) . ')', [now()]);
    audit('folder_delete', 'folder', $id, $f['name']);
    return [];
}

/* ---------- Permissions ---------- */
function scope_full_level(string $scope, int $id): int {
    if ($scope === 'library') return library_level($id);
    if ($scope === 'folder') { $lib = (int)val('SELECT library_id FROM folders WHERE id=?', [$id]); return container_level($lib, $id); }
    if ($scope === 'document') return doc_level(load_doc($id));
    return 0;
}

function principal_label(string $type, string $pid): string {
    switch ($type) {
        case 'everyone': return 'Everyone';
        case 'user': return (string)(val('SELECT name FROM users WHERE id=?', [(int)$pid]) ?? 'Removed user');
        case 'department': return (string)(val('SELECT name FROM departments WHERE id=?', [(int)$pid]) ?? 'Removed department');
        case 'group': return (string)(val('SELECT name FROM user_groups WHERE id=?', [(int)$pid]) ?? 'Removed group');
        case 'role': return ['admin' => 'All administrators', 'head' => 'All department heads', 'member' => 'All members', 'viewer' => 'All viewers'][$pid] ?? $pid;
    }
    return $pid;
}

function api_libraries_perms_get() {
    $scope = sarg('scope'); $id = iarg('id');
    if (!in_array($scope, ['library', 'folder', 'document'], true)) fail('Unknown scope.');
    if (scope_full_level($scope, $id) < LVL_FULL) fail('You need Full control to manage permissions here.', 403);
    $inherit = 0; $source = null;
    if ($scope === 'folder') $inherit = (int)val('SELECT inherit FROM folders WHERE id=?', [$id]);
    if ($scope === 'document') $inherit = (int)val('SELECT inherit FROM documents WHERE id=?', [$id]);
    $explainScope = $scope; $explainId = $id;
    if ($inherit) { // show the effective entries from the defining parent
        $ex = explain_access(me(), $scope, $id);
        $explainScope = $ex['defining']['type']; $explainId = $ex['defining']['id'];
        $source = $ex['defining'];
    }
    $rows = all('SELECT id, principal_type, principal_id, level FROM permissions WHERE scope_type=? AND scope_id=? ORDER BY level DESC, principal_type', [$explainScope, $explainId]);
    foreach ($rows as &$r) { $r['id'] = (int)$r['id']; $r['level'] = (int)$r['level']; $r['label'] = principal_label($r['principal_type'], $r['principal_id']); }
    $conf = $scope === 'document' ? (string)val('SELECT confidentiality FROM documents WHERE id=?', [$id]) : '';
    return ['inherit' => $inherit, 'source' => $source, 'entries' => $rows, 'classification' => $conf, 'classification_rule' => classification_rule($conf)];
}

function api_libraries_perms_save() {
    must_post();
    $u = me();
    $scope = sarg('scope'); $id = iarg('id');
    if (!in_array($scope, ['library', 'folder', 'document'], true)) fail('Unknown scope.');
    if (scope_full_level($scope, $id) < LVL_FULL) fail('You need Full control to manage permissions here.', 403);
    $inherit = $scope === 'library' ? 0 : (arg('inherit') ? 1 : 0);
    if ($scope === 'document' && val('SELECT confidentiality FROM documents WHERE id=?', [$id]) === 'restricted') $inherit = 0;
    $entries = arg('entries', []);
    if (!is_array($entries)) $entries = [];
    db()->beginTransaction();
    if ($scope === 'folder') update('folders', ['inherit' => $inherit], 'id=?', [$id]);
    if ($scope === 'document') update('documents', ['inherit' => $inherit], 'id=?', [$id]);
    q('DELETE FROM permissions WHERE scope_type=? AND scope_id=?', [$scope, $id]);
    $labels = [];
    if (!$inherit) {
        $seen = [];
        foreach ($entries as $e) {
            $pt = (string)($e['principal_type'] ?? ''); $pid = (string)($e['principal_id'] ?? ''); $lv = max(1, min(4, (int)($e['level'] ?? 1)));
            if (!in_array($pt, ['user', 'department', 'group', 'role', 'everyone'], true)) continue;
            if ($pt === 'everyone') $pid = '';
            $k = "$pt:$pid"; if (isset($seen[$k])) continue; $seen[$k] = 1;
            insert('permissions', ['scope_type' => $scope, 'scope_id' => $id, 'principal_type' => $pt, 'principal_id' => $pid, 'level' => $lv, 'created_by' => $u['id']]);
            $labels[] = principal_label($pt, $pid) . '=' . LEVEL_NAMES[$lv];
        }
        // never lock the editor out
        if (!is_admin($u) && !$seen) insert('permissions', ['scope_type' => $scope, 'scope_id' => $id, 'principal_type' => 'user', 'principal_id' => (string)$u['id'], 'level' => 4, 'created_by' => $u['id']]);
    }
    db()->commit();
    audit('permissions_change', $scope, $id, $inherit ? 'Inherits from parent' : implode('; ', $labels));
    return [];
}

/** Admin tool: what can this person do here, and why? */
function api_libraries_check() {
    require_admin();
    $uid = iarg('user_id'); $scope = sarg('scope'); $id = iarg('id');
    $row = one('SELECT id, role, department_id, name FROM users WHERE id=?', [$uid]);
    if (!$row) fail('Choose a person.');
    $t = ['id' => (int)$row['id'], 'role' => $row['role'], 'department_id' => $row['department_id'] !== null ? (int)$row['department_id'] : null,
        'groups' => array_map('intval', array_column(all('SELECT group_id FROM group_members WHERE user_id=?', [$uid]), 'group_id'))];
    if ($scope === 'document') { $lv = doc_level(load_doc($id), $t); }
    elseif ($scope === 'folder') { $lv = container_level((int)val('SELECT library_id FROM folders WHERE id=?', [$id]), $id, $t); }
    else $lv = library_level($id, $t);
    $ex = explain_access($t, $scope, $id);
    foreach ($ex['grants'] as &$g) $g['label'] = principal_label($g['principal_type'], (string)$g['principal_id']);
    $rule = $scope === 'document' ? classification_rule((string)val('SELECT confidentiality FROM documents WHERE id=?', [$id])) : '';
    return ['level' => $lv, 'level_name' => LEVEL_NAMES[$lv], 'name' => $row['name'], 'role' => $row['role'], 'explain' => $ex, 'classification_rule' => $rule];
}

/* ---------- Access requests ---------- */
function api_libraries_request_access() {
    must_post();
    $u = me();
    $lib = iarg('library_id');
    if (!val('SELECT id FROM libraries WHERE id=? AND deleted_at IS NULL', [$lib])) fail('Library not found.', 404);
    if (val("SELECT id FROM access_requests WHERE user_id=? AND library_id=? AND status='open'", [$u['id'], $lib])) return ['message' => 'Your request is already with the administrators.'];
    $id = insert('access_requests', ['user_id' => $u['id'], 'library_id' => $lib, 'level' => max(1, min(2, iarg('level', 1))), 'reason' => sarg('reason', '', 500)]);
    $libName = (string)val('SELECT name FROM libraries WHERE id=?', [$lib]);
    notify(array_map('intval', array_column(all("SELECT id FROM users WHERE role='admin' AND active=1"), 'id')), 'access_request',
        "{$u['name']} requested access to $libName", sarg('reason', '', 300), '#/admin/requests');
    audit('access_request', 'library', $lib);
    return ['id' => $id, 'message' => 'Request sent to the administrators.'];
}

function api_libraries_requests() {
    require_admin();
    return ['requests' => all("SELECT r.*, u.name AS user_name, u.email, d.name AS department, l.name AS library, x.name AS decided_name
        FROM access_requests r JOIN users u ON u.id=r.user_id LEFT JOIN departments d ON d.id=u.department_id JOIN libraries l ON l.id=r.library_id
        LEFT JOIN users x ON x.id=r.decided_by ORDER BY r.status='open' DESC, r.id DESC LIMIT 200")];
}

function api_libraries_request_decide() {
    must_post();
    $a = require_admin();
    $r = one("SELECT * FROM access_requests WHERE id=? AND status='open'", [iarg('id')]);
    if (!$r) fail('This request was already handled.');
    $grant = sarg('decision') === 'grant';
    if ($grant) insert('permissions', ['scope_type' => 'library', 'scope_id' => $r['library_id'], 'principal_type' => 'user',
        'principal_id' => (string)$r['user_id'], 'level' => max(1, min(4, iarg('level', (int)$r['level']))), 'created_by' => $a['id']]);
    update('access_requests', ['status' => $grant ? 'granted' : 'declined', 'decided_by' => $a['id'], 'decided_at' => now()], 'id=?', [$r['id']]);
    $lib = (string)val('SELECT name FROM libraries WHERE id=?', [$r['library_id']]);
    notify([(int)$r['user_id']], 'access_decision', $grant ? "You now have access to $lib" : "Your access request for $lib was declined", '', $grant ? '#/lib/' . $r['library_id'] : '');
    audit($grant ? 'access_granted' : 'access_declined', 'library', (int)$r['library_id'], 'User #' . $r['user_id']);
    return [];
}
