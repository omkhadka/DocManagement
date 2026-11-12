<?php
declare(strict_types=1);

function api_dash_home() {
    $u = me();
    $recent = array_slice(visible_doc_rows("d.status <> 'rejected' OR d.owner_id = ?", [$u['id']]), 0, 8);
    $mine = array_slice(visible_doc_rows('d.owner_id = ?', [$u['id']]), 0, 6);
    $favs = visible_doc_rows('d.id IN (SELECT document_id FROM favorites WHERE user_id = ?)', [$u['id']], 'd.title');
    $review = array_slice(visible_doc_rows('d.review_date IS NOT NULL AND d.review_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) AND (d.owner_id = ? OR ? = 1)',
        [$u['id'], is_admin($u) ? 1 : 0], 'd.review_date'), 0, 6);

    // Recently viewed by me
    $viewedIds = array_map('intval', array_column(all("SELECT object_id, MAX(id) mx FROM audit_log WHERE user_id=? AND action='view' AND object_type='document'
        GROUP BY object_id ORDER BY mx DESC LIMIT 8", [$u['id']]), 'object_id'));
    $viewed = [];
    if ($viewedIds) {
        $byId = [];
        foreach (visible_doc_rows('d.id IN (' . in_list($viewedIds) . ')') as $d) $byId[$d['id']] = $d;
        foreach ($viewedIds as $id) if (isset($byId[$id])) $viewed[] = $byId[$id];
    }

    require_once KM_APP . '/api/approvals.php';
    $pending = count(approval_queue($u));

    $libs = [];
    $ctx = perm_ctx($u);
    $counts = [];
    foreach (all("SELECT library_id, COUNT(*) n FROM documents WHERE deleted_at IS NULL AND published_version_id IS NOT NULL GROUP BY library_id") as $r) $counts[(int)$r['library_id']] = (int)$r['n'];
    foreach (all('SELECT id, name, code, color, icon, description FROM libraries WHERE deleted_at IS NULL ORDER BY name') as $l) {
        if (($ctx['lib'][(int)$l['id']] ?? 0) < 1) continue;
        $l['id'] = (int)$l['id']; $l['count'] = max(0, ($counts[$l['id']] ?? 0) - (hidden_counts($u)['lib'][$l['id']] ?? 0)); $l['level'] = $ctx['lib'][$l['id']];
        $libs[] = $l;
    }

    // Activity feed limited to documents the user can see
    $feedRaw = all("SELECT a.id, a.action, a.object_id, a.details, a.created_at, u.name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id
        WHERE a.object_type='document' AND a.action IN ('upload','new_version','approve','publish','comment','reject') ORDER BY a.id DESC LIMIT 80");
    $feedDocIds = array_unique(array_map('intval', array_column($feedRaw, 'object_id')));
    $seen = [];
    foreach (visible_doc_rows('d.id IN (' . in_list($feedDocIds) . ')', [], 'd.id', 500) as $d) $seen[$d['id']] = $d;
    $feed = [];
    foreach ($feedRaw as $f) {
        $id = (int)$f['object_id'];
        if (!isset($seen[$id])) continue;
        $feed[] = ['action' => $f['action'], 'who' => $f['name'] ?? 'System', 'when' => $f['created_at'], 'doc_id' => $id, 'title' => $seen[$id]['title'],
            'library' => $seen[$id]['library'], 'details' => $f['details']];
        if (count($feed) >= 12) break;
    }

    $ann = all('SELECT a.id, a.title, a.body, a.pinned, a.created_at, u.name AS author FROM announcements a LEFT JOIN users u ON u.id=a.created_by ORDER BY a.pinned DESC, a.id DESC LIMIT 5');
    $totals = [
        'documents' => max(0, (int)val('SELECT COUNT(*) FROM documents WHERE deleted_at IS NULL AND published_version_id IS NOT NULL') - hidden_counts($u)['total']),
        'versions' => (int)val('SELECT COUNT(*) FROM document_versions'),
        'this_month' => (int)val("SELECT COUNT(*) FROM documents WHERE deleted_at IS NULL AND created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')"),
        'people' => (int)val('SELECT COUNT(*) FROM users WHERE active=1'),
    ];
    $myDrafts = (int)val("SELECT COUNT(*) FROM documents WHERE owner_id=? AND deleted_at IS NULL AND status IN ('draft','rejected')", [$u['id']]);
    return compact('recent', 'mine', 'favs', 'review', 'viewed', 'pending', 'libs', 'feed', 'ann', 'totals', 'myDrafts');
}

function api_dash_collection() {
    $u = me();
    $kind = sarg('kind');
    switch ($kind) {
        case 'favorites': $docs = visible_doc_rows('d.id IN (SELECT document_id FROM favorites WHERE user_id = ?)', [$u['id']], 'd.title'); break;
        case 'mine': $docs = visible_doc_rows('d.owner_id = ?', [$u['id']], 'd.updated_at DESC', 1000); break;
        case 'checked_out': $docs = visible_doc_rows('d.checked_out_by = ?', [$u['id']]); break;
        case 'review': $docs = visible_doc_rows('d.review_date IS NOT NULL AND d.review_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)', [], 'd.review_date'); break;
        case 'recent':
            $ids = array_map('intval', array_column(all("SELECT object_id, MAX(id) mx FROM audit_log WHERE user_id=? AND action IN ('view','download','upload','new_version')
                AND object_type='document' GROUP BY object_id ORDER BY mx DESC LIMIT 60", [$u['id']]), 'object_id'));
            $by = []; foreach (visible_doc_rows('d.id IN (' . in_list($ids) . ')', [], 'd.id', 100) as $d) $by[$d['id']] = $d;
            $docs = []; foreach ($ids as $id) if (isset($by[$id])) $docs[] = $by[$id];
            break;
        default: fail('Unknown collection.');
    }
    return ['docs' => $docs];
}
