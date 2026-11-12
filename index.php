<?php
declare(strict_types=1);
require __DIR__ . '/app/bootstrap.php';
start_session();
$site = htmlspecialchars((string)setting('site_name', 'TGISL Knowledge Hub'), ENT_QUOTES, 'UTF-8');
$v = KM_VERSION . '-' . substr((string)@filemtime(__DIR__ . '/assets/app.js'), -6);
header('X-Frame-Options: SAMEORIGIN');
header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'");
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0E2A3B">
<title><?= $site ?></title>
<link rel="icon" href="assets/brand/mark.png" type="image/png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wdth,wght@0,75..100,400..700;1,75..100,400..700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/app.css?v=<?= $v ?>">
</head>
<body>
<div id="app" aria-live="polite"><div class="boot"><div class="boot-mark"></div></div></div>
<div id="toasts" role="status"></div>
<script src="assets/qrcode.js?v=<?= $v ?>"></script>
<script src="assets/app.js?v=<?= $v ?>"></script>
</body>
</html>
