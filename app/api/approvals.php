<?php
declare(strict_types=1);

function approval_queue(array $u): array {
    $rows = all("SELECT a.id AS approval_id, a.requested_at, a.note, a.version_id, r.name AS requester, " . DOC_COLS . "
        FROM approvals a JOIN documents d ON d.id=a.document_id LEFT JOIN users r ON r.id=a.requested_by
        WHERE a.decision='pending' AND d.deleted_at IS NULL ORDER BY a.requested_at");
    $out = [];
    foreach ($rows as $r) if (can_approve_doc($r, $u)) $out[] = $r;
    return $out;
}

function enrich_approvals(array $rows, array $u): array {
    $docs = [];
    foreach (hydrate_docs($rows, $u) as $d) $docs[$d['id']] = $d;
    $res = [];
    foreach ($rows as $r) {
        if (!isset($docs[(int)$r['id']])) continue;
        $v = one('SELECT major, minor, filename, size FROM document_versions WHERE id=?', [$r['version_id']]);
        $res[] = ['approval_id' => (int)$r['approval_id'], 'requested_at' => $r['requested_at'], 'requester' => $r['requester'], 'note' => $r['note'],
            'decision' => $r['decision'] ?? 'pending', 'decided_at' => $r['decided_at'] ?? null, 'decider' => $r['decider'] ?? null,
            'version' => $v ? ver_label($v['major'], $v['minor']) : '', 'waiting_hours' => (int)round((time() - strtotime($r['requested_at'])) / 3600),
            'doc' => $docs[(int)$r['id']]];
    }
    return $res;
}

function api_approvals_queue() {
    $u = me();
    return ['items' => enrich_approvals(approval_queue($u), $u)];
}

function api_approvals_mine() {
    $u = me();
    $rows = all("SELECT a.id AS approval_id, a.requested_at, a.note, a.version_id, a.decision, a.decided_at, x.name AS decider, r.name AS requester, " . DOC_COLS . "
        FROM approvals a JOIN documents d ON d.id=a.document_id LEFT JOIN users r ON r.id=a.requested_by LEFT JOIN users x ON x.id=a.decided_by
        WHERE a.requested_by=? AND d.deleted_at IS NULL AND a.decision<>'cancelled' ORDER BY a.id DESC LIMIT 100", [$u['id']]);
    return ['items' => enrich_approvals($rows, $u)];
}

function api_approvals_history() {
    $u = me();
    $where = is_admin($u) ? "a.decision IN ('approved','rejected')" : "a.decided_by=" . (int)$u['id'] . " AND a.decision IN ('approved','rejected')";
    $rows = all("SELECT a.id AS approval_id, a.requested_at, a.note, a.version_id, a.decision, a.decided_at, x.name AS decider, r.name AS requester, " . DOC_COLS . "
        FROM approvals a JOIN documents d ON d.id=a.document_id LEFT JOIN users r ON r.id=a.requested_by LEFT JOIN users x ON x.id=a.decided_by
        WHERE $where AND d.deleted_at IS NULL ORDER BY a.decided_at DESC LIMIT 150");
    return ['items' => enrich_approvals($rows, $u)];
}

/** Approve or reject many at once. */
function api_approvals_bulk() {
    must_post();
    require_once KM_APP . '/api/docs.php';
    $ids = array_filter(array_map('intval', (array)arg('ids', [])));
    $decision = sarg('decision') === 'reject' ? 'reject' : 'approve';
    if ($decision === 'reject' && sarg('note') === '') fail('Add a note so authors know what to change.');
    $ok = 0; $errors = [];
    foreach ($ids as $id) {
        $u = me();
        $d = one('SELECT ' . DOC_COLS . ' FROM documents d WHERE d.id=? AND d.deleted_at IS NULL', [$id]);
        if (!$d || !can_approve_doc($d, $u) || $d['status'] !== 'pending') { $errors[] = $id; continue; }
        $a = one("SELECT * FROM approvals WHERE document_id=? AND decision='pending' ORDER BY id DESC LIMIT 1", [$id]);
        if (!$a) { $errors[] = $id; continue; }
        $note = sarg('note', '', 1000);
        update('approvals', ['decision' => $decision === 'approve' ? 'approved' : 'rejected', 'decided_by' => $u['id'], 'decided_at' => now(), 'note' => $note], 'id=?', [$a['id']]);
        if ($decision === 'approve') {
            $label = publish_version($d, (int)$a['version_id']);
            audit('approve', 'document', $id, "Published version $label");
            notify([(int)$d['owner_id']], 'approved', 'Approved and published: ' . $d['title'], "{$u['name']} approved version $label.", '#/doc/' . $id);
        } else {
            update('documents', ['status' => 'rejected'], 'id=?', [$id]);
            audit('reject', 'document', $id, $note);
            notify([(int)$d['owner_id']], 'rejected', 'Changes requested: ' . $d['title'], "{$u['name']}: $note", '#/doc/' . $id);
        }
        $ok++;
    }
    return ['done' => $ok, 'skipped' => count($errors)];
}
