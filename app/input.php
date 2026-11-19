<?php
/**
 * Requests for input.
 *
 * The owner of an Office document (or someone with Full control) asks ONE named person for input. Only that person
 * may then edit the file — in their own Word, Excel or PowerPoint, opened straight from the hub. Every save goes back
 * to a working copy; when they press "I'm done" the working copy becomes the next version. While the request is open
 * the document is checked out to them, so nobody else can change it.
 */
declare(strict_types=1);

const INPUT_EXT = ['docx' => 'ms-word', 'doc' => 'ms-word', 'docm' => 'ms-word', 'rtf' => 'ms-word', 'odt' => 'ms-word',
    'xlsx' => 'ms-excel', 'xls' => 'ms-excel', 'xlsm' => 'ms-excel', 'csv' => 'ms-excel', 'ods' => 'ms-excel',
    'pptx' => 'ms-powerpoint', 'ppt' => 'ms-powerpoint', 'pptm' => 'ms-powerpoint', 'odp' => 'ms-powerpoint'];
const INPUT_APP = ['ms-word' => 'Word', 'ms-excel' => 'Excel', 'ms-powerpoint' => 'PowerPoint'];

function input_open(int $docId): ?array {
    return one("SELECT r.*, a.name AS assignee, a.email AS assignee_email, b.name AS requester FROM input_requests r JOIN users a ON a.id=r.assignee_id JOIN users b ON b.id=r.requested_by
        WHERE r.document_id=? AND r.status='open' ORDER BY r.id DESC LIMIT 1", [$docId]);
}

function input_can_request(array $d, array $u, int $lv): bool {
    return (int)$d['owner_id'] === $u['id'] || $lv >= LVL_FULL || $u['role'] === 'admin';
}

/** The working copy (what the person last saved from Office), or the version they started from. */
function input_file(array $r): array {
    if ($r['work_stored_name']) return ['path' => version_path(['stored_name' => $r['work_stored_name']]), 'size' => (int)$r['work_size'], 'mtime' => strtotime((string)$r['work_saved_at']) ?: time(), 'sha' => $r['work_sha256']];
    $v = one('SELECT stored_name, size, sha256, created_at FROM document_versions WHERE id=?', [$r['version_id']]);
    return ['path' => version_path($v), 'size' => (int)$v['size'], 'mtime' => strtotime((string)$v['created_at']) ?: time(), 'sha' => $v['sha256']];
}

/** The link that opens the file in the desktop Office app ("ofe" = open for editing). */
function input_office_link(array $r, array $v): ?string {
    $scheme = INPUT_EXT[strtolower((string)$v['ext'])] ?? null;
    if (!$scheme) return null;
    $base = rtrim((string)setting('base_url', ''), '/');
    if ($base === '') $base = (is_https() ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
    $name = preg_replace('/[\\\\\/:*?"<>|#%]+/u', '_', (string)$v['filename']);
    return $scheme . ':ofe|u|' . $base . '/dav/' . $r['dav_token'] . '/' . rawurlencode($name);
}

/** Closes a request; when there is a saved working copy it becomes the next version. Returns the new version label or ''. */
function input_close(array $r, array $u, string $status, string $comment = ''): string {
    $label = '';
    db()->beginTransaction();
    $d = load_doc((int)$r['document_id']);
    if ($status === 'done' && $r['work_stored_name']) {
        $path = version_path(['stored_name' => $r['work_stored_name']]);
        $v = one('SELECT * FROM document_versions WHERE id=?', [$r['version_id']]);
        $cur = one('SELECT major, minor FROM document_versions WHERE id=?', [$d['current_version_id']]);
        $text = extract_text($path, (string)$v['ext']);
        $who = (string)val('SELECT name FROM users WHERE id=?', [$r['assignee_id']]);
        $new = insert('document_versions', ['document_id' => $d['id'], 'major' => (int)$cur['major'], 'minor' => (int)$cur['minor'] + 1, 'filename' => $v['filename'],
            'stored_name' => $r['work_stored_name'], 'mime' => $v['mime'], 'ext' => $v['ext'], 'size' => (int)$r['work_size'], 'sha256' => (string)$r['work_sha256'],
            'comment' => mb_substr('Input from ' . $who . ($comment !== '' ? ': ' . $comment : ''), 0, 500), 'uploaded_by' => (int)$r['assignee_id'], 'extracted_text' => $text]);
        update('documents', ['current_version_id' => $new, 'status' => approvals_on() ? 'draft' : $d['status'], 'updated_at' => now()], 'id=?', [$d['id']]);
        $label = ver_label($cur['major'], (int)$cur['minor'] + 1);
        if (!approvals_on()) $label = publish_version(load_doc((int)$d['id']), $new);
        else reindex_doc((int)$d['id']);
        update('input_requests', ['result_version_id' => $new], 'id=?', [$r['id']]);
    } elseif ($r['work_stored_name']) {
        @unlink(version_path(['stored_name' => $r['work_stored_name']]));   // cancelled: the unsaved draft goes
    }
    update('input_requests', ['status' => $status, 'closed_at' => now(), 'closed_by' => $u['id'], 'done_comment' => $comment !== '' ? mb_substr($comment, 0, 1000) : null, 'lock_token' => null], 'id=?', [$r['id']]);
    if ((int)$d['checked_out_by'] === (int)$r['assignee_id']) update('documents', ['checked_out_by' => null, 'checked_out_at' => null], 'id=?', [$d['id']]);
    db()->commit();
    return $label;
}
