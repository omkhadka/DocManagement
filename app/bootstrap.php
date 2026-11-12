<?php
/**
 * TGISL Knowledge Hub — core bootstrap
 * Loads config, opens the database, starts the session and provides helpers.
 */
declare(strict_types=1);

define('KM_VERSION', '1.3.2');
define('KM_DB_VERSION', 3);
define('KM_ROOT', dirname(__DIR__));
define('KM_APP', __DIR__);

error_reporting(E_ALL);
ini_set('display_errors', '0');

$cfgFile = KM_APP . '/config.php';
if (!is_file($cfgFile)) {
    if (PHP_SAPI !== 'cli' && basename($_SERVER['SCRIPT_NAME'] ?? '') !== 'install.php') {
        header('Location: install.php');
        exit;
    }
    $GLOBALS['KM_CONFIG'] = null;
} else {
    $GLOBALS['KM_CONFIG'] = require $cfgFile;
}

function cfg(string $key, $default = null) {
    $c = $GLOBALS['KM_CONFIG'] ?? [];
    return $c[$key] ?? $default;
}

date_default_timezone_set(cfg('timezone', 'Africa/Nairobi'));

function storage_path(string $sub = ''): string {
    $base = cfg('storage_path') ?: (KM_ROOT . '/storage');
    return rtrim($base, '/') . ($sub !== '' ? '/' . ltrim($sub, '/') : '');
}

/* ---------------- Database ---------------- */
function db(): PDO {
    static $pdo = null;
    if ($pdo) return $pdo;
    $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
        cfg('db_host', 'localhost'), (int)cfg('db_port', 3306), cfg('db_name'));
    $pdo = new PDO($dsn, cfg('db_user'), cfg('db_pass'), [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    $off = (new DateTime())->format('P');
    $pdo->exec("SET time_zone = '$off'");
    return $pdo;
}
function q(string $sql, array $p = []): PDOStatement {
    $st = db()->prepare($sql);
    $st->execute(array_values($p) === $p ? $p : $p);
    return $st;
}
function all(string $sql, array $p = []): array { return q($sql, $p)->fetchAll(); }
function one(string $sql, array $p = []): ?array { $r = q($sql, $p)->fetch(); return $r ?: null; }
function val(string $sql, array $p = []) { $r = q($sql, $p)->fetchColumn(); return $r === false ? null : $r; }
function insert(string $table, array $data): int {
    $cols = array_keys($data);
    $sql = "INSERT INTO `$table` (`" . implode('`,`', $cols) . "`) VALUES (" . implode(',', array_fill(0, count($cols), '?')) . ")";
    q($sql, array_values($data));
    return (int)db()->lastInsertId();
}
function update(string $table, array $data, string $where, array $wp = []): void {
    if (!$data) return;
    $set = implode(',', array_map(fn($c) => "`$c`=?", array_keys($data)));
    q("UPDATE `$table` SET $set WHERE $where", array_merge(array_values($data), $wp));
}
function in_list(array $ids): string {
    $ids = array_values(array_unique(array_map('intval', $ids)));
    return $ids ? implode(',', $ids) : '0';
}

/* ---------------- Settings ---------------- */
function setting(string $k, $default = null) {
    static $cache = null;
    if ($cache === null) {
        $cache = [];
        try { foreach (all('SELECT k, v FROM settings') as $r) $cache[$r['k']] = $r['v']; } catch (Throwable $e) {}
    }
    return $cache[$k] ?? $default;
}
function set_setting(string $k, $v): void {
    q('INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [$k, (string)$v]);
}

/* ---------------- Database upgrades ---------------- */
/** Brings an existing database up to the current version. Safe to run repeatedly. */
function km_migrate(): void {
    static $done = false;
    if ($done || !$GLOBALS['KM_CONFIG']) return;
    $done = true;
    if ((int)setting('db_version', 1) >= KM_DB_VERSION) return;
    $cols = array_column(all("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'"), 'COLUMN_NAME');
    $add = [
        'mfa_enabled' => 'TINYINT(1) NOT NULL DEFAULT 0', 'mfa_secret' => 'VARCHAR(255) NULL', 'mfa_recovery' => 'TEXT NULL',
        'mfa_last_step' => 'BIGINT NOT NULL DEFAULT 0', 'mfa_enabled_at' => 'DATETIME NULL',
    ];
    foreach ($add as $c => $def) if (!in_array($c, $cols, true)) db()->exec("ALTER TABLE users ADD COLUMN `$c` $def");
    db()->exec("CREATE TABLE IF NOT EXISTS mfa_devices (
        id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, selector CHAR(24) NOT NULL, token_hash CHAR(64) NOT NULL,
        user_agent VARCHAR(255) DEFAULT '', ip VARCHAR(64) DEFAULT '', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_used DATETIME NULL, expires_at DATETIME NOT NULL, UNIQUE KEY uq_mfa_sel (selector), KEY idx_mfa_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    // v3: text recognition (OCR) for picture-only PDFs and images
    $vcols = array_column(all("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'document_versions'"), 'COLUMN_NAME');
    $vadd = ['text_source' => "VARCHAR(8) NOT NULL DEFAULT ''", 'ocr_confidence' => 'TINYINT NULL', 'ocr_pages' => 'SMALLINT NULL', 'ocr_at' => 'DATETIME NULL'];
    foreach ($vadd as $c => $def) if (!in_array($c, $vcols, true)) db()->exec("ALTER TABLE document_versions ADD COLUMN `$c` $def");
    if (setting('mfa_policy') === null) set_setting('mfa_policy', 'optional');
    if (setting('mfa_remember_days') === null) set_setting('mfa_remember_days', '30');
    set_setting('db_version', (string)KM_DB_VERSION);
    try { insert('audit_log', ['action' => 'upgrade', 'object_type' => 'system', 'details' => 'Database upgraded to v' . KM_DB_VERSION . ' (two-step verification, text recognition)']); } catch (Throwable $e) {}
}

/* ---------------- Session & auth ---------------- */
function start_session(): void {
    if (session_status() === PHP_SESSION_ACTIVE) return;
    km_migrate();
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    session_name('TGISLKM');
    session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => $secure, 'httponly' => true, 'samesite' => 'Lax']);
    $dir = storage_path('sessions');
    if (is_dir($dir) && is_writable($dir)) session_save_path($dir);
    session_start();
    $idle = (int)setting('session_minutes', 240) * 60;
    if (!empty($_SESSION['uid']) && !empty($_SESSION['seen']) && time() - $_SESSION['seen'] > $idle) {
        $_SESSION = [];
        session_regenerate_id(true);
    }
    $_SESSION['seen'] = time();
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(24));
}

function current_user(bool $reload = false): ?array {
    static $u = false;
    if ($u !== false && !$reload) return $u;
    $u = null;
    if (!empty($_SESSION['uid'])) {
        $u = one('SELECT u.id, u.name, u.email, u.role, u.department_id, u.job_title, u.phone, u.active, u.must_change_pw, u.mfa_enabled,
                         d.name AS department, d.code AS department_code
                  FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ?', [$_SESSION['uid']]);
        if (!$u || !$u['active']) { $u = null; unset($_SESSION['uid']); }
        else {
            $u['id'] = (int)$u['id'];
            $u['mfa_enabled'] = (int)$u['mfa_enabled'];
            $u['must_change_pw'] = (int)$u['must_change_pw'];
            $u['department_id'] = $u['department_id'] !== null ? (int)$u['department_id'] : null;
            $u['groups'] = array_map('intval', array_column(all('SELECT group_id FROM group_members WHERE user_id = ?', [$u['id']]), 'group_id'));
        }
    }
    return $u;
}
function me(): array {
    $u = current_user();
    if (!$u) fail('Your session has ended. Sign in again.', 401);
    return $u;
}
function is_admin(?array $u = null): bool { $u = $u ?? current_user(); return $u && $u['role'] === 'admin'; }
function require_admin(): array { $u = me(); if (!is_admin($u)) fail('Only administrators can do this.', 403); return $u; }
function check_csrf(): void {
    $t = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($_POST['_csrf'] ?? '');
    if (!hash_equals($_SESSION['csrf'] ?? '', (string)$t)) fail('Security token expired. Reload the page and try again.', 419);
}

/* ---------------- Responses ---------------- */
function json_out($data, int $code = 200): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);
    exit;
}
function fail(string $msg, int $code = 400, array $extra = []): void {
    json_out(['ok' => false, 'error' => $msg] + $extra, $code);
}
function input(): array {
    static $in = null;
    if ($in !== null) return $in;
    $in = $_POST;
    $ct = $_SERVER['CONTENT_TYPE'] ?? '';
    if (stripos($ct, 'application/json') !== false) {
        $raw = file_get_contents('php://input');
        $j = json_decode($raw ?: '[]', true);
        if (is_array($j)) $in = $j;
    }
    return $in;
}
function arg(string $k, $default = null) {
    $in = input();
    if (array_key_exists($k, $in)) return $in[$k];
    return $_GET[$k] ?? $default;
}
function iarg(string $k, int $default = 0): int { $v = arg($k, $default); return is_numeric($v) ? (int)$v : $default; }
function sarg(string $k, string $default = '', int $max = 2000): string {
    $v = arg($k, $default);
    if (is_array($v)) return $default;
    return mb_substr(trim((string)$v), 0, $max);
}
function must_post(): void { if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') fail('This action needs a POST request.', 405); }
function client_ip(): string { return substr($_SERVER['REMOTE_ADDR'] ?? '', 0, 64); }

/* ---------------- Audit & notifications ---------------- */
function audit(string $action, string $type = '', ?int $id = null, string $details = ''): void {
    $u = current_user();
    insert('audit_log', [
        'user_id' => $u['id'] ?? null, 'action' => $action, 'object_type' => $type,
        'object_id' => $id, 'details' => mb_substr($details, 0, 1000), 'ip' => client_ip(),
    ]);
}
function notify(array $userIds, string $type, string $title, string $body = '', string $link = ''): void {
    $me = current_user()['id'] ?? 0;
    $userIds = array_unique(array_filter(array_map('intval', $userIds), fn($x) => $x && $x !== $me));
    if (!$userIds) return;
    foreach ($userIds as $uid) {
        insert('notifications', ['user_id' => $uid, 'type' => $type, 'title' => mb_substr($title, 0, 255), 'body' => mb_substr($body, 0, 500), 'link' => $link]);
    }
    if (setting('email_notifications', '0') === '1') {
        $from = setting('mail_from', 'no-reply@' . ($_SERVER['HTTP_HOST'] ?? 'localhost'));
        $site = setting('site_name', 'TGISL Knowledge Hub');
        $base = setting('base_url', '');
        foreach (all('SELECT email, name FROM users WHERE active = 1 AND id IN (' . in_list($userIds) . ')') as $r) {
            $msg = "Hello {$r['name']},\n\n$title\n" . ($body ? "\n$body\n" : '') . ($base && $link ? "\nOpen: " . rtrim($base, '/') . '/' . $link . "\n" : '') . "\n— $site";
            @mail($r['email'], "[$site] $title", $msg, "From: $site <$from>\r\nContent-Type: text/plain; charset=utf-8");
        }
    }
}

function now(): string { return date('Y-m-d H:i:s'); }
