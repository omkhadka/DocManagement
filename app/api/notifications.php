<?php
declare(strict_types=1);

function api_notifications_list() {
    $u = me();
    $rows = all('SELECT id, type, title, body, link, is_read, created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 60', [$u['id']]);
    foreach ($rows as &$r) { $r['id'] = (int)$r['id']; $r['is_read'] = (int)$r['is_read']; }
    return ['items' => $rows, 'unread' => (int)val('SELECT COUNT(*) FROM notifications WHERE user_id=? AND is_read=0', [$u['id']])];
}
function api_notifications_count() {
    $u = me();
    require_once KM_APP . '/api/approvals.php';
    return ['unread' => (int)val('SELECT COUNT(*) FROM notifications WHERE user_id=? AND is_read=0', [$u['id']]), 'approvals' => approvals_on() ? count(approval_queue($u)) : 0];
}
function api_notifications_read() {
    must_post();
    $u = me();
    if (arg('all')) q('UPDATE notifications SET is_read=1 WHERE user_id=?', [$u['id']]);
    else q('UPDATE notifications SET is_read=1 WHERE user_id=? AND id=?', [$u['id'], iarg('id')]);
    return [];
}
