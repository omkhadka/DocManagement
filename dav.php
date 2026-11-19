<?php
/**
 * A tiny WebDAV endpoint so Word, Excel and PowerPoint can open a document straight from the hub and save it back.
 *
 *   /dav/<token>/<file name>
 *
 * The token belongs to one open request for input and to the one person asked; it opens that one file and nothing
 * else, and stops working the moment the request is closed. Saves go to a working copy — never over a version.
 */
declare(strict_types=1);
require __DIR__ . '/app/bootstrap.php';
require KM_APP . '/lib.php';

header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
header('MS-Author-Via: DAV');
header('DAV: 1, 2');

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$path = (string)($_GET['p'] ?? '');
if ($path === '') {   // when the server passes the path instead of a query string
    $uri = rawurldecode(parse_url((string)($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH) ?? '');
    $pos = strpos($uri, '/dav/');
    $path = $pos === false ? '' : substr($uri, $pos + 5);
}
$parts = array_values(array_filter(explode('/', $path), fn($x) => $x !== ''));
$token = $parts[0] ?? '';
$isFile = count($parts) >= 2;

function dav_end(int $code, string $body = '', string $type = 'text/plain; charset=utf-8'): void {
    http_response_code($code);
    if ($body !== '') { header('Content-Type: ' . $type); header('Content-Length: ' . strlen($body)); echo $body; }
    exit;
}

// self-test used by Admin → Settings → Office editing: tells whether this server lets WebDAV methods through
if ($token === 'selftest') {
    header('X-KM-Dav: ok');
    header('Allow: OPTIONS, GET, HEAD, PUT, LOCK, UNLOCK, PROPFIND');
    if ($method === 'PUT') { $in = fopen('php://input', 'rb'); $n = 0; while ($in && !feof($in) && $n < 4096) $n += strlen((string)fread($in, 1024)); }
    dav_end(200, 'ok ' . $method);
}

if (!preg_match('/^[a-f0-9]{40}$/', $token)) dav_end(404, 'Not found.');
$r = one("SELECT * FROM input_requests WHERE dav_token=? AND status='open'", [$token]);
if (!$r) dav_end(404, 'This editing link has expired. The request for input was closed.');
$d = one('SELECT id, title, deleted_at, checked_out_by FROM documents WHERE id=?', [$r['document_id']]);
$who = one('SELECT * FROM users WHERE id=? AND active=1', [$r['assignee_id']]);
if (!$d || $d['deleted_at'] || !$who) dav_end(404, 'This document is no longer available.');
// the person must still be allowed to open the document
if (doc_level(load_doc((int)$d['id']), $who) < LVL_READ) dav_end(403, 'You no longer have access to this document.');
$v = one('SELECT filename, ext, mime FROM document_versions WHERE id=?', [$r['version_id']]);
$name = preg_replace('/[\\\\\/:*?"<>|#%]+/u', '_', (string)$v['filename']);
if ($isFile && rawurldecode($parts[1]) !== $name && $parts[1] !== $name) dav_end(404, 'Not found.');   // only this one file lives here

$f = input_file($r);
$etag = '"' . substr((string)$f['sha'], 0, 32) . '-' . $f['size'] . '"';
$base = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/') . '/dav/' . $token . '/';
$lockTimeout = 3600;

function dav_prop(string $href, bool $collection, array $f, array $v, string $etag, ?array $r): string {
    $lock = '';
    if ($r && $r['lock_token'] && strtotime((string)$r['lock_expires']) > time() && !$collection)
        $lock = '<D:lockdiscovery><D:activelock><D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope><D:depth>0</D:depth><D:timeout>Second-'
            . max(1, strtotime((string)$r['lock_expires']) - time()) . '</D:timeout><D:locktoken><D:href>' . htmlspecialchars($r['lock_token']) . '</D:href></D:locktoken></D:activelock></D:lockdiscovery>';
    $p = $collection
        ? '<D:resourcetype><D:collection/></D:resourcetype><D:displayname>input</D:displayname><D:getlastmodified>' . gmdate('D, d M Y H:i:s', $f['mtime']) . ' GMT</D:getlastmodified>'
        : '<D:resourcetype/><D:displayname>' . htmlspecialchars((string)$v['filename']) . '</D:displayname><D:getcontentlength>' . $f['size'] . '</D:getcontentlength>'
          . '<D:getcontenttype>' . htmlspecialchars((string)($v['mime'] ?: 'application/octet-stream')) . '</D:getcontenttype><D:getetag>' . htmlspecialchars($etag) . '</D:getetag>'
          . '<D:getlastmodified>' . gmdate('D, d M Y H:i:s', $f['mtime']) . ' GMT</D:getlastmodified><D:creationdate>' . gmdate('Y-m-d\TH:i:s\Z', $f['mtime']) . '</D:creationdate>'
          . '<D:supportedlock><D:lockentry><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockentry></D:supportedlock>' . $lock;
    return '<D:response><D:href>' . htmlspecialchars($href) . '</D:href><D:propstat><D:prop>' . $p . '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>';
}

switch ($method) {
    case 'OPTIONS':
        header('Allow: OPTIONS, GET, HEAD, PUT, LOCK, UNLOCK, PROPFIND');
        dav_end(200);

    case 'PROPFIND':
        $href = $base . ($isFile ? rawurlencode($name) : '');
        $xml = '<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">' . dav_prop($href, !$isFile, $f, $v, $etag, $r);
        if (!$isFile && ($_SERVER['HTTP_DEPTH'] ?? '1') !== '0') $xml .= dav_prop($base . rawurlencode($name), false, $f, $v, $etag, $r);
        dav_end(207, $xml . '</D:multistatus>', 'application/xml; charset=utf-8');

    case 'HEAD':
    case 'GET':
        if (!$isFile) dav_end(200, '');
        header('Content-Type: ' . ($v['mime'] ?: 'application/octet-stream'));
        header('Content-Length: ' . $f['size']);
        header('ETag: ' . $etag);
        header('Last-Modified: ' . gmdate('D, d M Y H:i:s', $f['mtime']) . ' GMT');
        http_response_code(200);
        if ($method === 'GET') readfile($f['path']);
        exit;

    case 'LOCK':
        if (!$isFile) dav_end(405);
        $held = $r['lock_token'] && strtotime((string)$r['lock_expires']) > time();
        $ifh = (string)($_SERVER['HTTP_IF'] ?? '');
        if ($held && $ifh !== '' && strpos($ifh, $r['lock_token']) === false) dav_end(423, 'Locked.');
        $lt = $held ? $r['lock_token'] : 'opaquelocktoken:' . bin2hex(random_bytes(16));
        update('input_requests', ['lock_token' => $lt, 'lock_expires' => date('Y-m-d H:i:s', time() + $lockTimeout)], 'id=?', [$r['id']]);
        header('Lock-Token: <' . $lt . '>');
        $body = (string)file_get_contents('php://input');
        $owner = preg_match('/<(?:\w+:)?owner>(.*?)<\/(?:\w+:)?owner>/s', $body, $m) ? $m[1] : '';
        dav_end(200, '<?xml version="1.0" encoding="utf-8"?><D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock><D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope>'
            . '<D:depth>0</D:depth>' . ($owner !== '' ? '<D:owner>' . strip_tags($owner, '<D:href><href>') . '</D:owner>' : '') . '<D:timeout>Second-' . $lockTimeout . '</D:timeout><D:locktoken><D:href>' . $lt . '</D:href></D:locktoken>'
            . '<D:lockroot><D:href>' . htmlspecialchars($base . rawurlencode($name)) . '</D:href></D:lockroot></D:activelock></D:lockdiscovery></D:prop>', 'application/xml; charset=utf-8');

    case 'UNLOCK':
        update('input_requests', ['lock_token' => null, 'lock_expires' => null], 'id=?', [$r['id']]);
        dav_end(204);

    case 'PUT':
        if (!$isFile) dav_end(405);
        // another application instance holding a different lock may not overwrite
        if ($r['lock_token'] && strtotime((string)$r['lock_expires']) > time()) {
            $ifh = (string)($_SERVER['HTTP_IF'] ?? '');
            if ($ifh !== '' && strpos($ifh, $r['lock_token']) === false) dav_end(423, 'Locked.');
        }
        $max = (int)setting('max_upload_mb', 100) * 1048576;
        $stored = bin2hex(random_bytes(16)) . '.' . strtolower((string)$v['ext']);
        $dir = storage_path('files/' . substr($stored, 0, 2));
        if (!is_dir($dir) && !@mkdir($dir, 0750, true)) dav_end(500, 'Storage is not writable.');
        $dest = "$dir/$stored";
        $in = fopen('php://input', 'rb'); $out = fopen($dest, 'wb'); $n = 0;
        while ($in && !feof($in)) { $buf = fread($in, 65536); if ($buf === false) break; $n += strlen($buf); if ($n > $max) { fclose($out); @unlink($dest); dav_end(413, 'The file is larger than the upload limit.'); } fwrite($out, $buf); }
        fclose($out); if ($in) fclose($in);
        $ext = strtolower((string)$v['ext']);
        // Office files are ZIP containers (or the old binary format) — anything else is refused
        $head = (string)file_get_contents($dest, false, null, 0, 8);
        $okFmt = in_array($ext, ['docx', 'xlsx', 'pptx', 'docm', 'xlsm', 'pptm', 'odt', 'ods', 'odp'], true) ? str_starts_with($head, "PK\x03\x04")
            : (in_array($ext, ['doc', 'xls', 'ppt'], true) ? str_starts_with($head, "\xD0\xCF\x11\xE0") : true);
        if ($n === 0 || !$okFmt) { @unlink($dest); dav_end(400, 'That is not a valid ' . strtoupper($ext) . ' file.'); }
        $old = $r['work_stored_name'];
        update('input_requests', ['work_stored_name' => $stored, 'work_size' => $n, 'work_sha256' => hash_file('sha256', $dest), 'work_saved_at' => now(), 'work_saves' => (int)$r['work_saves'] + 1], 'id=?', [$r['id']]);
        if ($old) @unlink(version_path(['stored_name' => $old]));
        // the audit trail keeps one line per editing session, not one per autosave
        $recent = val("SELECT id FROM audit_log WHERE user_id=? AND object_type='document' AND object_id=? AND action='input_save' AND created_at > DATE_SUB(NOW(), INTERVAL 30 MINUTE) LIMIT 1", [$who['id'], $d['id']]);
        if (!$recent) q("INSERT INTO audit_log (user_id, action, object_type, object_id, details, ip, created_at) VALUES (?, 'input_save', 'document', ?, 'Saved from Office', ?, NOW())", [$who['id'], $d['id'], client_ip()]);
        dav_end($old ? 204 : 201);

    case 'DELETE': case 'MOVE': case 'COPY': case 'MKCOL': case 'PROPPATCH':
        if ($method === 'PROPPATCH') dav_end(207, '<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:"><D:response><D:href>' . htmlspecialchars($base . rawurlencode($name)) . '</D:href><D:propstat><D:prop/><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>', 'application/xml; charset=utf-8');
        dav_end(403, 'Not allowed.');

    default:
        dav_end(405);
}
