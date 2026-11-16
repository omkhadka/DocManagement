<?php
/**
 * Permission engine.
 * Levels: 0 none, 1 Read, 2 Contribute, 3 Approve, 4 Full control.
 * Libraries always define permissions. Folders and documents inherit from their
 * parent unless inheritance is broken (inherit = 0), in which case only their own entries count.
 */
declare(strict_types=1);

const LVL_NONE = 0, LVL_READ = 1, LVL_CONTRIBUTE = 2, LVL_APPROVE = 3, LVL_FULL = 4;
const LEVEL_NAMES = [0 => 'No access', 1 => 'Read', 2 => 'Contribute', 3 => 'Approve', 4 => 'Full control'];

/** Does a permission row apply to this user? */
function principal_matches(array $row, array $u): bool {
    switch ($row['principal_type']) {
        case 'everyone': return true;
        case 'user': return (int)$row['principal_id'] === $u['id'];
        case 'department': return $u['department_id'] !== null && (int)$row['principal_id'] === $u['department_id'];
        case 'group': return in_array((int)$row['principal_id'], $u['groups'], true);
        case 'role': return $row['principal_id'] === $u['role'];
    }
    return false;
}

/** Loads a per-request context with every library / folder level for the given user. */
function perm_ctx(?array $u = null): array {
    static $cache = [];
    $u = $u ?? me();
    if (isset($cache[$u['id']])) return $cache[$u['id']];

    $libs = all('SELECT id, department_id, approval_required, approval_mode FROM libraries WHERE deleted_at IS NULL');
    $folders = all('SELECT id, library_id, parent_id, inherit FROM folders WHERE deleted_at IS NULL');
    $rows = all("SELECT scope_type, scope_id, principal_type, principal_id, level FROM permissions WHERE scope_type IN ('library','folder')");

    $own = ['library' => [], 'folder' => []];
    foreach ($rows as $r) {
        if (!principal_matches($r, $u)) continue;
        $k = (int)$r['scope_id'];
        $own[$r['scope_type']][$k] = max($own[$r['scope_type']][$k] ?? 0, (int)$r['level']);
    }
    $admin = $u['role'] === 'admin';
    $libLevel = [];
    $libInfo = [];
    foreach ($libs as $l) {
        $id = (int)$l['id'];
        $libInfo[$id] = $l;
        $libLevel[$id] = $admin ? LVL_FULL : ($own['library'][$id] ?? 0);
    }
    $fInfo = [];
    foreach ($folders as $f) $fInfo[(int)$f['id']] = $f;
    $folderLevel = [];
    $resolve = function (int $fid) use (&$resolve, &$folderLevel, $fInfo, $own, $libLevel, $admin): int {
        if (isset($folderLevel[$fid])) return $folderLevel[$fid];
        $f = $fInfo[$fid] ?? null;
        if (!$f) return 0;
        if ($admin) $lv = LVL_FULL;
        elseif (!(int)$f['inherit']) $lv = $own['folder'][$fid] ?? 0;
        elseif ($f['parent_id']) $lv = $resolve((int)$f['parent_id']);
        else $lv = $libLevel[(int)$f['library_id']] ?? 0;
        return $folderLevel[$fid] = $lv;
    };
    foreach ($fInfo as $fid => $_) $resolve($fid);

    return $cache[$u['id']] = ['user' => $u, 'lib' => $libLevel, 'folder' => $folderLevel, 'libInfo' => $libInfo, 'folderInfo' => $fInfo];
}

function library_level(int $libId, ?array $u = null): int { return perm_ctx($u)['lib'][$libId] ?? 0; }
function container_level(int $libId, ?int $folderId, ?array $u = null): int {
    $c = perm_ctx($u);
    if ($folderId) return $c['folder'][$folderId] ?? 0;
    return $c['lib'][$libId] ?? 0;
}

/** Effective level on a document row (needs id, library_id, folder_id, inherit). */
/** Highest level granted to this user by permission entries placed directly on the document ("named people"). */
function doc_named_level(array $d, array $u): int {
    static $rows = [];
    $id = (int)$d['id'];
    if (!isset($rows[$id])) $rows[$id] = all("SELECT principal_type, principal_id, level FROM permissions WHERE scope_type='document' AND scope_id=?", [$id]);
    $lv = 0;
    foreach ($rows[$id] as $r) if (principal_matches($r, $u)) $lv = max($lv, (int)$r['level']);
    return $lv;
}

/** Level from library / folder / document permissions only, before the classification rule. */
function doc_level_base(array $d, array $u): int {
    if ($u['role'] === 'admin') return LVL_FULL;
    if (!(int)$d['inherit']) return doc_named_level($d, $u);
    return container_level((int)$d['library_id'], $d['folder_id'] ? (int)$d['folder_id'] : null, $u);
}

/**
 * Effective level on a document (needs id, library_id, folder_id, inherit, owner_id, confidentiality).
 * The classification narrows who gets in:
 *   Restricted   – administrators, the author, and people named on the document only.
 *   Confidential – administrators, the author, the library's owning department, approvers,
 *                  people with Contribute access or more, and people named on the document.
 *   Internal / Public – permissions as set.
 */
function doc_level(array $d, ?array $u = null): int {
    $u = $u ?? me();
    if ($u['role'] === 'admin') return LVL_FULL;
    $base = doc_level_base($d, $u);
    $conf = (string)($d['confidentiality'] ?? 'internal');
    if ($conf !== 'restricted' && $conf !== 'confidential') return $base;
    $isOwner = isset($d['owner_id']) && (int)$d['owner_id'] === $u['id'];
    if ($conf === 'restricted') return $isOwner ? LVL_FULL : doc_named_level($d, $u);
    // confidential
    $named = doc_named_level($d, $u);
    if ($base < LVL_READ) return $named;
    if ($isOwner || $base >= LVL_CONTRIBUTE) return max($base, $named);
    $lib = perm_ctx($u)['libInfo'][(int)$d['library_id']] ?? null;
    if ($lib && $lib['department_id'] !== null && (int)$lib['department_id'] === $u['department_id']) return max($base, $named);
    // department heads count as approvers only while the approval workflow is on
    $approver = $base >= LVL_APPROVE || (approvals_on() && $u['role'] === 'head' && $lib && ($lib['approval_mode'] === 'any_head' || ((int)$lib['department_id'] === $u['department_id'])));
    return $approver ? max($base, $named) : $named;
}

/** Who among these user ids may see the document (used to avoid leaking titles in notifications). */
function users_who_can_see(array $ids, array $d): array {
    $out = [];
    foreach (array_unique(array_map('intval', $ids)) as $id) {
        $c = one('SELECT id, role, department_id, active FROM users WHERE id=?', [$id]);
        if (!$c || !(int)$c['active']) continue;
        $u = ['id' => (int)$c['id'], 'role' => $c['role'], 'department_id' => $c['department_id'] !== null ? (int)$c['department_id'] : null,
              'groups' => array_map('intval', array_column(all('SELECT group_id FROM group_members WHERE user_id = ?', [$id]), 'group_id'))];
        if (visible_version($d, $u)) $out[] = $id;
    }
    return $out;
}

/** A short explanation of who a classification lets in (for the document page and the access checker). */
function classification_rule(string $conf): string {
    return [
        'restricted' => 'Restricted: only administrators, the author and people named on the document can see it.',
        'confidential' => 'Confidential: only administrators, the author, the owning department, ' . (approvals_on() ? 'approvers, ' : 'people with Approve access, ') . 'contributors and people named on the document can see it.',
    ][$conf] ?? '';
}

/** Can the user approve documents in this library? */
function can_approve_doc(array $d, ?array $u = null): bool {
    $u = $u ?? me();
    if ($u['role'] === 'admin') return true;
    $lv = doc_level($d, $u);
    if ($lv >= LVL_APPROVE) return true;
    if (!approvals_on() || $u['role'] !== 'head' || $lv < LVL_READ) return false;   // heads approve only while the workflow is on
    $lib = perm_ctx($u)['libInfo'][(int)$d['library_id']] ?? null;
    if (!$lib) return false;
    if ($lib['approval_mode'] === 'any_head') return true;
    return $lib['department_id'] !== null && (int)$lib['department_id'] === $u['department_id'];
}

/** Can the user see this document at all (status-aware)? Returns the version id they may see, or 0. */
function visible_version(array $d, ?array $u = null): int {
    $u = $u ?? me();
    $lv = doc_level($d, $u);
    if ($lv < LVL_READ) return 0;
    if (sees_drafts($d, $u)) return (int)$d['current_version_id'];
    return (int)($d['published_version_id'] ?? 0);
}

/** Can the user see draft / pending versions (author, approvers, Approve+ level)? */
function sees_drafts(array $d, ?array $u = null): bool {
    $u = $u ?? me();
    $lv = doc_level($d, $u);
    if ($lv < LVL_READ) return false;
    return (int)$d['owner_id'] === $u['id'] || $lv >= LVL_APPROVE || can_approve_doc($d, $u);
}

/** Users who can approve a given document (for notifications). */
function approvers_for(array $d): array {
    $out = [];
    $lib = one('SELECT * FROM libraries WHERE id = ?', [$d['library_id']]);
    $cands = all("SELECT id, name, email, role, department_id FROM users WHERE active = 1 AND role IN ('admin','head')");
    foreach ($cands as $c) {
        $u = ['id' => (int)$c['id'], 'role' => $c['role'], 'department_id' => $c['department_id'] !== null ? (int)$c['department_id'] : null,
              'groups' => array_map('intval', array_column(all('SELECT group_id FROM group_members WHERE user_id = ?', [$c['id']]), 'group_id'))];
        if ($c['role'] === 'admin') {
            // Admins only get the request when no head is eligible (collected below).
            continue;
        }
        if (can_approve_doc($d, $u)) $out[] = (int)$c['id'];
    }
    if (!$out) $out = array_map('intval', array_column(all("SELECT id FROM users WHERE active=1 AND role='admin'"), 'id'));
    return $out;
}

/** Explain how a user gets their level on a scope (Check permissions tool). */
function explain_access(array $u, string $scope, int $id): array {
    $chain = [];
    if ($scope === 'document') {
        $d = one('SELECT id, library_id, folder_id, inherit, title FROM documents WHERE id=?', [$id]);
        if (!$d) return [];
        $chain[] = ['type' => 'document', 'id' => (int)$d['id'], 'name' => $d['title'], 'inherit' => (int)$d['inherit']];
        $fid = $d['folder_id'] ? (int)$d['folder_id'] : null; $lib = (int)$d['library_id'];
    } elseif ($scope === 'folder') {
        $fid = $id; $lib = (int)val('SELECT library_id FROM folders WHERE id=?', [$id]);
    } else { $fid = null; $lib = $id; }
    while ($fid) {
        $f = one('SELECT id, parent_id, inherit, name FROM folders WHERE id=?', [$fid]);
        if (!$f) break;
        $chain[] = ['type' => 'folder', 'id' => (int)$f['id'], 'name' => $f['name'], 'inherit' => (int)$f['inherit']];
        $fid = $f['parent_id'] ? (int)$f['parent_id'] : null;
    }
    $chain[] = ['type' => 'library', 'id' => $lib, 'name' => (string)val('SELECT name FROM libraries WHERE id=?', [$lib]), 'inherit' => 0];
    // Find the scope that defines permissions
    $defining = end($chain);
    foreach ($chain as $c) { if (!$c['inherit']) { $defining = $c; break; } }
    $grants = [];
    foreach (all('SELECT * FROM permissions WHERE scope_type=? AND scope_id=?', [$defining['type'], $defining['id']]) as $r) {
        if (principal_matches($r, $u)) $grants[] = ['principal_type' => $r['principal_type'], 'principal_id' => $r['principal_id'], 'level' => (int)$r['level']];
    }
    return ['chain' => $chain, 'defining' => $defining, 'grants' => $grants];
}

/** Published documents are a permanent record: only administrators can delete them.
    An unpublished draft can be deleted by its author (with Contribute) or by someone with Full control. */
function can_delete_doc(array $d, array $u, ?int $lv = null): bool {
    if (is_admin($u)) return true;
    if (!empty($d['published_version_id'])) return false;
    $lv = $lv ?? doc_level($d, $u);
    return ((int)$d['owner_id'] === (int)$u['id'] && $lv >= LVL_CONTRIBUTE) || $lv >= LVL_FULL;
}
