<?php
/** Shared document domain helpers. */
declare(strict_types=1);

require_once __DIR__ . '/perm.php';
require_once __DIR__ . '/extract.php';
require_once __DIR__ . '/mfa.php';

function next_doc_number(int $libId, ?int $typeId): string {
    $lib = (string)val('SELECT code FROM libraries WHERE id=?', [$libId]);
    $type = $typeId ? (string)val('SELECT code FROM content_types WHERE id=?', [$typeId]) : 'GEN';
    $key = "$lib-$type";
    q('INSERT INTO doc_counters (k, n) VALUES (?, 1) ON DUPLICATE KEY UPDATE n = n + 1', [$key]);
    $n = (int)val('SELECT n FROM doc_counters WHERE k=?', [$key]);
    $pattern = setting('number_pattern', 'TGISL-{LIB}-{TYPE}-{SEQ}');
    return strtr($pattern, ['{LIB}' => $lib, '{TYPE}' => $type ?: 'GEN', '{SEQ}' => str_pad((string)$n, 4, '0', STR_PAD_LEFT),
        '{YYYY}' => date('Y'), '{YY}' => date('y')]);
}

function ver_label($major, $minor): string { return (int)$major . '.' . (int)$minor; }

function allowed_ext(): array {
    return array_filter(array_map('trim', explode(',', strtolower((string)setting('allowed_ext', 'pdf,docx,xlsx,pptx,txt')))));
}

/** Moves an uploaded file into storage. Returns file facts. */
function store_upload(array $f): array {
    if (($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        $map = [UPLOAD_ERR_INI_SIZE => 'The file is larger than the server upload limit (upload_max_filesize).',
            UPLOAD_ERR_FORM_SIZE => 'The file is too large.', UPLOAD_ERR_PARTIAL => 'The upload was interrupted. Try again.',
            UPLOAD_ERR_NO_FILE => 'Choose a file to upload.', UPLOAD_ERR_NO_TMP_DIR => 'The server has no temporary folder for uploads.',
            UPLOAD_ERR_CANT_WRITE => 'The server could not save the file.'];
        fail($map[$f['error'] ?? 4] ?? 'Upload failed.');
    }
    $name = basename(str_replace('\\', '/', (string)$f['name']));
    $name = preg_replace('/[\x00-\x1F<>:"|?*]/u', '_', $name) ?: 'file';
    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    if (!in_array($ext, allowed_ext(), true)) fail(".$ext files are not allowed. An administrator can change allowed file types in Settings.");
    $max = (int)setting('max_upload_mb', 100) * 1048576;
    if ($f['size'] > $max) fail('The file is larger than the ' . setting('max_upload_mb', 100) . ' MB limit.');
    $stored = bin2hex(random_bytes(16)) . ($ext ? ".$ext" : '');
    $dir = storage_path('files/' . substr($stored, 0, 2));
    if (!is_dir($dir) && !@mkdir($dir, 0750, true)) fail('Storage folder is not writable. Check permissions on the storage directory.', 500);
    $dest = "$dir/$stored";
    if (!move_uploaded_file($f['tmp_name'], $dest) && !(PHP_SAPI === 'cli' && rename($f['tmp_name'], $dest))) fail('Could not save the uploaded file.', 500);
    $mime = 'application/octet-stream';
    if (function_exists('finfo_open')) { $fi = finfo_open(FILEINFO_MIME_TYPE); $mime = finfo_file($fi, $dest) ?: $mime; finfo_close($fi); }
    $byExt = ['docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'pptx' => 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'xlsm' => 'application/vnd.ms-excel.sheet.macroEnabled.12',
        'doc' => 'application/msword', 'xls' => 'application/vnd.ms-excel', 'ppt' => 'application/vnd.ms-powerpoint', 'vsdx' => 'application/vnd.ms-visio.drawing',
        'dwg' => 'image/vnd.dwg', 'dxf' => 'image/vnd.dxf', 'msg' => 'application/vnd.ms-outlook', 'csv' => 'text/csv', 'md' => 'text/markdown'];
    if (isset($byExt[$ext])) $mime = $byExt[$ext];
    return ['filename' => $name, 'stored_name' => $stored, 'ext' => $ext, 'mime' => $mime, 'size' => filesize($dest),
        'sha256' => hash_file('sha256', $dest), 'path' => $dest];
}

function version_path(array $v): string { return storage_path('files/' . substr($v['stored_name'], 0, 2) . '/' . $v['stored_name']); }

/** Rebuilds the search index text for a document. */
function reindex_doc(int $docId): void {
    $d = one('SELECT current_version_id FROM documents WHERE id=?', [$docId]);
    if (!$d) return;
    $txt = (string)val('SELECT extracted_text FROM document_versions WHERE id=?', [$d['current_version_id']]);
    $meta = all('SELECT value FROM document_meta WHERE document_id=?', [$docId]);
    $terms = all('SELECT t.label, t.synonyms FROM document_terms dt JOIN terms t ON t.id=dt.term_id WHERE dt.document_id=?', [$docId]);
    $parts = [implode(' ', array_column($meta, 'value')), implode(' ', array_map(fn($t) => $t['label'] . ' ' . $t['synonyms'], $terms)),
        (string)val('SELECT filename FROM document_versions WHERE id=?', [$d['current_version_id']]), $txt];
    update('documents', ['search_text' => mb_substr(implode("\n", $parts), 0, 600000)], 'id=?', [$docId]);
}

/** Suggests term ids whose label or synonyms appear in the given text (auto-classification). */
function suggest_terms(string $text, int $limit = 12): array {
    $hay = ' ' . mb_strtolower(preg_replace('/[^\p{L}\p{N}&]+/u', ' ', $text)) . ' ';
    if (trim($hay) === '') return [];
    $scores = [];
    foreach (all('SELECT t.id, t.label, t.synonyms, t.termset_id, s.name AS termset FROM terms t JOIN termsets s ON s.id=t.termset_id WHERE t.deprecated=0') as $t) {
        $cands = array_merge([$t['label']], array_filter(array_map('trim', explode(',', (string)$t['synonyms']))));
        $hits = 0;
        foreach ($cands as $c) {
            $c = mb_strtolower(preg_replace('/\s*[–-]\s.*$/u', '', $c)); // "IFC – Issued for…" → "ifc"
            $c = trim(preg_replace('/[^\p{L}\p{N}&]+/u', ' ', $c));
            if (mb_strlen($c) < 3 && !in_array($c, ['mv', 'lv'], true)) continue;
            $hits += substr_count($hay, " $c ");
        }
        if ($hits) $scores[] = ['id' => (int)$t['id'], 'label' => $t['label'], 'termset_id' => (int)$t['termset_id'], 'termset' => $t['termset'], 'score' => $hits];
    }
    usort($scores, fn($a, $b) => $b['score'] <=> $a['score']);
    return array_slice($scores, 0, $limit);
}

/** Adds display info and per-user flags to raw document rows; drops rows the user can't see. */
function hydrate_docs(array $rows, ?array $u = null): array {
    $u = $u ?? me();
    if (!$rows) return [];
    $out = [];
    $verIds = [];
    foreach ($rows as $r) {
        $vv = visible_version($r, $u);
        if (!$vv) continue;
        $r['_vv'] = $vv;
        $verIds[] = $vv;
        $out[] = $r;
    }
    if (!$out) return [];
    $vers = [];
    foreach (all('SELECT id, major, minor, filename, ext, mime, size, created_at, uploaded_by FROM document_versions WHERE id IN (' . in_list($verIds) . ')') as $v) $vers[(int)$v['id']] = $v;
    $users = [];
    $uids = array_merge(array_column($out, 'owner_id'), array_column($out, 'checked_out_by'));
    foreach (all('SELECT id, name FROM users WHERE id IN (' . in_list(array_filter($uids)) . ')') as $x) $users[(int)$x['id']] = $x['name'];
    $types = [];
    foreach (all('SELECT id, name, code, color FROM content_types') as $t) $types[(int)$t['id']] = $t;
    $libs = [];
    foreach (all('SELECT id, name, code, color FROM libraries') as $l) $libs[(int)$l['id']] = $l;
    $favs = array_flip(array_map('intval', array_column(all('SELECT document_id FROM favorites WHERE user_id=?', [$u['id']]), 'document_id')));
    $ids = array_column($out, 'id');
    $termMap = [];
    foreach (all('SELECT dt.document_id, t.id, t.label FROM document_terms dt JOIN terms t ON t.id=dt.term_id WHERE dt.document_id IN (' . in_list($ids) . ')') as $t)
        $termMap[(int)$t['document_id']][] = ['id' => (int)$t['id'], 'label' => $t['label']];

    $res = [];
    foreach ($out as $r) {
        $v = $vers[$r['_vv']] ?? null;
        $lv = doc_level($r, $u);
        $isCurrent = (int)$r['_vv'] === (int)$r['current_version_id'];
        $res[] = [
            'id' => (int)$r['id'], 'title' => $r['title'], 'description' => (string)$r['description'], 'doc_number' => $r['doc_number'],
            'library_id' => (int)$r['library_id'], 'library' => $libs[(int)$r['library_id']]['name'] ?? '', 'library_color' => $libs[(int)$r['library_id']]['color'] ?? '',
            'folder_id' => $r['folder_id'] ? (int)$r['folder_id'] : null,
            'content_type_id' => $r['content_type_id'] ? (int)$r['content_type_id'] : null,
            'content_type' => $r['content_type_id'] ? ($types[(int)$r['content_type_id']]['name'] ?? '') : '',
            'content_type_color' => $r['content_type_id'] ? ($types[(int)$r['content_type_id']]['color'] ?? '') : '',
            'status' => $isCurrent ? $r['status'] : 'published', 'confidentiality' => $r['confidentiality'],
            'version' => $v ? ver_label($v['major'], $v['minor']) : '', 'version_id' => (int)$r['_vv'],
            'filename' => $v['filename'] ?? '', 'ext' => $v['ext'] ?? '', 'mime' => $v['mime'] ?? '', 'size' => (int)($v['size'] ?? 0),
            'modified' => $v['created_at'] ?? $r['updated_at'], 'created_at' => $r['created_at'],
            'owner_id' => (int)$r['owner_id'], 'owner' => $users[(int)$r['owner_id']] ?? '—',
            'checked_out_by' => $r['checked_out_by'] ? (int)$r['checked_out_by'] : null, 'checked_out_name' => $r['checked_out_by'] ? ($users[(int)$r['checked_out_by']] ?? '') : null,
            'review_date' => $r['review_date'], 'views' => (int)$r['views'], 'favorite' => isset($favs[(int)$r['id']]),
            'terms' => $termMap[(int)$r['id']] ?? [], 'level' => $lv, 'keywords' => (string)$r['keywords'],
            'has_newer_draft' => !$isCurrent,
        ] + (isset($r['_score']) ? ['score' => (float)$r['_score']] : []) + (isset($r['_snippet']) ? ['snippet' => $r['_snippet']] : []);
    }
    return $res;
}

const DOC_COLS = 'd.id, d.library_id, d.folder_id, d.title, d.description, d.doc_number, d.keywords, d.content_type_id, d.confidentiality, d.status,
    d.current_version_id, d.published_version_id, d.owner_id, d.checked_out_by, d.checked_out_at, d.review_date, d.inherit, d.views, d.downloads,
    d.created_at, d.updated_at';

function load_doc(int $id, bool $includeDeleted = false): array {
    $d = one('SELECT ' . DOC_COLS . ', d.deleted_at FROM documents d WHERE d.id=?' . ($includeDeleted ? '' : ' AND d.deleted_at IS NULL'), [$id]);
    if (!$d) fail('This document no longer exists or was moved to the recycle bin.', 404);
    return $d;
}

/** Text snippet around the first match of any query word. */
function make_snippet(string $text, array $words, int $len = 220): string {
    $text = preg_replace('/\s+/u', ' ', $text);
    $pos = false;
    foreach ($words as $w) { if ($w === '') continue; $p = mb_stripos($text, $w); if ($p !== false && ($pos === false || $p < $pos)) $pos = $p; }
    if ($pos === false) return mb_substr($text, 0, $len);
    $start = max(0, $pos - 70);
    if ($start > 0) { $sp = mb_strpos($text, ' ', $start); if ($sp !== false && $sp < $pos) $start = $sp + 1; } // begin on a whole word
    return ($start > 0 ? '… ' : '') . mb_substr($text, $start, $len) . (mb_strlen($text) > $start + $len ? ' …' : '');
}

function user_names(array $ids): array {
    $m = [];
    foreach (all('SELECT id, name FROM users WHERE id IN (' . in_list(array_filter($ids)) . ')') as $r) $m[(int)$r['id']] = $r['name'];
    return $m;
}

/** IDs of documents the user can see, limited to recent candidates for speed. */
function visible_doc_rows(string $where = '1=1', array $p = [], string $order = 'd.updated_at DESC', int $limit = 400): array {
    $rows = all('SELECT ' . DOC_COLS . " FROM documents d WHERE d.deleted_at IS NULL AND $where ORDER BY $order LIMIT $limit", $p);
    return hydrate_docs($rows);
}


/** Published Confidential / Restricted documents this user can't see, counted per library and per folder (to correct counts). */
function hidden_counts(?array $u = null): array {
    static $cache = [];
    $u = $u ?? me();
    if (isset($cache[$u['id']])) return $cache[$u['id']];
    $out = ['lib' => [], 'folder' => [], 'total' => 0];
    if ($u['role'] !== 'admin') {
        foreach (all('SELECT ' . DOC_COLS . " FROM documents d WHERE d.deleted_at IS NULL AND d.published_version_id IS NOT NULL
                AND d.confidentiality IN ('confidential','restricted')") as $d) {
            if (doc_level($d, $u) >= LVL_READ) continue;
            $out['lib'][(int)$d['library_id']] = ($out['lib'][(int)$d['library_id']] ?? 0) + 1;
            if ($d['folder_id']) $out['folder'][(int)$d['folder_id']] = ($out['folder'][(int)$d['folder_id']] ?? 0) + 1;
            $out['total']++;
        }
    }
    return $cache[$u['id']] = $out;
}
