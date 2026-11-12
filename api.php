<?php
/** JSON API router: api.php?r=module.action */
declare(strict_types=1);
require __DIR__ . '/app/bootstrap.php';
require KM_APP . '/lib.php';

set_exception_handler(function (Throwable $e) {
    error_log('[KM] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    $msg = cfg('debug') ? $e->getMessage() : 'Something went wrong on the server. The error has been logged.';
    fail($msg, 500);
});

start_session();
$route = preg_replace('/[^a-z_.]/', '', strtolower((string)($_GET['r'] ?? '')));
[$module, $action] = array_pad(explode('.', $route, 2), 2, '');
$modules = ['auth', 'dash', 'libraries', 'docs', 'approvals', 'search', 'taxonomy', 'users', 'admin', 'notifications'];
if (!in_array($module, $modules, true)) fail('Unknown request.', 404);
require KM_APP . "/api/$module.php";
$fn = "api_{$module}_{$action}";
if (!function_exists($fn)) fail('Unknown request.', 404);

$public = ['api_auth_session', 'api_auth_login', 'api_auth_mfa_verify', 'api_auth_mfa_cancel', 'api_auth_mfa_setup_begin', 'api_auth_mfa_setup_confirm'];
if ($_SERVER['REQUEST_METHOD'] === 'POST') check_csrf();
if (!in_array($fn, $public, true)) {
    $u = me();
    // Two-step verification is required for this role but not set up yet: only account routes are allowed.
    if (mfa_must_enroll($u) && $module !== 'auth') fail('Set up two-step verification to continue.', 403, ['code' => 'mfa_enroll']);
}
// Read-only requests don't change the session: release its lock now so the page's parallel requests run side by side
// instead of queueing (queued requests can be cut off by shared-hosting time limits).
if ($_SERVER['REQUEST_METHOD'] === 'GET' && $module !== 'auth') session_write_close();
$res = $fn();
json_out(['ok' => true] + (is_array($res) ? $res : ['data' => $res]));
