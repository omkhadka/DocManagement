<?php
declare(strict_types=1);

function api_admin_audit() {
    require_admin();
    $where = ['1=1']; $p = [];
    if ($uid = iarg('user_id')) { $where[] = 'a.user_id=?'; $p[] = $uid; }
    if ($act = sarg('action')) { $where[] = 'a.action=?'; $p[] = $act; }
    if ($t = sarg('object_type')) { $where[] = 'a.object_type=?'; $p[] = $t; }
    if ($oid = iarg('object_id')) { $where[] = 'a.object_id=?'; $p[] = $oid; }
    if ($f = sarg('from')) { $where[] = 'a.created_at >= ?'; $p[] = $f; }
    if ($to = sarg('to')) { $where[] = 'a.created_at < DATE_ADD(?, INTERVAL 1 DAY)'; $p[] = $to; }
    if ($s = sarg('q', '', 200)) { $where[] = '(a.details LIKE ? OR u.name LIKE ?)'; $p[] = "%$s%"; $p[] = "%$s%"; }
    $w = implode(' AND ', $where);
    $page = max(1, iarg('page', 1)); $per = 100;
    $csv = sarg('format') === 'csv';
    $limit = $csv ? 'LIMIT 50000' : 'LIMIT ' . (($page - 1) * $per) . ", $per";
    $rows = all("SELECT a.id, a.created_at, a.action, a.object_type, a.object_id, a.details, a.ip, u.name AS user_name,
        CASE WHEN a.object_type='document' THEN (SELECT title FROM documents WHERE id=a.object_id) END AS object_name
        FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE $w ORDER BY a.id DESC $limit", $p);
    if ($csv) {
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="audit-log-' . date('Ymd-His') . '.csv"');
        $out = fopen('php://output', 'w');
        fwrite($out, "\xEF\xBB\xBF");
        fputcsv($out, ['Time', 'Person', 'Action', 'Object type', 'Object ID', 'Object', 'Details', 'IP']);
        // cells that start with = + - @ are neutralised so a spreadsheet never runs them as formulas
        $cell = fn($v) => is_string($v) && $v !== '' && strpbrk($v[0], "=+-@\t\r") !== false ? "'" . $v : $v;
        foreach ($rows as $r) fputcsv($out, array_map($cell, [$r['created_at'], $r['user_name'], $r['action'], $r['object_type'], $r['object_id'], $r['object_name'], $r['details'], $r['ip']]));
        fclose($out);
        audit('audit_export', 'system', null, 'CSV export');
        exit;
    }
    $total = (int)val("SELECT COUNT(*) FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE $w", $p);
    $actions = array_column(all('SELECT DISTINCT action FROM audit_log ORDER BY action'), 'action');
    return ['rows' => $rows, 'total' => $total, 'page' => $page, 'pages' => (int)ceil($total / $per), 'actions' => $actions];
}

const SETTING_KEYS = ['site_name', 'org_name', 'welcome_text', 'number_pattern', 'max_upload_mb', 'allowed_ext', 'recycle_days', 'session_minutes',
    'email_notifications', 'mail_from', 'base_url', 'checkout_hours', 'mfa_policy', 'mfa_remember_days', 'approval_workflow'];

function api_admin_settings() {
    require_admin();
    $s = [];
    foreach (SETTING_KEYS as $k) $s[$k] = setting($k, '');
    $s['mfa_counts'] = ['on' => (int)val('SELECT COUNT(*) FROM users WHERE active=1 AND mfa_enabled=1'), 'people' => (int)val('SELECT COUNT(*) FROM users WHERE active=1')];
    $s['server'] = ['php' => PHP_VERSION, 'upload_max_filesize' => ini_get('upload_max_filesize'), 'post_max_size' => ini_get('post_max_size'),
        'memory_limit' => ini_get('memory_limit'), 'max_execution_time' => ini_get('max_execution_time'), 'zip' => class_exists('ZipArchive'),
        'mysql' => (string)val('SELECT VERSION()'), 'app_version' => KM_VERSION, 'storage_writable' => is_writable(storage_path('files'))];
    return ['settings' => $s];
}

function api_admin_settings_save() {
    must_post();
    require_admin();
    $in = input();
    foreach (SETTING_KEYS as $k) {
        if (!array_key_exists($k, $in)) continue;
        $v = is_scalar($in[$k]) ? trim((string)$in[$k]) : '';
        if (in_array($k, ['max_upload_mb', 'recycle_days', 'session_minutes', 'checkout_hours'], true)) $v = (string)max(1, (int)$v);
        if ($k === 'allowed_ext') $v = implode(',', array_diff(array_filter(array_map(fn($e) => preg_replace('/[^a-z0-9]/', '', strtolower(trim($e))), explode(',', $v))), BLOCKED_EXT));
        if ($k === 'email_notifications') $v = $v ? '1' : '0';
        if ($k === 'approval_workflow') {
            $v = $v ? '1' : '0';
            if ($v !== setting('approval_workflow', '0')) {
                audit('approval_workflow', 'system', null, $v === '1' ? 'Approval workflow switched on' : 'Approval workflow switched off');
                set_setting($k, $v);
                if ($v === '0') km_publish_pending((int)me()['id']);
            }
        }
        if ($k === 'mfa_remember_days') $v = (string)max(0, min(365, (int)$in[$k]));
        if ($k === 'mfa_policy') {
            if (!in_array($v, ['optional', 'privileged', 'all'], true)) continue;
            $me = me();
            if ($v !== 'optional' && !(int)val('SELECT mfa_enabled FROM users WHERE id=?', [$me['id']]))
                fail('Turn on two-step verification for your own account first (Profile → Two-step verification), then require it for others.');
            if ($v !== setting('mfa_policy', 'optional')) audit('mfa_policy', 'system', null, $v);
        }
        set_setting($k, mb_substr($v, 0, 2000));
    }
    audit('settings_change', 'system');
    return ['message' => 'Settings saved.'];
}

function api_admin_stats() {
    require_admin();
    $months = all("SELECT DATE_FORMAT(created_at, '%Y-%m') m, COUNT(*) n FROM document_versions WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 11 MONTH) GROUP BY m ORDER BY m");
    $byLib = all('SELECT l.name, l.color, COUNT(d.id) n, COALESCE(SUM(v.size),0) size FROM libraries l LEFT JOIN documents d ON d.library_id=l.id AND d.deleted_at IS NULL
        LEFT JOIN document_versions v ON v.id=d.current_version_id WHERE l.deleted_at IS NULL GROUP BY l.id ORDER BY n DESC');
    $byDept = all('SELECT COALESCE(dp.name, \'No department\') name, COALESCE(dp.color, \'#8A9AA1\') color, COUNT(d.id) n FROM documents d JOIN users u ON u.id=d.owner_id
        LEFT JOIN departments dp ON dp.id=u.department_id WHERE d.deleted_at IS NULL GROUP BY dp.id ORDER BY n DESC');
    $byStatus = all('SELECT status, COUNT(*) n FROM documents WHERE deleted_at IS NULL GROUP BY status');
    $byType = all('SELECT COALESCE(c.name, \'General document\') name, COALESCE(c.color, \'#8A9AA1\') color, COUNT(*) n FROM documents d LEFT JOIN content_types c ON c.id=d.content_type_id
        WHERE d.deleted_at IS NULL GROUP BY c.id ORDER BY n DESC');
    $top = all('SELECT d.id, d.title, d.doc_number, d.views, l.name library FROM documents d JOIN libraries l ON l.id=d.library_id WHERE d.deleted_at IS NULL ORDER BY d.views DESC LIMIT 8');
    $contributors = all('SELECT u.name, COUNT(*) n FROM document_versions v JOIN users u ON u.id=v.uploaded_by WHERE v.created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY) GROUP BY u.id ORDER BY n DESC LIMIT 8');
    $searches = all("SELECT details q, COUNT(*) n FROM audit_log WHERE action='search' AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND details<>'' GROUP BY details ORDER BY n DESC LIMIT 10");
    $approvalTime = (float)val("SELECT AVG(TIMESTAMPDIFF(HOUR, requested_at, decided_at)) FROM approvals WHERE decision IN ('approved','rejected') AND decided_at >= DATE_SUB(NOW(), INTERVAL 90 DAY) AND requested_by <> decided_by AND decided_at >= requested_at");
    $storage = (int)val('SELECT COALESCE(SUM(size),0) FROM (SELECT DISTINCT stored_name, size FROM document_versions) x');
    $active = (int)val("SELECT COUNT(DISTINCT user_id) FROM audit_log WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)");
    $neverTagged = (int)val('SELECT COUNT(*) FROM documents d WHERE d.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM document_terms t WHERE t.document_id=d.id)');
    $overdue = (int)val('SELECT COUNT(*) FROM documents WHERE deleted_at IS NULL AND review_date < CURDATE()');
    $stale = (int)val("SELECT COUNT(*) FROM documents WHERE deleted_at IS NULL AND status='pending' AND updated_at < DATE_SUB(NOW(), INTERVAL 3 DAY)");
    return compact('months', 'byLib', 'byDept', 'byStatus', 'byType', 'top', 'contributors', 'searches', 'approvalTime', 'storage', 'active', 'neverTagged', 'overdue', 'stale');
}

function api_admin_announcement_save() {
    must_post();
    $u = me();
    if (!in_array($u['role'], ['admin', 'head'], true)) fail('Only administrators and department heads can post announcements.', 403);
    $id = iarg('id');
    $data = ['title' => sarg('title', '', 200), 'body' => sarg('body', '', 5000), 'pinned' => arg('pinned') && is_admin($u) ? 1 : 0];
    if ($data['title'] === '') fail('Give the announcement a title.');
    if ($id) {
        $a = one('SELECT created_by FROM announcements WHERE id=?', [$id]);
        if (!$a || ((int)$a['created_by'] !== $u['id'] && !is_admin($u))) fail("You can't edit this announcement.", 403);
        update('announcements', $data, 'id=?', [$id]);
    } else $id = insert('announcements', $data + ['created_by' => $u['id']]);
    audit('announcement', 'announcement', $id, $data['title']);
    return ['id' => $id];
}
function api_admin_announcement_delete() {
    must_post();
    $u = me();
    $a = one('SELECT created_by FROM announcements WHERE id=?', [iarg('id')]);
    if (!$a) return [];
    if ((int)$a['created_by'] !== $u['id'] && !is_admin($u)) fail("You can't delete this announcement.", 403);
    q('DELETE FROM announcements WHERE id=?', [iarg('id')]);
    return [];
}
