<?php
/** Streams document files after a permission check. ?id=DOC[&v=VERSION][&inline=1]  or  ?zip=1&ids=1,2,3 */
declare(strict_types=1);
require __DIR__ . '/app/bootstrap.php';
require KM_APP . '/lib.php';

function deny(string $msg, int $code = 403): void {
    http_response_code($code);
    header('Content-Type: text/plain; charset=utf-8');
    echo $msg;
    exit;
}

start_session();
$u = current_user();
if (!$u) deny('Sign in to download documents.', 401);
if (mfa_must_enroll($u)) deny('Set up two-step verification first, then try again.');

if (!empty($_GET['zip'])) {
    if (!class_exists('ZipArchive')) deny('ZIP downloads need the PHP zip extension.', 500);
    $ids = array_slice(array_filter(array_map('intval', explode(',', (string)($_GET['ids'] ?? '')))), 0, 300);
    $tmp = tempnam(is_dir(storage_path('tmp')) ? storage_path('tmp') : sys_get_temp_dir(), 'zip');
    $z = new ZipArchive();
    $z->open($tmp, ZipArchive::OVERWRITE);
    $used = []; $n = 0;
    foreach ($ids as $id) {
        $d = one('SELECT ' . DOC_COLS . ' FROM documents d WHERE d.id=? AND d.deleted_at IS NULL', [$id]);
        if (!$d) continue;
        $vid = visible_version($d, $u);
        if (!$vid) continue;
        $v = one('SELECT * FROM document_versions WHERE id=?', [$vid]);
        $p = version_path($v);
        if (!is_file($p)) continue;
        $name = $v['filename'];
        if (isset($used[strtolower($name)])) $name = pathinfo($name, PATHINFO_FILENAME) . " ({$d['id']})." . $v['ext'];
        $used[strtolower($name)] = 1;
        $z->addFile($p, $name);
        q('UPDATE documents SET downloads = downloads + 1 WHERE id=?', [$id]);
        $n++;
    }
    $z->close();
    if (!$n) { @unlink($tmp); deny('None of the selected documents can be downloaded.'); }
    audit('download_zip', 'document', null, "$n documents");
    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="TGISL-documents-' . date('Ymd-His') . '.zip"');
    header('Content-Length: ' . filesize($tmp));
    readfile($tmp);
    @unlink($tmp);
    exit;
}

$id = (int)($_GET['id'] ?? 0);
$d = one('SELECT ' . DOC_COLS . ' FROM documents d WHERE d.id=? AND d.deleted_at IS NULL', [$id]);
if (!$d) deny('This document no longer exists.', 404);
$visible = visible_version($d, $u);
if (!$visible) deny("You don't have access to this document.");
$vid = (int)($_GET['v'] ?? $visible);
$v = one('SELECT * FROM document_versions WHERE id=? AND document_id=?', [$vid, $id]);
if (!$v) deny('Version not found.', 404);
$seesDrafts = sees_drafts($d, $u);
if (!$seesDrafts && (int)$v['minor'] !== 0) deny('Draft versions are only available to editors and approvers.');
$path = version_path($v);
if (!is_file($path)) deny('The file is missing from storage. Ask an administrator to check the storage folder.', 410);

$inline = !empty($_GET['inline']);
$ext = strtolower($v['ext']);
$safeInline = ['pdf' => 'application/pdf', 'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'gif' => 'image/gif', 'webp' => 'image/webp',
    'svg' => 'image/svg+xml', 'bmp' => 'image/bmp', 'mp4' => 'video/mp4', 'webm' => 'video/webm', 'mp3' => 'audio/mpeg', 'wav' => 'audio/wav', 'm4a' => 'audio/mp4', 'txt' => 'text/plain; charset=utf-8'];
if ($inline && !isset($safeInline[$ext])) $inline = false;
$mime = $inline ? $safeInline[$ext] : ($v['mime'] ?: 'application/octet-stream');
if (in_array($ext, ['html', 'htm', 'svg', 'xml'], true) && !$inline) $mime = 'application/octet-stream';

if (!$inline) {
    q('UPDATE documents SET downloads = downloads + 1 WHERE id=?', [$id]);
    audit('download', 'document', $id, 'Version ' . ver_label($v['major'], $v['minor']));
}
session_write_close();

$size = filesize($path);
$start = 0; $end = $size - 1;
header('Accept-Ranges: bytes');
if (isset($_SERVER['HTTP_RANGE']) && preg_match('/bytes=(\d*)-(\d*)/', $_SERVER['HTTP_RANGE'], $m)) {
    if ($m[1] !== '') $start = (int)$m[1];
    if ($m[2] !== '') $end = min((int)$m[2], $size - 1);
    if ($m[1] === '' && $m[2] !== '') { $start = max(0, $size - (int)$m[2]); $end = $size - 1; }
    if ($start > $end || $start >= $size) { header("Content-Range: bytes */$size"); http_response_code(416); exit; }
    http_response_code(206);
    header("Content-Range: bytes $start-$end/$size");
}
$fname = $v['filename'];
$ascii = preg_replace('/[^\x20-\x7E]|["\\\\]/', '_', $fname);
header('Content-Type: ' . $mime);
header('Content-Length: ' . ($end - $start + 1));
header(($inline ? 'Content-Disposition: inline' : 'Content-Disposition: attachment') . "; filename=\"$ascii\"; filename*=UTF-8''" . rawurlencode($fname));
header('X-Content-Type-Options: nosniff');
header('Cache-Control: private, max-age=0');
if ($ext === 'svg') header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox");

$fh = fopen($path, 'rb');
fseek($fh, $start);
$left = $end - $start + 1;
while ($left > 0 && !feof($fh)) {
    $chunk = fread($fh, (int)min(1048576, $left));
    echo $chunk;
    $left -= strlen($chunk);
    flush();
}
fclose($fh);
