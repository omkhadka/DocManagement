<?php
/**
 * Pure-PHP text extraction for search indexing and previews.
 * Handles Office Open XML (docx, xlsx, pptx), OpenDocument, PDF (text-based), and plain text formats.
 * Works on shared cPanel hosting — no shell tools required.
 */
declare(strict_types=1);

const EXTRACT_LIMIT = 400000; // characters kept per version
const EXTRACT_MAX_PART = 40 * 1048576; // never unpack a single part bigger than this (guards against "zip bombs")

/** Reads one entry of an Office/OpenDocument package, refusing oversized parts. */
function zip_part(ZipArchive $z, string $name) {
    $st = $z->statName($name);
    if (!$st || $st['size'] > EXTRACT_MAX_PART) return false;
    return $z->getFromName($name);
}

function extract_text(string $path, string $ext): string {
    $ext = strtolower($ext);
    try {
        switch ($ext) {
            case 'txt': case 'csv': case 'md': case 'log': case 'json': case 'xml': case 'tsv': case 'ini': case 'sql':
                $t = (string)file_get_contents($path, false, null, 0, EXTRACT_LIMIT * 2);
                $t = mb_convert_encoding($t, 'UTF-8', 'UTF-8, ISO-8859-1, Windows-1252');
                return clean_text($t);
            case 'html': case 'htm':
                return clean_text(html_entity_decode(strip_tags((string)file_get_contents($path)), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
            case 'docx': case 'dotx': return clean_text(ooxml_text($path, ['word/document.xml', 'word/header1.xml', 'word/footer1.xml'], 'w:p'));
            case 'pptx': return clean_text(ooxml_text($path, null, 'a:p', '#^ppt/slides/slide\d+\.xml$#'));
            case 'xlsx': return clean_text(xlsx_text($path));
            case 'odt': case 'ods': case 'odp': return clean_text(ooxml_text($path, ['content.xml'], 'text:p'));
            case 'pdf': return clean_text(pdf_text($path));
        }
    } catch (Throwable $e) {
        return '';
    }
    return '';
}

function clean_text(string $t): string {
    $t = preg_replace('/[^\P{C}\n\t]+/u', ' ', $t) ?? $t;
    $t = preg_replace("/[ \t]+/", ' ', $t) ?? $t;
    $t = preg_replace("/\n\s*\n+/", "\n\n", $t) ?? $t;
    return mb_substr(trim($t), 0, EXTRACT_LIMIT);
}

function ooxml_text(string $path, ?array $entries, string $paraTag, ?string $pattern = null): string {
    if (!class_exists('ZipArchive')) return '';
    $z = new ZipArchive();
    if ($z->open($path) !== true) return '';
    $names = [];
    if ($pattern) {
        for ($i = 0; $i < $z->numFiles; $i++) {
            $n = $z->getNameIndex($i);
            if (preg_match($pattern, $n)) $names[] = $n;
        }
        natsort($names);
    } else $names = $entries;
    $out = '';
    foreach ($names as $n) {
        $xml = zip_part($z, $n);
        if ($xml === false) continue;
        $xml = preg_replace('#</' . preg_quote($paraTag, '#') . '>#', "\n", $xml);
        $xml = preg_replace('#<(w:tab|w:br|a:br|text:tab|text:line-break)[^>]*/>#', ' ', $xml);
        $out .= html_entity_decode(strip_tags($xml), ENT_QUOTES | ENT_XML1, 'UTF-8') . "\n";
        if (strlen($out) > EXTRACT_LIMIT) break;
    }
    $z->close();
    return $out;
}

function xlsx_text(string $path): string {
    if (!class_exists('ZipArchive')) return '';
    $z = new ZipArchive();
    if ($z->open($path) !== true) return '';
    $out = '';
    $ss = zip_part($z, 'xl/sharedStrings.xml');
    if ($ss !== false) {
        $ss = preg_replace('#</si>#', "\n", $ss);
        $out .= html_entity_decode(strip_tags($ss), ENT_QUOTES | ENT_XML1, 'UTF-8');
    }
    for ($i = 0; $i < $z->numFiles && strlen($out) < EXTRACT_LIMIT; $i++) {
        $n = $z->getNameIndex($i);
        if (preg_match('#^xl/worksheets/sheet\d+\.xml$#', $n)) {
            $x = zip_part($z, $n);
            if ($x === false) continue;
            if (preg_match_all('#<is>(.*?)</is>|<v>([^<]*)</v>#s', $x, $m)) {
                foreach ($m[0] as $k => $_) {
                    $v = $m[1][$k] !== '' ? strip_tags($m[1][$k]) : $m[2][$k];
                    if ($m[1][$k] !== '' || !ctype_digit($v)) $out .= $v . ' ';
                }
            }
        }
    }
    $z->close();
    return $out;
}

/** Lightweight PDF text extractor for text-based PDFs (scanned PDFs return little or nothing). */
function pdf_text(string $path): string {
    $data = @file_get_contents($path);
    if ($data === false) return '';
    $out = '';
    if (!preg_match_all('#stream\r?\n(.*?)\r?\nendstream#s', $data, $streams, PREG_OFFSET_CAPTURE)) return '';
    foreach ($streams[1] as $s) {
        $raw = $s[0];
        $dictStart = max(0, $s[1] - 400);
        $dict = substr($data, $dictStart, $s[1] - $dictStart);
        if (preg_match('#/Subtype\s*/Image#', $dict)) continue;
        $dec = $raw;
        if (strpos($dict, 'FlateDecode') !== false) {
            $dec = @gzuncompress($raw, EXTRACT_MAX_PART);
            if ($dec === false) $dec = @gzinflate(substr($raw, 2), EXTRACT_MAX_PART);
            if ($dec === false) continue;
        }
        if (strpos($dec, 'BT') === false) continue;
        $out .= pdf_ops_text($dec) . "\n";
        if (strlen($out) > EXTRACT_LIMIT) break;
    }
    return $out;
}

function pdf_ops_text(string $c): string {
    $out = '';
    preg_match_all('#BT(.*?)ET#s', $c, $blocks);
    foreach ($blocks[1] as $b) {
        preg_match_all('#(\[(?:[^\]\\\\]|\\\\.)*\]\s*TJ|\((?:[^)\\\\]|\\\\.)*\)\s*(?:Tj|\'|")|T\*|Td|TD|Tm)#s', $b, $ops);
        $line = '';
        foreach ($ops[1] as $op) {
            if ($op === 'T*' || $op === 'Td' || $op === 'TD' || $op === 'Tm') { $line .= ' '; continue; }
            if ($op[0] === '[') {
                preg_match_all('#\((?:[^)\\\\]|\\\\.)*\)|-?\d+\.?\d*#', $op, $parts);
                foreach ($parts[0] as $p) {
                    if ($p[0] === '(') $line .= pdf_unescape(substr($p, 1, -1));
                    elseif ((float)$p < -200) $line .= ' ';
                }
            } else {
                $end = strrpos($op, ')');
                $line .= pdf_unescape(substr($op, 1, $end - 1));
            }
        }
        $out .= $line . "\n";
    }
    return $out;
}

function pdf_unescape(string $s): string {
    $s = preg_replace_callback('#\\\\([0-7]{1,3})#', fn($m) => chr(octdec($m[1]) & 255), $s);
    $s = strtr($s, ['\\n' => "\n", '\\r' => ' ', '\\t' => ' ', '\\(' => '(', '\\)' => ')', '\\\\' => '\\']);
    if (!mb_check_encoding($s, 'UTF-8')) $s = mb_convert_encoding($s, 'UTF-8', 'Windows-1252');
    return $s;
}

/* ---------------- Text recognition (OCR) support ---------------- */
const OCR_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'];

function pdf_page_count(string $path): int {
    $data = @file_get_contents($path, false, null, 0, 20 * 1048576);
    if ($data === false) return 1;
    $n = preg_match_all('#/Type\s*/Page(?![a-zA-Z])#', $data);
    return max(1, (int)$n);
}

/**
 * True when a file has (almost) no readable text and should be read with OCR:
 * images always; PDFs when there are fewer than ~100 letters per page (scans, pictures pasted into Word, etc.).
 */
function ocr_needed(string $path, string $ext, string $text): bool {
    $ext = strtolower($ext);
    if (!in_array($ext, OCR_EXT, true)) return false;
    $chars = strlen(preg_replace('/\s+/u', '', $text));
    if ($ext !== 'pdf') return $chars < 20;
    if ($chars >= 4000) return false;
    return $chars < 100 * pdf_page_count($path);
}
