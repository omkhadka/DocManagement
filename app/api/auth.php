<?php
declare(strict_types=1);

function public_settings(): array {
    return [
        'site_name' => setting('site_name', 'TGISL Knowledge Hub'), 'org_name' => setting('org_name', ''),
        'welcome_text' => setting('welcome_text', ''), 'max_upload_mb' => (int)setting('max_upload_mb', 100),
        'allowed_ext' => allowed_ext(), 'version' => KM_VERSION,
        'server_upload_mb' => (int)min(ini_bytes(ini_get('upload_max_filesize')), ini_bytes(ini_get('post_max_size'))) / 1048576,
    ];
}
function ini_bytes($v): int {
    $v = trim((string)$v); if ($v === '') return PHP_INT_MAX;
    $n = (int)$v; $u = strtolower(substr($v, -1));
    return $u === 'g' ? $n * 1073741824 : ($u === 'm' ? $n * 1048576 : ($u === 'k' ? $n * 1024 : $n));
}

function api_auth_session() {
    $u = current_user();
    $out = ['user' => $u ? user_payload($u) : null, 'csrf' => $_SESSION['csrf'], 'settings' => public_settings()];
    if (!$u && ($p = mfa_pending())) $out['mfa'] = $p['mode'];
    return $out;
}

function user_payload(array $u): array {
    unset($u['active']);
    $u['is_admin'] = $u['role'] === 'admin';
    $u['is_head'] = $u['role'] === 'head';
    $u['unread'] = (int)val('SELECT COUNT(*) FROM notifications WHERE user_id=? AND is_read=0', [$u['id']]);
    $u['mfa_required'] = mfa_required_for_role($u['role']);
    $u['mfa_must_enroll'] = mfa_must_enroll($u);
    return $u;
}

/** Password + lock checks shared by sign-in. Returns the user row. */
function check_lock(array $u): void {
    if ($u['locked_until'] && strtotime($u['locked_until']) > time()) {
        fail('Too many failed attempts. Try again in ' . max(1, (int)ceil((strtotime($u['locked_until']) - time()) / 60)) . ' minutes.', 429);
    }
}
function count_failure(array $u, string $action): void {
    $n = (int)$u['failed_logins'] + 1;
    update('users', ['failed_logins' => $n, 'locked_until' => $n >= 5 ? date('Y-m-d H:i:s', time() + 900) : null], 'id=?', [$u['id']]);
    insert('audit_log', ['user_id' => $u['id'], 'action' => $action, 'object_type' => 'user', 'object_id' => $u['id'], 'ip' => client_ip()]);
    usleep(300000);
}

/** The half-finished sign-in waiting for a code (or for set-up), if any. */
function mfa_pending(): ?array {
    $uid = (int)($_SESSION['mfa_uid'] ?? 0);
    if (!$uid) return null;
    if (time() - (int)($_SESSION['mfa_at'] ?? 0) > MFA_PENDING_SECONDS) { unset($_SESSION['mfa_uid'], $_SESSION['mfa_at'], $_SESSION['mfa_mode'], $_SESSION['mfa_new_secret']); return null; }
    $u = one('SELECT * FROM users WHERE id=? AND active=1', [$uid]);
    if (!$u) return null;
    return ['user' => $u, 'mode' => (string)$_SESSION['mfa_mode']];
}

function complete_login(array $u, string $how = ''): array {
    session_regenerate_id(true);
    unset($_SESSION['mfa_uid'], $_SESSION['mfa_at'], $_SESSION['mfa_mode'], $_SESSION['mfa_new_secret'], $_SESSION['mfa_tries']);
    $_SESSION['uid'] = (int)$u['id'];
    $_SESSION['csrf'] = bin2hex(random_bytes(24));
    update('users', ['failed_logins' => 0, 'locked_until' => null, 'last_login' => now()], 'id=?', [$u['id']]);
    insert('audit_log', ['user_id' => $u['id'], 'action' => 'login', 'object_type' => 'user', 'object_id' => $u['id'], 'details' => $how, 'ip' => client_ip()]);
    current_user(true);
    return api_auth_session();
}

function api_auth_login() {
    must_post();
    $email = strtolower(sarg('email', '', 190));
    $pass = (string)arg('password', '');
    $u = one('SELECT * FROM users WHERE email = ?', [$email]);
    if ($u) check_lock($u);
    if (!$u || !password_verify($pass, $u['password_hash'])) {
        if ($u) count_failure($u, 'login_failed'); else usleep(300000);
        fail('Email or password is incorrect.', 401);
    }
    if (!$u['active']) fail('This account is deactivated. Contact your administrator.', 403);
    if (password_needs_rehash($u['password_hash'], PASSWORD_DEFAULT)) update('users', ['password_hash' => password_hash($pass, PASSWORD_DEFAULT)], 'id=?', [$u['id']]);

    if ((int)$u['mfa_enabled']) {
        if (mfa_device_trusted((int)$u['id'])) return complete_login($u, 'Password + trusted device');
        $mode = 'verify';
    } elseif (mfa_required_for_role($u['role'])) {
        $mode = 'enroll';
    } else {
        return complete_login($u, 'Password');
    }
    session_regenerate_id(true);
    $_SESSION['mfa_uid'] = (int)$u['id'];
    $_SESSION['mfa_at'] = time();
    $_SESSION['mfa_mode'] = $mode;
    $_SESSION['csrf'] = bin2hex(random_bytes(24));
    return ['user' => null, 'csrf' => $_SESSION['csrf'], 'settings' => public_settings(), 'mfa' => $mode,
        'name' => $u['name'], 'remember_days' => (int)setting('mfa_remember_days', 30)];
}

/** Second step of sign-in: 6-digit code from the app, or a recovery code. */
function api_auth_mfa_verify() {
    must_post();
    $p = mfa_pending();
    if (!$p || $p['mode'] !== 'verify') fail('Your sign-in timed out. Enter your email and password again.', 440);
    $u = $p['user'];
    check_lock($u);
    $code = trim(sarg('code', '', 40));
    $secret = mfa_decrypt($u['mfa_secret']);
    if ($secret === '') fail('Two-step verification is not set up correctly for this account. Ask an administrator to reset it.', 409);
    if (preg_match('/^\d[\d ]*$/', $code)) {
        $step = totp_verify($secret, $code, (int)$u['mfa_last_step']);
        if (!$step) {
            count_failure($u, 'mfa_failed');
            fail('That code is not correct or has expired. Enter the newest 6-digit code from your authenticator app.', 422);
        }
        update('users', ['mfa_last_step' => $step], 'id=?', [$u['id']]);
        $how = 'Password + authenticator code';
    } else {
        $left = mfa_use_recovery((int)$u['id'], $code);
        if ($left < 0) {
            count_failure($u, 'mfa_failed');
            fail('That recovery code is not valid or was already used.', 422);
        }
        $how = "Password + recovery code ($left left)";
        if ($left <= 3) insert('notifications', ['user_id' => $u['id'], 'type' => 'security', 'title' => "Only $left recovery codes left",
            'body' => 'Create new recovery codes from your profile so you are not locked out.', 'link' => '#/profile']);
    }
    if (arg('remember')) mfa_trust_device((int)$u['id']);
    return complete_login($u, $how);
}

/** Abandons a half-finished sign-in. */
function api_auth_mfa_cancel() {
    must_post();
    unset($_SESSION['mfa_uid'], $_SESSION['mfa_at'], $_SESSION['mfa_mode'], $_SESSION['mfa_new_secret']);
    return ['csrf' => $_SESSION['csrf']];
}

/** Who is setting up two-step verification: the signed-in user, or someone mid-sign-in who must enroll. */
function mfa_enrolling_user(): array {
    $u = current_user();
    if ($u) return one('SELECT * FROM users WHERE id=?', [$u['id']]);
    $p = mfa_pending();
    if ($p && $p['mode'] === 'enroll') return $p['user'];
    fail('Your session has ended. Sign in again.', 401);
}

function api_auth_mfa_setup_begin() {
    must_post();
    $u = mfa_enrolling_user();
    if ((int)$u['mfa_enabled']) fail('Two-step verification is already on for your account.');
    $secret = totp_new_secret();
    $_SESSION['mfa_new_secret'] = $secret;
    $_SESSION['mfa_tries'] = 0;
    return ['secret' => $secret, 'uri' => totp_uri($secret, $u['email']), 'account' => $u['email'],
        'issuer' => (string)setting('site_name', 'TGISL Knowledge Hub')];
}

function api_auth_mfa_setup_confirm() {
    must_post();
    $u = mfa_enrolling_user();
    $secret = (string)($_SESSION['mfa_new_secret'] ?? '');
    if ($secret === '') fail('Start the set-up again to get a new QR code.', 409);
    $_SESSION['mfa_tries'] = (int)($_SESSION['mfa_tries'] ?? 0) + 1;
    if ($_SESSION['mfa_tries'] > 8) { unset($_SESSION['mfa_new_secret']); fail('Too many wrong codes. Start the set-up again.', 429); }
    $step = totp_verify($secret, sarg('code', '', 20));
    if (!$step) fail("That code doesn't match. Check that your phone's time is set automatically, then enter the newest code.", 422);
    update('users', ['mfa_enabled' => 1, 'mfa_secret' => mfa_encrypt($secret), 'mfa_last_step' => $step, 'mfa_enabled_at' => now()], 'id=?', [$u['id']]);
    unset($_SESSION['mfa_new_secret'], $_SESSION['mfa_tries']);
    $codes = mfa_new_recovery_codes((int)$u['id']);
    insert('audit_log', ['user_id' => $u['id'], 'action' => 'mfa_enabled', 'object_type' => 'user', 'object_id' => $u['id'], 'ip' => client_ip()]);
    if (!current_user()) {
        if (arg('remember')) mfa_trust_device((int)$u['id']);
        return ['codes' => $codes] + complete_login($u, 'Password + new authenticator set-up');
    }
    return ['codes' => $codes];
}

function api_auth_mfa_status() {
    $u = me();
    $devices = all('SELECT id, user_agent, ip, created_at, last_used, expires_at FROM mfa_devices WHERE user_id=? AND expires_at > NOW() ORDER BY COALESCE(last_used, created_at) DESC', [$u['id']]);
    return ['enabled' => (int)val('SELECT mfa_enabled FROM users WHERE id=?', [$u['id']]), 'enabled_at' => val('SELECT mfa_enabled_at FROM users WHERE id=?', [$u['id']]),
        'required' => mfa_required_for_role($u['role']), 'recovery_left' => mfa_recovery_left($u['id']), 'devices' => $devices,
        'remember_days' => (int)setting('mfa_remember_days', 30)];
}

/** Checks a code for a signed-in user (for sensitive changes). */
function require_current_code(array $u): void {
    $row = one('SELECT mfa_secret, mfa_last_step FROM users WHERE id=?', [$u['id']]);
    $code = trim(sarg('code', '', 40));
    if (preg_match('/^\d[\d ]*$/', $code)) {
        $step = totp_verify(mfa_decrypt($row['mfa_secret']), $code, (int)$row['mfa_last_step']);
        if ($step) { update('users', ['mfa_last_step' => $step], 'id=?', [$u['id']]); return; }
    } elseif ($code !== '' && mfa_use_recovery($u['id'], $code) >= 0) return;
    fail('That code is not correct. Enter the newest 6-digit code from your authenticator app.', 422);
}

function api_auth_mfa_disable() {
    must_post();
    $u = me();
    if (mfa_required_for_role($u['role'])) fail('Your organisation requires two-step verification for your role, so it cannot be switched off.', 403);
    if (!password_verify((string)arg('password', ''), (string)val('SELECT password_hash FROM users WHERE id=?', [$u['id']]))) fail('Your password is incorrect.', 422);
    require_current_code($u);
    mfa_clear($u['id']);
    mfa_forget_devices($u['id']);
    audit('mfa_disabled', 'user', $u['id']);
    return ['message' => 'Two-step verification is off.'];
}

function api_auth_mfa_recovery_new() {
    must_post();
    $u = me();
    if (!(int)val('SELECT mfa_enabled FROM users WHERE id=?', [$u['id']])) fail('Turn on two-step verification first.');
    require_current_code($u);
    $codes = mfa_new_recovery_codes($u['id']);
    audit('mfa_recovery_new', 'user', $u['id']);
    return ['codes' => $codes];
}

function api_auth_mfa_devices_forget() {
    must_post();
    $u = me();
    mfa_forget_devices($u['id']);
    audit('mfa_devices_forget', 'user', $u['id']);
    return ['message' => 'Trusted devices removed. Every device will ask for a code at the next sign-in.'];
}

function api_auth_logout() {
    must_post();
    audit('logout', 'user', me()['id']);
    $_SESSION = [];
    session_regenerate_id(true);
    $_SESSION['csrf'] = bin2hex(random_bytes(24));
    return ['csrf' => $_SESSION['csrf']];
}

function api_auth_change_password() {
    must_post();
    $u = me();
    $cur = (string)arg('current', ''); $new = (string)arg('new', '');
    $hash = (string)val('SELECT password_hash FROM users WHERE id=?', [$u['id']]);
    if (!password_verify($cur, $hash)) fail('Your current password is incorrect.');
    if (strlen($new) < 8) fail('Use at least 8 characters for the new password.');
    update('users', ['password_hash' => password_hash($new, PASSWORD_DEFAULT), 'must_change_pw' => 0], 'id=?', [$u['id']]);
    audit('password_change', 'user', $u['id']);
    return ['message' => 'Password changed.'];
}

function api_auth_profile() {
    must_post();
    $u = me();
    update('users', ['name' => sarg('name', $u['name'], 120) ?: $u['name'], 'job_title' => sarg('job_title', '', 120), 'phone' => sarg('phone', '', 40)], 'id=?', [$u['id']]);
    return ['message' => 'Profile saved.'];
}
