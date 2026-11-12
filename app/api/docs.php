<?php
declare(strict_types=1);

/* ================= Listing ================= */

function term_descendants(array $ids): array {
    $ids = array_map('intval', $ids);
    $all = $ids; $frontier = $ids;
    while ($frontier) {
        $kids = array_map('intval', array_column(all('SELECT id FROM terms WHERE parent_id IN (' . in_list($frontier) . ')'), 'id'));
        $kids = array_diff($kids, $all);
        $all = array_merge($all, $kids); $frontier = $kids;
    }
    return $all;
}

function folder_descendants(int $id): array {
    $all = [$id]; $frontier = [$id];
    while ($frontier) {
        $kids = array_map('intval', array_column(all('SELECT id FROM folders WHERE parent_id IN (' . in_list($frontier) . ') AND deleted_at IS NULL'), 'id'));
        $all = array_merge($all, $kids); $frontier = $kids;
    }
    return $all;
}

/** Applies the shared filter set (content type, status, terms, owner, ext, date) to a WHERE clause. */
function doc_filters(array &$where, array &$p): void {
    if ($ct = array_filter(array_map('intval', (array)arg('ct', [])))) $where[] = 'd.content_type_id IN (' . in_list($ct) . ')';
    $st = array_intersect((array)arg('status', []), ['draft', 'pending', 'published', 'rejected']);
    if ($st) $where[] = "d.status IN ('" . implode("','", $st) . "')";
    if ($owner = iarg('owner')) { $where[] = 'd.owner_id = ?'; $p[] = $owner; }
    if ($conf = array_intersect((array)arg('conf', []), ['public', 'internal', 'confidential', 'restricted'])) $where[] = "d.confidentiality IN ('" . implode("','", $conf) . "')";
    $terms = array_filter(array_map('intval', (array)arg('terms', [])));
    if ($terms) {
        // AND across term sets, OR within a set
        $bySet = [];
        foreach (all('SELECT id, termset_id FROM terms WHERE id IN (' . in_list($terms) . ')') as $t) $bySet[(int)$t['termset_id']][] = (int)$t['id'];
        foreach ($bySet as $ids) $where[] = 'd.id IN (SELECT document_id FROM document_terms WHERE term_id IN (' . in_list(term_descendants($ids)) . '))';
    }
    if ($ext = array_filter(array_map(fn($e) => preg_replace('/[^a-z0-9]/', '', strtolower((string)$e)), (array)arg('ext', [])))) {
        $where[] = "d.current_version_id IN (SELECT id FROM document_versions WHERE ext IN ('" . implode("','", $ext) . "'))";
    }
    $since = sarg('since');
    $map = ['7d' => 7, '30d' => 30, '90d' => 90, '365d' => 365];
    if (isset($map[$since])) $where[] = 'd.updated_at >= DATE_SUB(NOW(), INTERVAL ' . $map[$since] . ' DAY)';
    foreach ((array)arg('meta', []) as $fid => $val) {
        if ($val === '' || $val === null || is_array($val)) continue;
        $where[] = 'd.id IN (SELECT document_id FROM document_meta WHERE field_id = ? AND value = ?)';
        $p[] = (int)$fid; $p[] = (string)$val;
    }
}

/** Facet counts (content types, terms, statuses, owners, file types) over hydrated docs. */
function doc_facets(array $docs): array {
    $ct = []; $st = []; $own = []; $ext = []; $lib = []; $termCount = [];
    foreach ($docs as $d) {
        if ($d['content_type_id']) { $k = $d['content_type_id']; $ct[$k] = ($ct[$k] ?? ['id' => $k, 'label' => $d['content_type'], 'color' => $d['content_type_color'], 'n' => 0]); $ct[$k]['n']++; }
        $st[$d['status']] = ($st[$d['status']] ?? 0) + 1;
        $own[$d['owner_id']] = ($own[$d['owner_id']] ?? ['id' => $d['owner_id'], 'label' => $d['owner'], 'n' => 0]); $own[$d['owner_id']]['n']++;
        if ($d['ext']) $ext[$d['ext']] = ($ext[$d['ext']] ?? 0) + 1;
        $lib[$d['library_id']] = ($lib[$d['library_id']] ?? ['id' => $d['library_id'], 'label' => $d['library'], 'color' => $d['library_color'], 'n' => 0]); $lib[$d['library_id']]['n']++;
        foreach ($d['terms'] as $t) $termCount[$t['id']] = ($termCount[$t['id']] ?? 0) + 1;
    }
    $terms = [];
    if ($termCount) {
        foreach (all('SELECT t.id, t.label, t.parent_id, s.id AS set_id, s.name AS set_name FROM terms t JOIN termsets s ON s.id=t.termset_id WHERE t.id IN (' . in_list(array_keys($termCount)) . ') ORDER BY s.name, t.label') as $t) {
            $terms[$t['set_name']][] = ['id' => (int)$t['id'], 'label' => $t['label'], 'n' => $termCount[(int)$t['id']]];
        }
    }
    usort($own, fn($a, $b) => $b['n'] <=> $a['n']);
    arsort($ext);
    return ['content_types' => array_values($ct), 'status' => $st, 'owners' => array_slice(array_values($own), 0, 12),
        'ext' => $ext, 'libraries' => array_values($lib), 'terms' => $terms];
}

function sort_docs(array &$docs): void {
    $sort = sarg('sort', 'modified'); $dir = sarg('dir', $sort === 'title' || $sort === 'number' ? 'asc' : 'desc') === 'asc' ? 1 : -1;
    $key = ['modified' => 'modified', 'title' => 'title', 'number' => 'doc_number', 'size' => 'size', 'views' => 'views', 'type' => 'content_type', 'owner' => 'owner'][$sort] ?? 'modified';
    usort($docs, function ($a, $b) use ($key, $dir) {
        $x = $a[$key]; $y = $b[$key];
        return (is_numeric($x) && is_numeric($y) ? $x <=> $y : strnatcasecmp((string)$x, (string)$y)) * $dir;
    });
}

function api_docs_list() {
    $u = me();
    $lib = iarg('library_id');
    $folder = iarg('folder_id') ?: null;
    $flat = sarg('flat') === '1';
    $where = ['d.deleted_at IS NULL', 'd.library_id = ?']; $p = [$lib];
    if ($flat) { if ($folder) $where[] = 'd.folder_id IN (' . in_list(folder_descendants($folder)) . ')'; }
    elseif ($folder) { $where[] = 'd.folder_id = ?'; $p[] = $folder; }
    else $where[] = 'd.folder_id IS NULL';
    if ($qf = sarg('q', '', 200)) { $where[] = '(d.title LIKE ? OR d.doc_number LIKE ? OR d.keywords LIKE ?)'; $like = '%' . $qf . '%'; array_push($p, $like, $like, $like); }
    $base = $where; $baseP = $p;
    doc_filters($where, $p);
    $docs = hydrate_docs(all('SELECT ' . DOC_COLS . ' FROM documents d WHERE ' . implode(' AND ', $where) . ' LIMIT 5000', $p), $u);
    sort_docs($docs);
    // facets reflect the container without the user's filters, so options don't vanish as you pick
    $facetDocs = hydrate_docs(all('SELECT ' . DOC_COLS . ' FROM documents d WHERE ' . implode(' AND ', $base) . ' LIMIT 5000', $baseP), $u);
    return ['docs' => $docs, 'facets' => doc_facets($facetDocs), 'level' => container_level($lib, $folder, $u)];
}

/* ================= Detail ================= */

function api_docs_get() {
    $u = me();
    $d = load_doc(iarg('id'));
    $vv = visible_version($d, $u);
    if (!$vv) fail(doc_level($d, $u) ? 'This document is waiting for approval and is not published yet.' : "You don't have access to this document.", 403);
    $lv = doc_level($d, $u);
    $canApprove = can_approve_doc($d, $u);
    $seeDrafts = sees_drafts($d, $u);
    $doc = hydrate_docs([$d], $u)[0];

    $vsql = 'SELECT v.id, v.major, v.minor, v.filename, v.ext, v.mime, v.size, v.sha256, v.comment, v.created_at, v.uploaded_by, u.name AS uploader
        FROM document_versions v LEFT JOIN users u ON u.id=v.uploaded_by WHERE v.document_id=?';
    if (!$seeDrafts) $vsql .= ' AND v.minor = 0';
    $versions = all($vsql . ' ORDER BY v.id DESC', [$d['id']]);
    foreach ($versions as &$v) {
        $v['id'] = (int)$v['id']; $v['label'] = ver_label($v['major'], $v['minor']); $v['size'] = (int)$v['size'];
        $v['is_current'] = $v['id'] === (int)$d['current_version_id']; $v['is_published'] = $v['id'] === (int)$d['published_version_id'];
    }
    unset($v);

    $fields = [];
    if ($d['content_type_id']) {
        $fields = all('SELECT f.* FROM fields f JOIN content_type_fields c ON c.field_id=f.id WHERE c.content_type_id=? ORDER BY f.sort, f.name', [$d['content_type_id']]);
    }
    $metaVals = [];
    foreach (all('SELECT field_id, value FROM document_meta WHERE document_id=?', [$d['id']]) as $m) $metaVals[(int)$m['field_id']] = $m['value'];
    $termVals = [];
    foreach (all('SELECT dt.field_id, t.id, t.label, t.termset_id FROM document_terms dt JOIN terms t ON t.id=dt.term_id WHERE dt.document_id=?', [$d['id']]) as $t)
        $termVals[(int)$t['field_id']][] = ['id' => (int)$t['id'], 'label' => $t['label']];
    // include fields that have values even if not part of the content type
    $have = array_column($fields, 'id');
    $extraIds = array_diff(array_merge(array_keys($metaVals), array_keys($termVals)), array_map('intval', $have), [0]);
    if ($extraIds) $fields = array_merge($fields, all('SELECT * FROM fields WHERE id IN (' . in_list($extraIds) . ')'));
    $props = [];
    foreach ($fields as $f) {
        $fid = (int)$f['id'];
        $val = $f['type'] === 'term' ? ($termVals[$fid] ?? []) : ($metaVals[$fid] ?? '');
        if ($f['type'] === 'user' && $val) $val = ['id' => (int)$val, 'name' => (string)val('SELECT name FROM users WHERE id=?', [(int)$val])];
        $props[] = ['field_id' => $fid, 'name' => $f['name'], 'type' => $f['type'], 'multi' => (int)$f['multi'], 'termset_id' => $f['termset_id'] ? (int)$f['termset_id'] : null,
            'options' => $f['options'] ? json_decode($f['options'], true) : null, 'required' => (int)$f['required'], 'value' => $val];
    }
    $freeTerms = $termVals[0] ?? [];

    $approvals = all('SELECT a.id, a.version_id, a.decision, a.note, a.requested_at, a.decided_at, r.name AS requester, x.name AS decider
        FROM approvals a LEFT JOIN users r ON r.id=a.requested_by LEFT JOIN users x ON x.id=a.decided_by WHERE a.document_id=? ORDER BY a.id DESC LIMIT 30', [$d['id']]);
    foreach ($approvals as &$a) { $a['version'] = (string)(($vl = one('SELECT major, minor FROM document_versions WHERE id=?', [$a['version_id']])) ? ver_label($vl['major'], $vl['minor']) : ''); }
    unset($a);
    if (!$seeDrafts) $approvals = array_values(array_filter($approvals, fn($a) => $a['decision'] === 'approved'));

    $comments = all('SELECT c.id, c.body, c.created_at, c.user_id, u.name FROM comments c JOIN users u ON u.id=c.user_id WHERE c.document_id=? ORDER BY c.id', [$d['id']]);
    $activity = all("SELECT a.action, a.details, a.created_at, u.name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id
        WHERE a.object_type='document' AND a.object_id=? ORDER BY a.id DESC LIMIT 40", [$d['id']]);
    $viewers = (int)val("SELECT COUNT(DISTINCT user_id) FROM audit_log WHERE object_type='document' AND object_id=? AND action='view'", [$d['id']]);

    // Related (manual links) and similar (shared terms)
    $relIds = array_map('intval', array_column(all('SELECT related_id FROM document_links WHERE document_id=? UNION SELECT document_id FROM document_links WHERE related_id=?', [$d['id'], $d['id']]), 'related_id'));
    $related = $relIds ? hydrate_docs(all('SELECT ' . DOC_COLS . ' FROM documents d WHERE d.deleted_at IS NULL AND d.id IN (' . in_list($relIds) . ')'), $u) : [];
    $similar = [];
    $myTerms = array_map('intval', array_column(all('SELECT term_id FROM document_terms WHERE document_id=?', [$d['id']]), 'term_id'));
    if ($myTerms) {
        $cand = all('SELECT document_id, COUNT(*) n FROM document_terms WHERE term_id IN (' . in_list($myTerms) . ') AND document_id <> ? GROUP BY document_id ORDER BY n DESC LIMIT 30', [$d['id']]);
        $score = []; foreach ($cand as $c) $score[(int)$c['document_id']] = (int)$c['n'];
        $rows = $score ? all('SELECT ' . DOC_COLS . ' FROM documents d WHERE d.deleted_at IS NULL AND d.id IN (' . in_list(array_keys($score)) . ')') : [];
        foreach (hydrate_docs($rows, $u) as $s) { if (in_array($s['id'], $relIds, true)) continue; $s['shared'] = $score[$s['id']]; $similar[] = $s; }
        usort($similar, fn($a, $b) => $b['shared'] <=> $a['shared']);
        $similar = array_slice($similar, 0, 5);
    }

    // Auto-classification suggestions (only for people who can edit)
    $suggest = [];
    if ($lv >= LVL_CONTRIBUTE || (int)$d['owner_id'] === $u['id']) {
        $txt = (string)val('SELECT extracted_text FROM document_versions WHERE id=?', [$d['current_version_id']]);
        $tagged = array_flip($myTerms);
        foreach (suggest_terms($d['title'] . "\n" . $d['description'] . "\n" . mb_substr($txt, 0, 60000), 10) as $s) if (!isset($tagged[$s['id']])) $suggest[] = $s;
        $suggest = array_slice($suggest, 0, 6);
    }

    $preview = ['kind' => 'none'];
    $cur = null; foreach ($versions as $v) if ($v['id'] === $vv) $cur = $v;
    if ($cur) {
        $e = strtolower($cur['ext']);
        if (in_array($e, ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'], true)) $preview = ['kind' => 'image'];
        elseif ($e === 'pdf') $preview = ['kind' => 'pdf'];
        elseif (in_array($e, ['mp4', 'webm'], true)) $preview = ['kind' => 'video'];
        elseif (in_array($e, ['mp3', 'wav', 'm4a'], true)) $preview = ['kind' => 'audio'];
        else {
            $t = (string)val('SELECT LEFT(extracted_text, 20000) FROM document_versions WHERE id=?', [$vv]);
            if ($t !== '') $preview = ['kind' => 'text', 'text' => $t, 'extracted' => !in_array($e, ['txt', 'csv', 'md', 'log', 'json', 'xml'], true)];
        }
    }

    $pendingApproval = one("SELECT id FROM approvals WHERE document_id=? AND decision='pending' ORDER BY id DESC LIMIT 1", [$d['id']]);
    $lib = one('SELECT id, name, code, color, approval_required, approval_mode FROM libraries WHERE id=?', [$d['library_id']]);
    $path = [];
    $fid = $d['folder_id'] ? (int)$d['folder_id'] : null;
    while ($fid) { $f = one('SELECT id, name, parent_id FROM folders WHERE id=?', [$fid]); if (!$f) break; array_unshift($path, ['id' => (int)$f['id'], 'name' => $f['name']]); $fid = $f['parent_id'] ? (int)$f['parent_id'] : null; }

    update('documents', ['views' => (int)$d['views'] + 1], 'id=?', [$d['id']]);
    $lastView = val("SELECT created_at FROM audit_log WHERE user_id=? AND object_type='document' AND object_id=? AND action='view' ORDER BY id DESC LIMIT 1", [$u['id'], $d['id']]);
    if (!$lastView || strtotime((string)$lastView) < time() - 600) audit('view', 'document', (int)$d['id']);

    $isOwner = (int)$d['owner_id'] === $u['id'];
    $doc['can'] = [
        'edit' => $lv >= LVL_CONTRIBUTE, 'upload_version' => $lv >= LVL_CONTRIBUTE && (!$d['checked_out_by'] || (int)$d['checked_out_by'] === $u['id'] || $lv >= LVL_FULL),
        'approve' => $canApprove && $d['status'] === 'pending', 'submit' => ($isOwner || $lv >= LVL_CONTRIBUTE) && in_array($d['status'], ['draft', 'rejected'], true) && (int)$lib['approval_required'] === 1,
        'publish_direct' => $canApprove && $d['status'] !== 'published', 'delete' => ($isOwner && $lv >= LVL_CONTRIBUTE) || $lv >= LVL_FULL,
        'permissions' => $lv >= LVL_FULL, 'checkout' => $lv >= LVL_CONTRIBUTE, 'restore_version' => $lv >= LVL_CONTRIBUTE, 'move' => ($isOwner && $lv >= LVL_CONTRIBUTE) || $lv >= LVL_FULL,
        'cancel_request' => $d['status'] === 'pending' && ($isOwner || $lv >= LVL_FULL),
        'review' => $isOwner || $lv >= LVL_APPROVE || $canApprove,
        'classify' => $isOwner || $lv >= LVL_FULL || $canApprove,
    ];
    $doc['classification_rule'] = classification_rule((string)$d['confidentiality']);
    $doc['named_count'] = in_array($d['confidentiality'], ['restricted', 'confidential'], true)
        ? (int)val("SELECT COUNT(*) FROM permissions WHERE scope_type='document' AND scope_id=?", [$d['id']]) : 0;
    $rm = $d['content_type_id'] ? (int)val('SELECT review_months FROM content_types WHERE id=?', [$d['content_type_id']]) : 0;
    $doc['review_months'] = $rm;
    $doc['review_overdue'] = $d['review_date'] && $d['review_date'] < date('Y-m-d');  // overdue only after the due day has passed
    $doc['review_due_soon'] = $d['review_date'] && !$doc['review_overdue'] && $d['review_date'] <= date('Y-m-d', strtotime('+30 days'));
    $doc['last_reviewed'] = val("SELECT a.created_at FROM audit_log a WHERE a.object_type='document' AND a.object_id=? AND a.action='reviewed' ORDER BY a.id DESC LIMIT 1", [$d['id']]);
    $doc['description'] = (string)$d['description'];
    $doc['inherit'] = (int)$d['inherit'];
    $doc['downloads'] = (int)$d['downloads'];
    $doc['viewers'] = $viewers;
    $doc['published_version_id'] = $d['published_version_id'] ? (int)$d['published_version_id'] : null;
    $doc['current_version_id'] = (int)$d['current_version_id'];
    return ['doc' => $doc, 'versions' => $versions, 'props' => $props, 'free_terms' => $freeTerms, 'approvals' => $approvals, 'comments' => $comments,
        'activity' => $activity, 'related' => $related, 'similar' => $similar, 'suggest' => $suggest, 'preview' => $preview, 'library' => $lib, 'path' => $path,
        'pending_approval_id' => $pendingApproval ? (int)$pendingApproval['id'] : null, 'level_name' => LEVEL_NAMES[$lv],
        'ocr' => doc_ocr_info($d, $vv, $u)];
}

/* ================= Upload & versioning ================= */

function save_props(int $docId, $meta): void {
    if (!is_array($meta)) return;
    $fields = [];
    foreach (all('SELECT id, type, multi, termset_id FROM fields') as $f) $fields[(int)$f['id']] = $f;
    foreach ($meta as $fid => $val) {
        $fid = (int)$fid;
        if ($fid === 0) { // free-form enterprise terms
            q('DELETE FROM document_terms WHERE document_id=? AND field_id=0', [$docId]);
            foreach ((array)$val as $tid) if ((int)$tid) q('INSERT IGNORE INTO document_terms (document_id, term_id, field_id) VALUES (?,?,0)', [$docId, (int)$tid]);
            continue;
        }
        if (!isset($fields[$fid])) continue;
        $f = $fields[$fid];
        if ($f['type'] === 'term') {
            q('DELETE FROM document_terms WHERE document_id=? AND field_id=?', [$docId, $fid]);
            $ids = array_filter(array_map('intval', (array)$val));
            if (!(int)$f['multi']) $ids = array_slice($ids, 0, 1);
            if ($ids) {
                $valid = array_map('intval', array_column(all('SELECT id FROM terms WHERE id IN (' . in_list($ids) . ') AND termset_id=?', [$f['termset_id']]), 'id'));
                foreach ($valid as $tid) insert('document_terms', ['document_id' => $docId, 'term_id' => $tid, 'field_id' => $fid]);
            }
        } else {
            $v = is_array($val) ? '' : trim((string)$val);
            if ($f['type'] === 'number' && $v !== '' && !is_numeric($v)) continue;
            if ($f['type'] === 'date' && $v !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) continue;
            if ($f['type'] === 'bool') $v = $v ? '1' : '0';
            if ($v === '') q('DELETE FROM document_meta WHERE document_id=? AND field_id=?', [$docId, $fid]);
            else q('INSERT INTO document_meta (document_id, field_id, value) VALUES (?,?,?) ON DUPLICATE KEY UPDATE value=VALUES(value)', [$docId, $fid, mb_substr($v, 0, 2000)]);
        }
    }
}

function request_approval(array $d, int $verId, string $note = ''): void {
    q("UPDATE approvals SET decision='cancelled' WHERE document_id=? AND decision='pending'", [$d['id']]);
    insert('approvals', ['document_id' => $d['id'], 'version_id' => $verId, 'requested_by' => me()['id'], 'note' => mb_substr($note, 0, 1000)]);
    update('documents', ['status' => 'pending', 'updated_at' => now()], 'id=?', [$d['id']]);
    $d['status'] = 'pending';
    notify(approvers_for($d), 'approval_request', 'Approval needed: ' . $d['title'], me()['name'] . ' submitted ' . ($d['doc_number'] ?: 'a document') . ' for publishing.', '#/doc/' . $d['id']);
    audit('submit', 'document', (int)$d['id'], $d['title']);
}

/** Promotes a version to the next major and publishes it. */
function publish_version(array $d, int $verId, string $note = ''): string {
    $maxMajor = (int)val('SELECT COALESCE(MAX(major),0) FROM document_versions WHERE document_id=? AND minor=0', [$d['id']]);
    $v = one('SELECT major, minor FROM document_versions WHERE id=?', [$verId]);
    if ((int)$v['minor'] !== 0) { $maxMajor++; update('document_versions', ['major' => $maxMajor, 'minor' => 0], 'id=?', [$verId]); }
    else $maxMajor = (int)$v['major'];
    $upd = ['status' => 'published', 'published_version_id' => $verId, 'updated_at' => now()];
    if (!$d['review_date'] && $d['content_type_id']) {
        $months = (int)val('SELECT review_months FROM content_types WHERE id=?', [$d['content_type_id']]);
        if ($months) $upd['review_date'] = date('Y-m-d', strtotime("+$months months"));
    }
    update('documents', $upd, 'id=?', [$d['id']]);
    return "$maxMajor.0";
}

function api_docs_upload() {
    must_post();
    $u = me();
    if (empty($_FILES['file'])) fail('Choose a file to upload. If you did, it may exceed the server limit (' . ini_get('upload_max_filesize') . ').');
    $docId = iarg('document_id');
    $libId = iarg('library_id'); $folderId = iarg('folder_id') ?: null;
    $comment = sarg('comment', '', 500);
    $mode = sarg('submit', 'draft'); // draft | submit | publish
    $origName = basename((string)$_FILES['file']['name']);

    $d = null; $autoVersion = false;
    if ($docId) {
        $d = load_doc($docId);
        $libId = (int)$d['library_id']; $folderId = $d['folder_id'] ? (int)$d['folder_id'] : null;
    } else {
        if (!val('SELECT id FROM libraries WHERE id=? AND deleted_at IS NULL', [$libId])) fail('Choose a library to upload into.');
        if ($folderId && (int)val('SELECT library_id FROM folders WHERE id=?', [$folderId]) !== $libId) fail('That folder is not in this library.');
        // Same file name in the same place → new version of the existing document
        $existing = one('SELECT ' . DOC_COLS . ' FROM documents d JOIN document_versions v ON v.id=d.current_version_id
            WHERE d.library_id=? AND ' . ($folderId ? 'd.folder_id=?' : 'd.folder_id IS NULL') . ' AND d.deleted_at IS NULL AND LOWER(v.filename)=LOWER(?) LIMIT 1',
            $folderId ? [$libId, $folderId, $origName] : [$libId, $origName]);
        if ($existing && sarg('as_new') !== '1') { $d = $existing; $autoVersion = true; }
    }
    $lv = $d ? doc_level($d, $u) : container_level($libId, $folderId, $u);
    if ($lv < LVL_CONTRIBUTE) fail("You don't have permission to upload here. Ask an administrator for Contribute access.", 403);
    if ($d && $d['checked_out_by'] && (int)$d['checked_out_by'] !== $u['id'] && $lv < LVL_FULL) {
        fail('"' . $d['title'] . '" is checked out by ' . val('SELECT name FROM users WHERE id=?', [$d['checked_out_by']]) . '. You can upload a new version once it is checked in.', 409);
    }

    $file = store_upload($_FILES['file']);
    if ($d) {
        $curHash = (string)val('SELECT sha256 FROM document_versions WHERE id=?', [$d['current_version_id']]);
        if ($curHash === $file['sha256']) { @unlink($file['path']); fail('This file is identical to the current version of "' . $d['title'] . '". No new version was created.', 409); }
    }
    // Duplicate detection across the platform
    $dups = [];
    $dupRows = all('SELECT DISTINCT ' . DOC_COLS . ' FROM documents d JOIN document_versions v ON v.document_id=d.id WHERE v.sha256=? AND d.deleted_at IS NULL' . ($d ? ' AND d.id<>' . (int)$d['id'] : '') . ' LIMIT 5', [$file['sha256']]);
    foreach (hydrate_docs($dupRows, $u) as $x) $dups[] = ['id' => $x['id'], 'title' => $x['title'], 'library' => $x['library'], 'doc_number' => $x['doc_number']];

    $text = extract_text($file['path'], $file['ext']);
    $lib = one('SELECT * FROM libraries WHERE id=?', [$libId]);
    db()->beginTransaction();
    if (!$d) {
        $ctId = iarg('content_type_id') ?: null;
        $title = sarg('title', '', 255) ?: preg_replace('/[_]+/', ' ', pathinfo($origName, PATHINFO_FILENAME));
        $conf = in_array(sarg('confidentiality'), ['public', 'internal', 'confidential', 'restricted'], true) ? sarg('confidentiality') : 'internal';
        $review = clean_review_date(sarg('review_date'));
        $docId = insert('documents', ['library_id' => $libId, 'folder_id' => $folderId, 'title' => $title, 'description' => sarg('description', '', 4000),
            'keywords' => sarg('keywords', '', 500), 'content_type_id' => $ctId, 'confidentiality' => $conf, 'owner_id' => $u['id'], 'review_date' => $review,
            'doc_number' => sarg('doc_number', '', 64) ?: next_doc_number($libId, $ctId), 'inherit' => $conf === 'restricted' ? 0 : 1]);
        $major = 0; $minor = 1;
        $meta = arg('meta');
        if (is_string($meta)) $meta = json_decode($meta, true);
        $d = load_doc($docId);
        save_props($docId, $meta);
        $action = 'upload';
    } else {
        $docId = (int)$d['id'];
        $cur = one('SELECT major, minor FROM document_versions WHERE id=?', [$d['current_version_id']]);
        $major = (int)$cur['major']; $minor = (int)$cur['minor'] + 1;
        $action = 'new_version';
    }
    $verId = insert('document_versions', ['document_id' => $docId, 'major' => $major, 'minor' => $minor, 'filename' => $file['filename'], 'stored_name' => $file['stored_name'],
        'mime' => $file['mime'], 'ext' => $file['ext'], 'size' => $file['size'], 'sha256' => $file['sha256'], 'comment' => $comment, 'uploaded_by' => $u['id'], 'extracted_text' => $text]);
    $upd = ['current_version_id' => $verId, 'updated_at' => now(), 'status' => 'draft'];
    if ($d['checked_out_by'] && (int)$d['checked_out_by'] === $u['id']) { $upd['checked_out_by'] = null; $upd['checked_out_at'] = null; }
    update('documents', $upd, 'id=?', [$docId]);
    q("UPDATE approvals SET decision='cancelled' WHERE document_id=? AND decision='pending'", [$docId]);
    $d = load_doc($docId);
    reindex_doc($docId);
    audit($action, 'document', $docId, $d['title'] . ' · ' . ver_label($major, $minor) . ($comment ? " · $comment" : ''));

    $label = ver_label($major, $minor);
    $status = 'draft';
    $canApprove = can_approve_doc($d, $u);
    if (!(int)$lib['approval_required'] || ($mode === 'publish' && $canApprove)) {
        $label = publish_version($d, $verId);
        $status = 'published';
        if ((int)$lib['approval_required']) insert('approvals', ['document_id' => $docId, 'version_id' => $verId, 'requested_by' => $u['id'], 'decision' => 'approved',
            'decided_by' => $u['id'], 'decided_at' => now(), 'note' => 'Published directly by approver']);
        audit('publish', 'document', $docId, "Version $label");
        notify_followers($d, 'New version published: ' . $d['title'], "Version $label is now available.");
    } elseif ($mode === 'submit') {
        request_approval($d, $verId, $comment);
        $status = 'pending';
    }
    db()->commit();

    $suggest = array_slice(suggest_terms($d['title'] . "\n" . mb_substr($text, 0, 60000), 6), 0, 6);
    $needsOcr = ocr_needed($file['path'], $file['ext'], $text);
    return ['id' => $docId, 'version' => $label, 'version_id' => $verId, 'status' => $status, 'versioned' => $action === 'new_version', 'auto_versioned' => $autoVersion,
        'duplicates' => $dups, 'suggest' => $suggest, 'title' => $d['title'], 'indexed' => $text !== '' && !$needsOcr, 'needs_ocr' => $needsOcr, 'ext' => $file['ext']];
}

function notify_followers(array $d, string $title, string $body): void {
    $ids = array_map('intval', array_column(all('SELECT user_id FROM favorites WHERE document_id=?', [$d['id']]), 'user_id'));
    $ids = users_who_can_see(array_diff($ids, [(int)$d['owner_id']]), $d);
    notify($ids, 'doc_update', $title, $body, '#/doc/' . $d['id']);
}

function api_docs_update() {
    must_post();
    $u = me();
    $d = load_doc(iarg('id'));
    $lv = doc_level($d, $u);
    if ($lv < LVL_CONTRIBUTE) fail("You can't edit this document's properties.", 403);
    if ($d['checked_out_by'] && (int)$d['checked_out_by'] !== $u['id'] && $lv < LVL_FULL) fail('This document is checked out by someone else.', 409);
    $in = input();
    $data = [];
    if (array_key_exists('title', $in)) { $t = sarg('title', '', 255); if ($t === '') fail('A title is required.'); $data['title'] = $t; }
    if (array_key_exists('description', $in)) $data['description'] = sarg('description', '', 4000);
    if (array_key_exists('keywords', $in)) $data['keywords'] = sarg('keywords', '', 500);
    if (array_key_exists('content_type_id', $in)) $data['content_type_id'] = iarg('content_type_id') ?: null;
    $newConf = sarg('confidentiality');
    if (array_key_exists('confidentiality', $in) && in_array($newConf, ['public', 'internal', 'confidential', 'restricted'], true) && $newConf !== $d['confidentiality']) {
        if (!((int)$d['owner_id'] === $u['id'] || $lv >= LVL_FULL || can_approve_doc($d, $u)))
            fail('Only the author, an approver or someone with Full control can change the classification.', 403);
        $data['confidentiality'] = $newConf;
        if ($newConf === 'restricted') {
            // becomes visible to the author, admins and named people only
            $data['inherit'] = 0;
            q("DELETE FROM permissions WHERE scope_type='document' AND scope_id=?", [$d['id']]);
            if ((int)$d['owner_id'] !== $u['id'] && !is_admin($u))   // keep the person making the change in
                insert('permissions', ['scope_type' => 'document', 'scope_id' => $d['id'], 'principal_type' => 'user', 'principal_id' => (string)$u['id'], 'level' => LVL_FULL, 'created_by' => $u['id']]);
        } elseif ($d['confidentiality'] === 'restricted') {
            // leaving Restricted: back to the library's permissions
            $data['inherit'] = 1;
            q("DELETE FROM permissions WHERE scope_type='document' AND scope_id=?", [$d['id']]);
        }
        audit('classification', 'document', (int)$d['id'], ucfirst($d['confidentiality']) . ' → ' . ucfirst($newConf));
    }
    if (array_key_exists('review_date', $in)) {
        $newReview = clean_review_date(sarg('review_date'));
        // an unchanged existing date is kept as it is (even if it has passed); a new date must be in the future
        $data['review_date'] = sarg('review_date') === (string)$d['review_date'] ? $d['review_date'] : $newReview;
    }
    if (array_key_exists('doc_number', $in) && $lv >= LVL_FULL) $data['doc_number'] = sarg('doc_number', '', 64) ?: null;
    $data['updated_at'] = now();
    update('documents', $data, 'id=?', [$d['id']]);
    if (isset($in['meta'])) save_props((int)$d['id'], is_string($in['meta']) ? json_decode($in['meta'], true) : $in['meta']);
    if (isset($in['add_term'])) {
        $tid = (int)$in['add_term'];
        $fid = (int)val('SELECT f.id FROM fields f JOIN terms t ON t.termset_id=f.termset_id WHERE t.id=? ORDER BY f.sort LIMIT 1', [$tid]);
        q('INSERT IGNORE INTO document_terms (document_id, term_id, field_id) VALUES (?,?,?)', [$d['id'], $tid, $fid]);
    }
    reindex_doc((int)$d['id']);
    audit('edit_properties', 'document', (int)$d['id'], implode(', ', array_keys(array_diff_key($data, ['updated_at' => 1]))) ?: 'metadata');
    return [];
}

/* ================= Workflow ================= */

function api_docs_submit() {
    must_post();
    $u = me();
    $d = load_doc(iarg('id'));
    if (doc_level($d, $u) < LVL_CONTRIBUTE && (int)$d['owner_id'] !== $u['id']) fail("You can't submit this document.", 403);
    if ($d['status'] === 'pending') fail('This document is already waiting for approval.');
    if ($d['status'] === 'published') fail('The current version is already published. Upload a new version to start another review.');
    request_approval($d, (int)$d['current_version_id'], sarg('note', '', 1000));
    return ['message' => 'Sent for approval.'];
}

function decide(string $decision) {
    must_post();
    $u = me();
    $d = load_doc(iarg('id'));
    if (!can_approve_doc($d, $u)) fail('Only a department head (or someone with Approve permission) can approve this document.', 403);
    $note = sarg('note', '', 1000);
    if ($decision === 'reject' && $note === '') fail('Add a short note so the author knows what to change.');
    $a = one("SELECT * FROM approvals WHERE document_id=? AND decision='pending' ORDER BY id DESC LIMIT 1", [$d['id']]);
    db()->beginTransaction();
    if (!$a) {
        if ($decision === 'approve' && $d['status'] !== 'published') { // publish directly
            $aid = insert('approvals', ['document_id' => $d['id'], 'version_id' => $d['current_version_id'], 'requested_by' => $u['id']]);
            $a = one('SELECT * FROM approvals WHERE id=?', [$aid]);
        } else { db()->rollBack(); fail('There is no pending approval for this document.'); }
    }
    update('approvals', ['decision' => $decision === 'approve' ? 'approved' : 'rejected', 'decided_by' => $u['id'], 'decided_at' => now(), 'note' => $note], 'id=?', [$a['id']]);
    if ($decision === 'approve') {
        $label = publish_version($d, (int)$a['version_id']);
        audit('approve', 'document', (int)$d['id'], "Published version $label" . ($note ? " · $note" : ''));
        notify([(int)$d['owner_id'], (int)$a['requested_by']], 'approved', 'Approved and published: ' . $d['title'], "{$u['name']} approved version $label." . ($note ? " Note: $note" : ''), '#/doc/' . $d['id']);
        notify_followers($d, 'New version published: ' . $d['title'], "Version $label is now available.");
        $msg = "Published as version $label.";
    } else {
        update('documents', ['status' => 'rejected', 'updated_at' => now()], 'id=?', [$d['id']]);
        audit('reject', 'document', (int)$d['id'], $note);
        notify([(int)$d['owner_id'], (int)$a['requested_by']], 'rejected', 'Changes requested: ' . $d['title'], "{$u['name']}: $note", '#/doc/' . $d['id']);
        $msg = 'Returned to the author with your note.';
    }
    db()->commit();
    return ['message' => $msg];
}
function api_docs_approve() { return decide('approve'); }
function api_docs_reject() { return decide('reject'); }

function api_docs_cancel_request() {
    must_post();
    $u = me();
    $d = load_doc(iarg('id'));
    if ((int)$d['owner_id'] !== $u['id'] && doc_level($d, $u) < LVL_FULL) fail("You can't withdraw this request.", 403);
    q("UPDATE approvals SET decision='cancelled', decided_by=?, decided_at=? WHERE document_id=? AND decision='pending'", [$u['id'], now(), $d['id']]);
    update('documents', ['status' => 'draft'], 'id=?', [$d['id']]);
    audit('withdraw', 'document', (int)$d['id']);
    return [];
}

function api_docs_checkout() {
    must_post();
    $u = me();
    $d = load_doc(iarg('id'));
    $lv = doc_level($d, $u);
    $act = sarg('action', 'out');
    if ($act === 'out') {
        if ($lv < LVL_CONTRIBUTE) fail('You need Contribute access to check out.', 403);
        if ($d['checked_out_by'] && (int)$d['checked_out_by'] !== $u['id']) fail('Already checked out by ' . val('SELECT name FROM users WHERE id=?', [$d['checked_out_by']]) . '.', 409);
        update('documents', ['checked_out_by' => $u['id'], 'checked_out_at' => now()], 'id=?', [$d['id']]);
        audit('checkout', 'document', (int)$d['id']);
        return ['message' => 'Checked out to you. Others can read it but cannot upload changes until you check it in.'];
    }
    if (!$d['checked_out_by']) return [];
    if ((int)$d['checked_out_by'] !== $u['id'] && $lv < LVL_FULL) fail('Only the person who checked it out, or someone with Full control, can release it.', 403);
    update('documents', ['checked_out_by' => null, 'checked_out_at' => null], 'id=?', [$d['id']]);
    if ((int)$d['checked_out_by'] !== $u['id']) notify([(int)$d['checked_out_by']], 'checkout_released', "{$u['name']} released your check-out of {$d['title']}", '', '#/doc/' . $d['id']);
    audit($act === 'discard' ? 'discard_checkout' : 'checkin', 'document', (int)$d['id']);
    return ['message' => 'Checked in.'];
}

function api_docs_restore_version() {
    must_post();
    $u = me();
    $d = load_doc(iarg('id'));
    if (doc_level($d, $u) < LVL_CONTRIBUTE) fail("You can't restore versions of this document.", 403);
    $v = one('SELECT * FROM document_versions WHERE id=? AND document_id=?', [iarg('version_id'), $d['id']]);
    if (!$v) fail('Version not found.');
    $cur = one('SELECT major, minor FROM document_versions WHERE id=?', [$d['current_version_id']]);
    $new = insert('document_versions', ['document_id' => $d['id'], 'major' => (int)$cur['major'], 'minor' => (int)$cur['minor'] + 1, 'filename' => $v['filename'],
        'stored_name' => $v['stored_name'], 'mime' => $v['mime'], 'ext' => $v['ext'], 'size' => $v['size'], 'sha256' => $v['sha256'],
        'comment' => 'Restored from version ' . ver_label($v['major'], $v['minor']), 'uploaded_by' => $u['id'], 'extracted_text' => $v['extracted_text']]);
    update('documents', ['current_version_id' => $new, 'status' => 'draft', 'updated_at' => now()], 'id=?', [$d['id']]);
    reindex_doc((int)$d['id']);
    audit('restore_version', 'document', (int)$d['id'], 'From ' . ver_label($v['major'], $v['minor']));
    return ['message' => 'Restored as a new draft version. Submit it for approval to publish.'];
}

function api_docs_compare() {
    $u = me();
    $d = load_doc(iarg('id'));
    if (!sees_drafts($d, $u)) fail('Version comparison is available to editors and approvers.', 403);
    $a = one('SELECT id, major, minor, extracted_text FROM document_versions WHERE id=? AND document_id=?', [iarg('a'), $d['id']]);
    $b = one('SELECT id, major, minor, extracted_text FROM document_versions WHERE id=? AND document_id=?', [iarg('b'), $d['id']]);
    if (!$a || !$b) fail('Choose two versions to compare.');
    return ['a' => ['label' => ver_label($a['major'], $a['minor']), 'text' => mb_substr((string)$a['extracted_text'], 0, 60000)],
            'b' => ['label' => ver_label($b['major'], $b['minor']), 'text' => mb_substr((string)$b['extracted_text'], 0, 60000)]];
}

/* ================= Lifecycle ================= */

function api_docs_delete() {
    must_post();
    $u = me();
    $ids = array_filter(array_map('intval', (array)arg('ids', [iarg('id')])));
    $done = 0;
    foreach ($ids as $id) {
        $d = one('SELECT ' . DOC_COLS . ' FROM documents d WHERE d.id=? AND d.deleted_at IS NULL', [$id]);
        if (!$d) continue;
        $lv = doc_level($d, $u);
        if (!(((int)$d['owner_id'] === $u['id'] && $lv >= LVL_CONTRIBUTE) || $lv >= LVL_FULL)) continue;
        if ($d['checked_out_by'] && (int)$d['checked_out_by'] !== $u['id'] && $lv < LVL_FULL) continue;
        update('documents', ['deleted_at' => now(), 'deleted_by' => $u['id']], 'id=?', [$id]);
        audit('delete', 'document', $id, $d['title']);
        $done++;
    }
    if (!$done) fail("You can't delete the selected document(s). Only the author or someone with Full control can.", 403);
    return ['deleted' => $done, 'message' => $done === 1 ? 'Moved to the recycle bin.' : "$done documents moved to the recycle bin."];
}

function api_docs_recycle() {
    $u = me();
    $where = is_admin($u) ? '' : ' AND d.deleted_by = ' . (int)$u['id'];
    $rows = all('SELECT d.id, d.title, d.doc_number, d.deleted_at, l.name AS library, x.name AS deleted_by_name, v.filename, v.size,
        (SELECT COUNT(*) FROM document_versions WHERE document_id=d.id) AS versions
        FROM documents d JOIN libraries l ON l.id=d.library_id LEFT JOIN users x ON x.id=d.deleted_by LEFT JOIN document_versions v ON v.id=d.current_version_id
        WHERE d.deleted_at IS NOT NULL' . $where . ' ORDER BY d.deleted_at DESC LIMIT 500');
    return ['items' => $rows, 'retention_days' => (int)setting('recycle_days', 90)];
}

function api_docs_restore() {
    must_post();
    $u = me();
    $d = load_doc(iarg('id'), true);
    if (!$d['deleted_at']) return [];
    if (!is_admin($u) && (int)val('SELECT deleted_by FROM documents WHERE id=?', [$d['id']]) !== $u['id']) fail('Only the person who deleted it or an administrator can restore it.', 403);
    $folderOk = !$d['folder_id'] || val('SELECT id FROM folders WHERE id=? AND deleted_at IS NULL', [$d['folder_id']]);
    update('documents', ['deleted_at' => null, 'deleted_by' => null] + ($folderOk ? [] : ['folder_id' => null]), 'id=?', [$d['id']]);
    audit('restore', 'document', (int)$d['id'], $d['title']);
    return ['message' => 'Restored' . ($folderOk ? '.' : ' to the library root because its folder was deleted.')];
}

function purge_document(int $id): void {
    $vers = all('SELECT stored_name FROM document_versions WHERE document_id=?', [$id]);
    foreach ($vers as $v) {
        $others = (int)val('SELECT COUNT(*) FROM document_versions WHERE stored_name=? AND document_id<>?', [$v['stored_name'], $id]);
        if (!$others) @unlink(version_path($v));
    }
    foreach (['document_versions', 'document_meta', 'document_terms', 'approvals', 'comments', 'favorites'] as $t) q("DELETE FROM $t WHERE document_id=?", [$id]);
    q('DELETE FROM document_links WHERE document_id=? OR related_id=?', [$id, $id]);
    q("DELETE FROM permissions WHERE scope_type='document' AND scope_id=?", [$id]);
    q('DELETE FROM documents WHERE id=?', [$id]);
}

function api_docs_purge() {
    must_post();
    require_admin();
    $ids = array_filter(array_map('intval', (array)arg('ids', [iarg('id')])));
    if (sarg('expired') === '1') {
        $ids = array_map('intval', array_column(all('SELECT id FROM documents WHERE deleted_at IS NOT NULL AND deleted_at < DATE_SUB(NOW(), INTERVAL ? DAY)', [(int)setting('recycle_days', 90)]), 'id'));
    }
    foreach ($ids as $id) {
        $t = val('SELECT title FROM documents WHERE id=? AND deleted_at IS NOT NULL', [$id]);
        if ($t === null) continue;
        purge_document($id);
        audit('purge', 'document', $id, (string)$t);
    }
    return ['purged' => count($ids)];
}

function api_docs_move() {
    must_post();
    $u = me();
    $lib = iarg('library_id'); $folder = iarg('folder_id') ?: null;
    if ($folder && (int)val('SELECT library_id FROM folders WHERE id=?', [$folder]) !== $lib) fail('That folder is not in the chosen library.');
    if (container_level($lib, $folder, $u) < LVL_CONTRIBUTE) fail("You don't have Contribute access to the destination.", 403);
    $n = 0;
    foreach (array_filter(array_map('intval', (array)arg('ids', []))) as $id) {
        $d = one('SELECT ' . DOC_COLS . ' FROM documents d WHERE d.id=? AND d.deleted_at IS NULL', [$id]);
        if (!$d) continue;
        $lv = doc_level($d, $u);
        if (!(((int)$d['owner_id'] === $u['id'] && $lv >= LVL_CONTRIBUTE) || $lv >= LVL_FULL)) continue;
        update('documents', ['library_id' => $lib, 'folder_id' => $folder, 'updated_at' => now()], 'id=?', [$id]);
        audit('move', 'document', $id, 'To ' . val('SELECT name FROM libraries WHERE id=?', [$lib]) . ($folder ? ' / ' . val('SELECT name FROM folders WHERE id=?', [$folder]) : ''));
        $n++;
    }
    if (!$n) fail("You can't move the selected document(s).", 403);
    return ['moved' => $n, 'message' => $n === 1 ? 'Moved.' : "$n documents moved."];
}

/* ================= Social ================= */

function api_docs_favorite() {
    must_post();
    $u = me();
    $d = load_doc(iarg('id'));
    if (!visible_version($d, $u)) fail("You don't have access to this document.", 403);
    if (val('SELECT 1 FROM favorites WHERE user_id=? AND document_id=?', [$u['id'], $d['id']])) {
        q('DELETE FROM favorites WHERE user_id=? AND document_id=?', [$u['id'], $d['id']]);
        return ['favorite' => false];
    }
    insert('favorites', ['user_id' => $u['id'], 'document_id' => $d['id']]);
    return ['favorite' => true];
}

function api_docs_comment() {
    must_post();
    $u = me();
    $d = load_doc(iarg('id'));
    if (!visible_version($d, $u)) fail("You don't have access to this document.", 403);
    $body = sarg('body', '', 4000);
    if ($body === '') fail('Write a comment first.');
    $cid = insert('comments', ['document_id' => $d['id'], 'user_id' => $u['id'], 'body' => $body]);
    audit('comment', 'document', (int)$d['id'], mb_substr($body, 0, 120));
    $targets = [(int)$d['owner_id']];
    $mentioned = [];
    if (strpos($body, '@') !== false) {
        foreach (all('SELECT id, name FROM users WHERE active=1') as $p) {
            if (mb_stripos($body, '@' . $p['name']) !== false) $mentioned[] = (int)$p['id'];
        }
    }
    $mentioned = users_who_can_see($mentioned, $d);   // people who can't open the document aren't told about it
    notify($mentioned, 'mention', "{$u['name']} mentioned you on {$d['title']}", mb_substr($body, 0, 200), '#/doc/' . $d['id']);
    notify(array_diff($targets, $mentioned), 'comment', "{$u['name']} commented on {$d['title']}", mb_substr($body, 0, 200), '#/doc/' . $d['id']);
    return ['id' => $cid];
}

function api_docs_comment_delete() {
    must_post();
    $u = me();
    $c = one('SELECT * FROM comments WHERE id=?', [iarg('id')]);
    if (!$c) return [];
    if ((int)$c['user_id'] !== $u['id'] && !is_admin($u)) fail('You can only delete your own comments.', 403);
    q('DELETE FROM comments WHERE id=?', [$c['id']]);
    return [];
}

function api_docs_link() {
    must_post();
    $u = me();
    $a = load_doc(iarg('id')); $b = load_doc(iarg('related_id'));
    if (doc_level($a, $u) < LVL_CONTRIBUTE) fail("You can't edit links on this document.", 403);
    if (!visible_version($b, $u)) fail("You don't have access to that document.", 403);
    if ($a['id'] === $b['id']) fail('A document cannot be related to itself.');
    if (sarg('remove') === '1') q('DELETE FROM document_links WHERE (document_id=? AND related_id=?) OR (document_id=? AND related_id=?)', [$a['id'], $b['id'], $b['id'], $a['id']]);
    else q('INSERT IGNORE INTO document_links (document_id, related_id) VALUES (?,?)', [$a['id'], $b['id']]);
    audit('link', 'document', (int)$a['id'], $b['title']);
    return [];
}

/** Check whether a file name already exists in a container (upload dialog hint). */
function api_docs_check_names() {
    $lib = iarg('library_id'); $folder = iarg('folder_id') ?: null;
    $names = array_slice(array_map('strval', (array)arg('names', [])), 0, 200);
    if (!$names || container_level($lib, $folder) < LVL_READ) return ['existing' => []];
    $in = implode(',', array_fill(0, count($names), 'LOWER(?)'));
    $rows = all("SELECT d.id, d.title, LOWER(v.filename) fn, v.major, v.minor, d.checked_out_by FROM documents d JOIN document_versions v ON v.id=d.current_version_id
        WHERE d.library_id=? AND " . ($folder ? 'd.folder_id=?' : 'd.folder_id IS NULL') . " AND d.deleted_at IS NULL AND LOWER(v.filename) IN ($in)",
        array_merge($folder ? [$lib, $folder] : [$lib], $names));
    $out = [];
    foreach ($rows as $r) $out[$r['fn']] = ['id' => (int)$r['id'], 'title' => $r['title'], 'version' => ver_label($r['major'], $r['minor']), 'locked' => (bool)$r['checked_out_by']];
    return ['existing' => $out];
}

/** Text-based tag suggestions for a file before it is uploaded (title / name only). */
function api_docs_suggest() {
    return ['suggest' => suggest_terms(sarg('text', '', 4000), 8)];
}

/* ================= Text recognition (OCR) ================= */

/** Can this person save recognised text for the document? (authors, contributors, approvers) */
function can_save_ocr(array $d, array $u): bool {
    return (int)$d['owner_id'] === $u['id'] || doc_level($d, $u) >= LVL_CONTRIBUTE || can_approve_doc($d, $u);
}

function doc_ocr_info(array $d, int $versionId, array $u): array {
    $v = one('SELECT id, ext, stored_name, text_source, ocr_confidence, ocr_pages, ocr_at, extracted_text FROM document_versions WHERE id=?', [$versionId]);
    if (!$v) return ['needed' => false];
    $isOcr = $v['text_source'] === 'ocr';
    $needed = $v['text_source'] === '' && ocr_needed(version_path($v), (string)$v['ext'], (string)$v['extracted_text']);
    return ['needed' => $needed, 'source' => $v['text_source'], 'confidence' => $v['ocr_confidence'] !== null ? (int)$v['ocr_confidence'] : null,
        'pages' => $v['ocr_pages'] !== null ? (int)$v['ocr_pages'] : null, 'at' => $v['ocr_at'], 'version_id' => (int)$v['id'], 'ext' => $v['ext'],
        'can' => ($needed || $isOcr) && can_save_ocr($d, $u),
        'text' => $isOcr ? mb_substr((string)$v['extracted_text'], 0, 30000) : null];
}

/** Saves text recognised in the browser for one version. */
function api_docs_ocr_save() {
    must_post();
    $u = me();
    $d = load_doc(iarg('id'));
    if (!can_save_ocr($d, $u)) fail('Only the author, contributors or approvers can make this document searchable.', 403);
    $v = one('SELECT * FROM document_versions WHERE id=? AND document_id=?', [iarg('version_id'), $d['id']]);
    if (!$v) fail('Version not found.', 404);
    if ($v['text_source'] === 'native' || ($v['text_source'] === '' && !ocr_needed(version_path($v), (string)$v['ext'], (string)$v['extracted_text']))) {
        return ['message' => 'This version already has searchable text.', 'skipped' => true];
    }
    $text = clean_text((string)arg('text', ''));
    $pages = max(1, min(5000, iarg('pages', 1)));
    $conf = max(0, min(100, iarg('confidence', 0)));
    $ran = max(0, iarg('ocr_pages_run', $pages));           // pages that actually needed recognition
    $source = $ran > 0 ? 'ocr' : 'native';
    if ($source === 'native' && trim($text) === '') $text = (string)$v['extracted_text'];
    update('document_versions', ['extracted_text' => $text, 'text_source' => $source, 'ocr_confidence' => $conf, 'ocr_pages' => $pages, 'ocr_at' => now()], 'id=?', [$v['id']]);
    if ((int)$v['id'] === (int)$d['current_version_id']) reindex_doc((int)$d['id']);
    $words = str_word_count($text);
    if ($source === 'native') return ['words' => $words, 'message' => 'This file already had readable text on every page.'];
    audit('ocr', 'document', (int)$d['id'], "Version " . ver_label($v['major'], $v['minor']) . " · $ran of $pages page" . ($pages > 1 ? 's' : '') . " recognised · $words words · $conf% confidence");
    return ['words' => $words, 'message' => $words ? "Text recognised: $words words are now searchable." : 'No readable text was found in this file.'];
}

/** Admin: documents that still have no searchable text and can be processed. */
function api_docs_ocr_queue() {
    $u = require_admin();
    $in = "'" . implode("','", OCR_EXT) . "'";
    $rows = all("SELECT v.id AS version_id, v.major, v.minor, v.ext, v.size, v.stored_name, v.extracted_text, d.id, d.title, d.doc_number, l.name AS library,
            (v.id = d.current_version_id) AS is_current
        FROM document_versions v JOIN documents d ON (d.current_version_id = v.id OR d.published_version_id = v.id)
        JOIN libraries l ON l.id = d.library_id
        WHERE d.deleted_at IS NULL AND v.text_source = '' AND v.ext IN ($in)
          AND CHAR_LENGTH(COALESCE(v.extracted_text, '')) < 20000
        ORDER BY d.updated_at DESC LIMIT 1000");
    $out = []; $seen = [];
    foreach ($rows as $r) {
        if (isset($seen[$r['version_id']])) continue;
        $seen[$r['version_id']] = 1;
        if (!ocr_needed(version_path($r), (string)$r['ext'], (string)$r['extracted_text'])) continue;
        $out[] = ['id' => (int)$r['id'], 'version_id' => (int)$r['version_id'], 'title' => $r['title'], 'doc_number' => $r['doc_number'],
            'library' => $r['library'], 'ext' => $r['ext'], 'size' => (int)$r['size'], 'version' => ver_label($r['major'], $r['minor']), 'is_current' => (int)$r['is_current']];
    }
    $done = (int)val("SELECT COUNT(*) FROM document_versions WHERE text_source='ocr'");
    return ['items' => $out, 'done' => $done];
}

/* ================= Periodic review ================= */

/** A next-review date must be a real date after today; anything else means "no review date". */
function clean_review_date(string $v): ?string {
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) return null;
    [$y, $m, $dd] = array_map('intval', explode('-', $v));
    if (!checkdate($m, $dd, $y)) return null;
    if ($v <= date('Y-m-d')) fail('The next review date must be after today. Leave it empty if this document does not need a periodic review.');
    return $v;
}

/** Records that a document was reviewed and sets (or clears) the next review date. */
function api_docs_reviewed() {
    must_post();
    $u = me();
    $d = load_doc(iarg('id'));
    $isOwner = (int)$d['owner_id'] === $u['id'];
    if (!($isOwner || doc_level($d, $u) >= LVL_APPROVE || can_approve_doc($d, $u))) fail('Only the author or an approver can mark this document as reviewed.', 403);
    $next = sarg('next') === '' ? null : clean_review_date(sarg('next'));
    $note = sarg('note', '', 500);
    update('documents', ['review_date' => $next, 'updated_at' => now()], 'id=?', [$d['id']]);
    audit('reviewed', 'document', (int)$d['id'], ($next ? 'Next review ' . date('j M Y', strtotime($next)) : 'No further review scheduled') . ($note ? " · $note" : ''));
    return ['message' => $next ? 'Marked as reviewed. Next review on ' . date('j M Y', strtotime($next)) . '.' : 'Marked as reviewed. No further review is scheduled.'];
}
