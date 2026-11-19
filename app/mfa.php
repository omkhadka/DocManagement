<?php
/**
 * Two-step verification (TOTP, RFC 6238) — works with Google Authenticator, Microsoft Authenticator, Authy, 1Password, etc.
 * Secrets are encrypted at rest with the app key from app/config.php.
 */
declare(strict_types=1);

const MFA_DIGITS = 6;
const MFA_PERIOD = 30;
const MFA_WINDOW = 1;            // accept the previous and next 30-second code (clock drift)
const MFA_PENDING_SECONDS = 600; // time allowed between password and code
const MFA_DEVICE_COOKIE = 'TGISLKM_TD';

/* ---------------- Base32 ---------------- */
function b32_encode(string $bin): string {
    $alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    $bits = '';
    foreach (str_split($bin) as $c) $bits .= str_pad(decbin(ord($c)), 8, '0', STR_PAD_LEFT);
    $out = '';
    foreach (str_split($bits, 5) as $chunk) $out .= $alpha[bindec(str_pad($chunk, 5, '0'))];
    return $out;
}
function b32_decode(string $s): string {
    $alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    $s = strtoupper(preg_replace('/[^A-Za-z2-7]/', '', $s));
    $bits = '';
    foreach (str_split($s) as $c) { $p = strpos($alpha, $c); if ($p === false) continue; $bits .= str_pad(decbin($p), 5, '0', STR_PAD_LEFT); }
    $out = '';
    foreach (str_split($bits, 8) as $byte) if (strlen($byte) === 8) $out .= chr(bindec($byte));
    return $out;
}

/* ---------------- TOTP ---------------- */
function totp_new_secret(): string { return b32_encode(random_bytes(20)); } // 160-bit, 32 characters

function totp_code(string $secretB32, int $step): string {
    $key = b32_decode($secretB32);
    $msg = pack('N*', 0) . pack('N*', $step); // 64-bit big-endian counter
    $h = hash_hmac('sha1', $msg, $key, true);
    $o = ord($h[19]) & 0xf;
    $num = ((ord($h[$o]) & 0x7f) << 24) | ((ord($h[$o + 1]) & 0xff) << 16) | ((ord($h[$o + 2]) & 0xff) << 8) | (ord($h[$o + 3]) & 0xff);
    return str_pad((string)($num % (10 ** MFA_DIGITS)), MFA_DIGITS, '0', STR_PAD_LEFT);
}

/** Returns the matched time step, or 0. Steps at or below $lastStep are refused (a code can be used once). */
function totp_verify(string $secretB32, string $code, int $lastStep = 0): int {
    $code = preg_replace('/\D/', '', $code);
    if (strlen($code) !== MFA_DIGITS) return 0;
    if (strlen(b32_decode($secretB32)) < 16) return 0;   // empty, corrupted or too-short secret: nothing can match
    $now = intdiv(time(), MFA_PERIOD);
    for ($i = -MFA_WINDOW; $i <= MFA_WINDOW; $i++) {
        $step = $now + $i;
        if ($step <= $lastStep) continue;
        if (hash_equals(totp_code($secretB32, $step), $code)) return $step;
    }
    return 0;
}

function totp_uri(string $secretB32, string $account): string {
    $issuer = (string)setting('mfa_issuer', '') ?: (string)setting('site_name', 'TGISL Knowledge Hub');
    $label = rawurlencode($issuer) . ':' . rawurlencode($account);
    return "otpauth://totp/$label?secret=$secretB32&issuer=" . rawurlencode($issuer) . '&algorithm=SHA1&digits=' . MFA_DIGITS . '&period=' . MFA_PERIOD;
}

/* ---------------- Encryption at rest ---------------- */
function mfa_key(): string {
    $k = (string)cfg('app_key', '');
    if ($k === '') $k = (string)cfg('db_pass', '') . '|' . (string)cfg('db_name', '') . '|tgisl-km';
    return hash('sha256', 'mfa|' . $k, true);
}
function mfa_encrypt(string $plain): string {
    if (!function_exists('openssl_encrypt')) fail('Two-step verification needs the PHP OpenSSL extension. Ask the host to enable it.', 500);
    $iv = random_bytes(12); $tag = '';
    $ct = openssl_encrypt($plain, 'aes-256-gcm', mfa_key(), OPENSSL_RAW_DATA, $iv, $tag);
    return 'v1:' . base64_encode($iv . $tag . $ct);
}
function mfa_decrypt(?string $stored): string {
    if (!$stored) return '';
    if (strncmp($stored, 'v1:', 3) !== 0) return '';
    $raw = (string)base64_decode(substr($stored, 3));
    $pt = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', mfa_key(), OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));
    return $pt === false ? '' : $pt;
}

/* ---------------- Recovery codes ---------------- */
function mfa_recovery_hash(string $code): string {
    return hash_hmac('sha256', strtolower(preg_replace('/[^a-z0-9]/i', '', $code)), mfa_key());
}
function mfa_new_recovery_codes(int $uid, int $n = 10): array {
    $alpha = 'abcdefghjkmnpqrstuvwxyz23456789';
    $codes = []; $hashes = [];
    for ($i = 0; $i < $n; $i++) {
        $c = '';
        for ($j = 0; $j < 8; $j++) $c .= $alpha[random_int(0, strlen($alpha) - 1)];
        $c = substr($c, 0, 4) . '-' . substr($c, 4);
        $codes[] = $c; $hashes[] = mfa_recovery_hash($c);
    }
    update('users', ['mfa_recovery' => json_encode($hashes)], 'id=?', [$uid]);
    return $codes;
}
/** Uses a recovery code if it matches. Returns remaining count, or -1 when it doesn't match. */
function mfa_use_recovery(int $uid, string $code): int {
    $list = json_decode((string)val('SELECT mfa_recovery FROM users WHERE id=?', [$uid]), true) ?: [];
    $h = mfa_recovery_hash($code);
    foreach ($list as $i => $x) {
        if (hash_equals($x, $h)) {
            array_splice($list, $i, 1);
            update('users', ['mfa_recovery' => json_encode(array_values($list))], 'id=?', [$uid]);
            return count($list);
        }
    }
    return -1;
}
function mfa_recovery_left(int $uid): int { return count(json_decode((string)val('SELECT mfa_recovery FROM users WHERE id=?', [$uid]), true) ?: []); }

/* ---------------- Policy ---------------- */
/** optional | privileged (admins + department heads) | all */
function mfa_policy(): string { $p = (string)setting('mfa_policy', 'optional'); return in_array($p, ['optional', 'privileged', 'all'], true) ? $p : 'optional'; }
function mfa_required_for_role(string $role): bool {
    $p = mfa_policy();
    return $p === 'all' || ($p === 'privileged' && in_array($role, ['admin', 'head'], true));
}
function mfa_must_enroll(?array $u): bool { return $u && !(int)($u['mfa_enabled'] ?? 0) && mfa_required_for_role($u['role']); }

/* ---------------- Trusted devices ---------------- */
function mfa_cookie_secure(): bool { return is_https(); }

function mfa_trust_device(int $uid): void {
    $days = (int)setting('mfa_remember_days', 30);
    if ($days <= 0) return;
    $sel = bin2hex(random_bytes(12)); $val = bin2hex(random_bytes(32));
    insert('mfa_devices', ['user_id' => $uid, 'selector' => $sel, 'token_hash' => hash('sha256', $val),
        'user_agent' => mb_substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255), 'ip' => client_ip(),
        'expires_at' => date('Y-m-d H:i:s', time() + $days * 86400)]);
    setcookie(MFA_DEVICE_COOKIE, "$sel.$val", ['expires' => time() + $days * 86400, 'path' => '/', 'secure' => mfa_cookie_secure(), 'httponly' => true, 'samesite' => 'Lax']);
}
function mfa_device_trusted(int $uid): bool {
    $c = (string)($_COOKIE[MFA_DEVICE_COOKIE] ?? '');
    if (!preg_match('/^([a-f0-9]{24})\.([a-f0-9]{64})$/', $c, $m)) return false;
    if ((int)setting('mfa_remember_days', 30) <= 0) return false;
    $row = one('SELECT id, token_hash FROM mfa_devices WHERE selector=? AND user_id=? AND expires_at > NOW()', [$m[1], $uid]);
    if (!$row || !hash_equals($row['token_hash'], hash('sha256', $m[2]))) return false;
    update('mfa_devices', ['last_used' => now()], 'id=?', [$row['id']]);
    return true;
}
/** Removes a person's remembered browsers without touching the cookie of whoever is making the request (admin actions). */
function mfa_drop_devices(int $uid): void { q('DELETE FROM mfa_devices WHERE user_id=?', [$uid]); }
function mfa_forget_devices(int $uid): void {
    q('DELETE FROM mfa_devices WHERE user_id=?', [$uid]);
    if (isset($_COOKIE[MFA_DEVICE_COOKIE])) setcookie(MFA_DEVICE_COOKIE, '', ['expires' => time() - 3600, 'path' => '/', 'secure' => mfa_cookie_secure(), 'httponly' => true, 'samesite' => 'Lax']);
}

/** Switches two-step verification off for a user and removes everything tied to it. */
function mfa_clear(int $uid): void {
    update('users', ['mfa_enabled' => 0, 'mfa_secret' => null, 'mfa_recovery' => null, 'mfa_last_step' => 0, 'mfa_enabled_at' => null], 'id=?', [$uid]);
    q('DELETE FROM mfa_devices WHERE user_id=?', [$uid]);
}
