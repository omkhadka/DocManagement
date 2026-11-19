<?php
/**
 * Toto — the built-in document assistant (no external AI service, nothing leaves the server).
 *
 *  - keyword vectors (TF-IDF) per document      → similar documents, learned tag / content-type suggestions
 *  - MinHash fingerprints                          → near-duplicate detection
 *  - extractive summary (sentence scoring)        → "Key points" on the document page
 *  - pattern checks                                → sensitive-data warning with a suggested classification
 *  - heading / label extraction                    → suggested title, document number, revision and date
 *
 * Everything here is plain PHP and runs on ordinary shared hosting.
 */
declare(strict_types=1);

if (!function_exists('str_starts_with')) {   // PHP 7.4
    function str_starts_with(string $h, string $n): bool { return strncmp($h, $n, strlen($n)) === 0; }
}
if (!function_exists('str_ends_with')) {   // PHP 7.4
    function str_ends_with(string $h, string $n): bool { return $n === '' || substr($h, -strlen($n)) === $n; }
}

const AI_TEXT_LIMIT = 150000;   // characters analysed per document
const AI_VECTOR_SIZE = 80;      // tokens kept per document
const AI_MINHASH_K = 64;        // hash functions in a fingerprint
const AI_MAX_CORPUS = 6000;     // documents compared at most

function ai_on(): bool { return setting('ai_enabled', '1') === '1'; }

/* ---------------- Text basics ---------------- */

function ai_stopwords(): array {
    static $s = null;
    if ($s === null) $s = array_flip(explode(' ', 'the and for are but not you all any can her was one our out day get has him his how man new now old see two way who boy did its let put say she too use that with have this will your from they know want been good much some time very when come here just like long make many more only over such take than them well were what which their there would about could other into these those then also shall should must may might upon each where after before being does done doing within without while whom whose why yes per via under above below between through during again further once both few most same own off nor than too very hereby herein thereof therein shall page date note notes item items total yes amp nbsp etc ref see sheet rev revision document doc no number name title dear sir madam regards kind best please thank thanks attached attachment copy cc from sent subject'));
    return $s;
}

/** Light stemming: folds plurals so "pumps" and "pump" count as one word. */
function ai_stem(string $w): string {
    $n = strlen($w);
    if ($n > 4 && str_ends_with($w, 'ies')) return substr($w, 0, -3) . 'y';
    if ($n > 4 && str_ends_with($w, 'sses')) return substr($w, 0, -2);
    if ($n > 3 && str_ends_with($w, 's') && !str_ends_with($w, 'ss') && !str_ends_with($w, 'us') && !str_ends_with($w, 'is')) return substr($w, 0, -1);
    return $w;
}

/** Words (lower-case, 3+ characters, starting with a letter) with stop words removed and plurals folded. */
function ai_tokens(string $text, bool $keepStop = false): array {
    $text = mb_strtolower(mb_substr($text, 0, AI_TEXT_LIMIT));
    if (!preg_match_all('/\p{L}[\p{L}\p{N}]{2,}/u', $text, $m)) return [];
    $stop = ai_stopwords();
    $out = [];
    foreach ($m[0] as $w) {
        if (mb_strlen($w) > 40) continue;
        if (!$keepStop && isset($stop[$w])) continue;
        $out[] = ai_stem($w);
    }
    return $out;
}

/** Term frequencies for a document; the title and keywords count three times. */
function ai_tf(string $title, string $body): array {
    $tf = [];
    foreach (ai_tokens($title) as $t) $tf[$t] = ($tf[$t] ?? 0) + 3;
    foreach (ai_tokens($body) as $t) $tf[$t] = ($tf[$t] ?? 0) + 1;
    return $tf;
}

function ai_corpus_size(): int {
    static $n = null;
    if ($n === null) $n = (int)val('SELECT COUNT(*) FROM ai_index');
    return $n;
}

/** Inverse document frequency for a list of tokens. */
function ai_idf(array $tokens): array {
    $tokens = array_values(array_unique(array_map('strval', $tokens)));
    $N = ai_corpus_size();
    $df = [];
    foreach (array_chunk($tokens, 500) as $chunk) {
        foreach (all('SELECT token, df FROM ai_df WHERE token IN (' . implode(',', array_fill(0, count($chunk), '?')) . ')', $chunk) as $r) $df[$r['token']] = (int)$r['df'];
    }
    $out = [];
    foreach ($tokens as $t) $out[$t] = log(($N + 1) / (($df[$t] ?? 0) + 1)) + 1;
    return $out;
}

/** TF-IDF vector, normalised, limited to the strongest tokens. */
function ai_vector(array $tf, ?array $idf = null): array {
    if (!$tf) return [];
    $idf = $idf ?? ai_idf(array_keys($tf));
    $v = [];
    foreach ($tf as $t => $n) $v[$t] = (1 + log($n)) * ($idf[$t] ?? 1.0);
    arsort($v);
    $v = array_slice($v, 0, AI_VECTOR_SIZE, true);
    $norm = sqrt(array_sum(array_map(fn($x) => $x * $x, $v))) ?: 1;
    foreach ($v as $t => $x) $v[$t] = round($x / $norm, 4);
    return $v;
}

function ai_cosine(array $a, array $b): float {
    if (count($a) > count($b)) [$a, $b] = [$b, $a];
    $s = 0.0;
    foreach ($a as $t => $x) if (isset($b[$t])) $s += $x * $b[$t];
    return $s;
}

/* ---------------- Fingerprints (near-duplicates) ---------------- */

function ai_minhash(string $text): ?array {
    $words = preg_split('/[^\p{L}\p{N}]+/u', mb_strtolower(mb_substr($text, 0, 80000)), -1, PREG_SPLIT_NO_EMPTY);
    if (count($words) < 40) return null;   // too little text to compare reliably
    static $ab = null;
    if ($ab === null) { mt_srand(20261118); $ab = []; for ($i = 0; $i < AI_MINHASH_K; $i++) $ab[] = [mt_rand(1, 2147483646), mt_rand(0, 2147483646)]; mt_srand(); }
    $p = 2147483647;
    $sh = [];
    for ($i = 0, $n = count($words) - 4; $i < $n; $i++) $sh[crc32($words[$i] . ' ' . $words[$i + 1] . ' ' . $words[$i + 2] . ' ' . $words[$i + 3] . ' ' . $words[$i + 4])] = true;
    $mins = array_fill(0, AI_MINHASH_K, PHP_INT_MAX);
    foreach (array_keys($sh) as $h) {
        $h = $h % $p;
        for ($k = 0; $k < AI_MINHASH_K; $k++) {
            $x = ($ab[$k][0] * $h + $ab[$k][1]) % $p;
            if ($x < $mins[$k]) $mins[$k] = $x;
        }
    }
    return $mins;
}

function ai_minhash_sim(array $a, array $b): float {
    $same = 0;
    for ($k = 0; $k < AI_MINHASH_K; $k++) if (($a[$k] ?? -1) === ($b[$k] ?? -2)) $same++;
    return $same / AI_MINHASH_K;
}

/* ---------------- Key points (extractive summary) ---------------- */

/** Picks the sentences that carry the most distinctive words, in reading order. */
function ai_summary(string $text, array $vector, int $max = 4): array {
    $text = mb_substr($text, 0, 60000);
    if (mb_strlen($text) < 500) return [];
    $text = preg_replace('/[ \t]+/u', ' ', $text);
    $parts = preg_split('/(?<=[.!?])\s+(?=[\p{Lu}\d"“(])|\n+/u', $text, -1, PREG_SPLIT_NO_EMPTY);
    $cands = [];
    foreach ($parts as $i => $s) {
        $s = trim($s, " \t\r\n-•*·–");
        $len = mb_strlen($s);
        if ($len < 50 || $len > 360) continue;
        $letters = preg_match_all('/\p{L}/u', $s);
        if ($letters / $len < 0.65) continue;                     // tables, numbers, codes
        if (!preg_match('/\p{Ll}/u', $s)) continue;              // ALL-CAPS headings
        $toks = ai_tokens($s);
        if (count($toks) < 6) continue;
        $score = 0.0; foreach (array_unique($toks) as $t) $score += $vector[$t] ?? 0;
        $score /= sqrt(count($toks));
        $score *= $i < count($parts) * 0.2 ? 1.15 : 1;             // early sentences tend to say what a document is about
        $cands[] = ['i' => $i, 's' => $s, 'score' => $score, 'set' => array_flip($toks)];
    }
    if (count($cands) < 3) return [];
    usort($cands, fn($a, $b) => $b['score'] <=> $a['score']);
    $pick = [];
    foreach ($cands as $c) {
        if ($c['score'] <= 0) break;
        foreach ($pick as $p) {   // skip sentences that repeat one already chosen
            $inter = count(array_intersect_key($c['set'], $p['set']));
            if ($inter / max(1, min(count($c['set']), count($p['set']))) > 0.6) continue 2;
        }
        $pick[] = $c;
        if (count($pick) >= $max) break;
    }
    usort($pick, fn($a, $b) => $a['i'] <=> $b['i']);
    return array_map(fn($p) => preg_match('/[.!?:;]$/u', $p['s']) ? $p['s'] : $p['s'] . '.', $pick);
}

/* ---------------- Sensitive data ---------------- */

function ai_luhn(string $digits): bool {
    $sum = 0; $alt = false;
    for ($i = strlen($digits) - 1; $i >= 0; $i--) {
        $n = (int)$digits[$i];
        if ($alt) { $n *= 2; if ($n > 9) $n -= 9; }
        $sum += $n; $alt = !$alt;
    }
    return $sum % 10 === 0;
}

function ai_iban_ok(string $iban): bool {
    $iban = strtoupper(preg_replace('/\s+/', '', $iban));
    if (!preg_match('/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/', $iban)) return false;
    $r = substr($iban, 4) . substr($iban, 0, 4);
    $num = '';
    foreach (str_split($r) as $ch) $num .= ctype_alpha($ch) ? (string)(ord($ch) - 55) : $ch;
    $mod = 0;
    foreach (str_split($num, 7) as $part) $mod = (int)(($mod . $part) % 97);
    return $mod === 1;
}

/**
 * Looks for personal and commercial information. Returns the suggested classification and the reasons —
 * only what kind of information was found and how often, never the values themselves.
 */
function ai_sensitive(string $text): array {
    $t = mb_substr($text, 0, AI_TEXT_LIMIT);
    $lc = mb_strtolower($t);
    $found = [];
    $add = function (string $code, string $label, string $level, int $n) use (&$found) { if ($n > 0) $found[] = ['code' => $code, 'label' => $label, 'level' => $level, 'count' => $n]; };

    // markings written on the document itself
    $add('mark_restricted', 'Marked “strictly / private & confidential”', 'restricted',
        preg_match_all('/\b(strictly\s+confidential|(private|personal)\s*(and|&)\s*confidential|classification\s*[:\-]\s*restricted|restricted\s+(distribution|circulation|access\s+only))\b/u', $lc));
    $conf = preg_match_all('/\b(confidential|internal\s+use\s+only|not\s+for\s+(distribution|circulation)|commercial[- ]in[- ]confidence|proprietary\s+(and|&)?\s*confidential|proprietary\s+information)\b/u', $lc);
    $add('mark_confidential', 'Marked “confidential” or “internal use only”', 'confidential', $conf);

    // pay and personal details
    preg_match_all('/\b(salary|salaries|payroll|pay\s?slip|gross\s+pay|net\s+pay|basic\s+pay|paye|nssf|nhif|shif|housing\s+levy|remuneration|pension\s+contribution|bank\s+details|overtime\s+pay|deductions?)\b/u', $lc, $m);
    $payKinds = count(array_unique($m[0] ?? []));
    if ($payKinds >= 2 || count($m[0] ?? []) >= 4) $add('pay', 'Salary or payroll details', 'restricted', count($m[0]));
    $add('kra_pin', 'Personal KRA PIN numbers', 'restricted', preg_match_all('/\bA\d{9}[A-Z]\b/', $t));
    $add('national_id', 'National ID numbers', 'restricted', preg_match_all('/\b(national\s+id|id\s*(no|number|#)|identity\s+(card|no|number))\b\.?\s*[:\-]?\s*\d{7,8}\b/u', $lc));
    $add('passport', 'Passport numbers', 'restricted', preg_match_all('/\bpassport\b[^\n]{0,30}?\b[a-z]{1,2}\d{6,8}\b/u', $lc));
    $add('dob', 'Dates of birth', 'restricted', preg_match_all('/\b(date\s+of\s+birth|d\.o\.b\.?|dob)\b/u', $lc));
    $add('medical', 'Medical or health information', 'restricted',
        ($n = preg_match_all('/\b(diagnos(is|ed)|medical\s+(report|history|condition|certificate)|sick\s+(leave|note)|hospitali[sz]ed|patient|prescription)\b/u', $lc)) >= 2 ? $n : 0);

    // money accounts
    $bank = preg_match_all('/\b(a\/c|acc(oun)?t)\.?\s*(no|number|#)?\.?\s*[:\-]?\s*\d{8,16}\b/u', $lc);
    if (preg_match_all('/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,3})?\b/', $t, $ib)) foreach ($ib[0] as $x) if (ai_iban_ok($x)) $bank++;
    $add('bank', 'Bank account numbers', 'restricted', $bank);
    if (preg_match('/\b(card|visa|mastercard|amex|cvv)\b/u', $lc) && preg_match_all('/\b(?:\d[ -]?){12,18}\d\b/', $t, $cm)) {
        $cards = 0;
        foreach ($cm[0] as $x) { $d = preg_replace('/\D/', '', $x); if (strlen($d) >= 13 && strlen($d) <= 19 && preg_match('/^(3[47]|4|5[1-5]|2[2-7]|6)/', $d) && ai_luhn($d)) $cards++; }
        $add('card', 'Payment card numbers', 'restricted', $cards);
    }

    // contact lists and commercial terms
    $phones = preg_match_all('/(?<![\d+])(?:\+?254|0)\s?[17]\d{2}\s?\d{3}\s?\d{3}(?!\d)/', $t);
    $emails = preg_match_all('/[\w.+-]+@[\w-]+\.[\w.-]+/u', $t);
    if ($phones >= 5 || $emails >= 10) $add('contacts', 'A list of personal phone numbers or e-mail addresses', 'confidential', $phones + $emails);
    $comm = preg_match_all('/\b(contract\s+(value|price|sum)|unit\s+rates?|bill\s+of\s+quantities|price\s+schedule|tender\s+sum|quotation|commercial\s+offer|discount|margin|invoice\s+(no|number|total))\b/u', $lc);
    if ($comm >= 2) $add('commercial', 'Prices or commercial terms', 'confidential', $comm);

    if (array_filter($found, fn($f) => $f['code'] === 'mark_restricted')) $found = array_values(array_filter($found, fn($f) => $f['code'] !== 'mark_confidential'));
    $level = null;
    foreach ($found as $f) { if ($f['level'] === 'restricted') { $level = 'restricted'; break; } $level = 'confidential'; }
    return ['level' => $level, 'reasons' => $found];
}

/* ---------------- Title, number, revision, date ---------------- */

function ai_date_iso(string $s): ?string {
    $s = trim($s);
    $mon = ['jan' => 1, 'feb' => 2, 'mar' => 3, 'apr' => 4, 'may' => 5, 'jun' => 6, 'jul' => 7, 'aug' => 8, 'sep' => 9, 'sept' => 9, 'oct' => 10, 'nov' => 11, 'dec' => 12];
    if (preg_match('/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/', $s, $m)) [$y, $mo, $d] = [(int)$m[1], (int)$m[2], (int)$m[3]];
    elseif (preg_match('/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/', $s, $m)) [$d, $mo, $y] = [(int)$m[1], (int)$m[2], (int)$m[3]];   // day first (Kenya, UK)
    elseif (preg_match('/^(\d{1,2})(?:st|nd|rd|th)?[\s\-]+([a-z]{3,9})\.?,?[\s\-]+(\d{2,4})$/i', $s, $m) && ($mm = $mon[substr(strtolower($m[2]), 0, 3)] ?? null)) [$d, $mo, $y] = [(int)$m[1], $mm, (int)$m[3]];
    elseif (preg_match('/^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i', $s, $m) && isset($mon[substr(strtolower($m[1]), 0, 3)])) [$mo, $d, $y] = [$mon[substr(strtolower($m[1]), 0, 3)], (int)$m[2], (int)$m[3]];
    else return null;
    if ($y < 100) $y += 2000;
    if ($y < 1980 || $y > (int)date('Y') + 5 || !checkdate($mo, $d, $y)) return null;
    return sprintf('%04d-%02d-%02d', $y, $mo, $d);
}

/** Pulls a likely title, document number, revision and date out of the first part of the text. */
function ai_extract(string $text, string $filename = ''): array {
    $head = mb_substr($text, 0, 6000);
    $out = ['title' => null, 'doc_number' => null, 'revision' => null, 'date' => null];
    $dateRx = '(\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2}|\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?[\s\-]+[A-Za-z]{3,9}\.?,?[\s\-]+\d{2,4}|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})';

    if (preg_match('/\b(?:title|subject|re)\s*[:\-–]\s*(.{6,140})/iu', $head, $m)) $out['title'] = trim($m[1], " .:-–\t");
    if (preg_match('/\b(?:doc(?:ument)?|ref(?:erence)?|procedure|drawing|dwg|report)\.?\s*(?:no|number|#|ref)\.?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\/._-]{3,40}[A-Z0-9])/iu', $head, $m) && preg_match('/\d/', $m[1])) $out['doc_number'] = strtoupper($m[1]);
    elseif (preg_match('/\b([A-Z]{2,6}(?:-[A-Z0-9]{2,6}){1,4}-\d{2,6}(?:-[A-Z0-9]{1,4})?)\b/', $head, $m)) $out['doc_number'] = $m[1];
    if (preg_match('/\brev(?:ision)?\.?\s*(?:no\.?)?\s*[:\-]?\s*([A-Z]?\d{1,3}(?:\.\d{1,2})?|[A-Z]{1,2})\b(?!\w)/iu', $head, $m)) $out['revision'] = strtoupper($m[1]);
    if (preg_match('/\b(?:date(?:d)?(?:\s+of\s+issue)?|issue\s+date|effective\s+(?:date|from)|issued(?:\s+on)?)\s*[:\-]?\s*' . $dateRx . '/iu', $head, $m)) $out['date'] = ai_date_iso($m[1]);
    if (!$out['date'] && preg_match_all('/' . $dateRx . '/u', mb_substr($head, 0, 2500), $mm)) foreach ($mm[1] as $x) if ($iso = ai_date_iso($x)) { $out['date'] = $iso; break; }

    if (!$out['title']) {   // the line that reads most like a document heading, near the top
        $docWords = '/\b(procedure|policy|plan|report|summary|minutes|agenda|register|list|schedule|specification|datasheet|data sheet|drawing|manual|guide|philosophy|certificate|permit|method statement|checklist|form|record|log|memo|letter|notice|request|order|quotation|invoice|statement|assessment|study|analysis|review|audit|inspection|test|assets?|inventory|custody|handover|contract|agreement|proposal|presentation|lesson|instruction|standard|matrix|budget|forecast)s?\b/iu';
        $best = null; $bestScore = -1;
        foreach (array_slice(preg_split('/\r?\n/u', $head), 0, 40) as $i => $line) {
            $line = trim(preg_replace('/\s+/u', ' ', $line), " \t-–•*:|");
            $len = mb_strlen($line);
            if ($len < 8 || $len > 120) continue;
            if (preg_match('/^(page|rev|doc|date|as at|generated|prepared|approved|checked|ref|tel|fax|email|www\.|http|p\.?o\.? box|confidential|internal|table of contents|contents|draft|copy|strictly|private|personal|restricted|not for)\b/iu', $line)) continue;
            if (preg_match_all('/\p{L}/u', $line) < $len * 0.6) continue;
            if (str_word_count($line) < 2) continue;
            $score = 10 - min(9, $i * 0.6) + (preg_match($docWords, $line) ? 8 : 0) + (preg_match('/[.!?]$/u', $line) ? -6 : 0) + ($len > 90 ? -3 : 0);
            if ($score > $bestScore) { $bestScore = $score; $best = $line; }
        }
        $out['title'] = $best;
    }
    if ($out['title']) {
        $tt = $out['title'];
        if (mb_strtoupper($tt) === $tt) {   // "LPG TRANSFER PUMP PROCEDURE FOR JETTY" → "LPG Transfer Pump Procedure for Jetty"
            $small = ['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'via', 'with'];
            $words = preg_split('/(\s+)/u', $tt, -1, PREG_SPLIT_DELIM_CAPTURE);
            foreach ($words as $i => &$w) {
                if (trim($w) === '') continue;
                $lw = mb_strtolower($w);
                if ($i > 0 && in_array($lw, $small, true)) $w = $lw;
                elseif (mb_strlen($w) <= 3 || preg_match('/\d/u', $w)) continue;   // keep acronyms and codes (LPG, HSE, MV-01)
                else $w = mb_convert_case($lw, MB_CASE_TITLE);
            }
            unset($w);
            $tt = implode('', $words);
        }
        $out['title'] = mb_substr($tt, 0, 200);
    }
    return $out;
}

/** The most distinctive words, written the way they appear in the text, for the Keywords box. */
function ai_keywords(array $vector, string $text, int $n = 6): array {
    $surface = [];
    if (preg_match_all('/\p{L}[\p{L}\p{N}]{2,}/u', mb_substr($text, 0, 40000), $m)) {
        foreach ($m[0] as $w) { $k = ai_stem(mb_strtolower($w)); $surface[$k][$w] = ($surface[$k][$w] ?? 0) + 1; }
    }
    $out = [];
    foreach (array_keys($vector) as $t) {
        if (mb_strlen((string)$t) < 4) continue;
        if (empty($surface[$t])) continue;
        arsort($surface[$t]);
        $w = (string)array_key_first($surface[$t]);
        $out[] = mb_strtoupper($w) === $w && mb_strlen($w) > 5 ? mb_strtolower($w) : $w;
        if (count($out) >= $n) break;
    }
    return $out;
}

/* ---------------- The index ---------------- */

/** (Re)builds the index entry for a document from the version readers see. Cheap when nothing changed. */
function ai_index_doc(int $docId, bool $force = false): void {
    if (!ai_on()) return;
    $d = one('SELECT id, title, description, keywords, deleted_at, COALESCE(published_version_id, current_version_id) AS vid FROM documents WHERE id=?', [$docId]);
    if (!$d || $d['deleted_at'] || !$d['vid']) { ai_unindex($docId); return; }
    $text = (string)val('SELECT extracted_text FROM document_versions WHERE id=?', [$d['vid']]);
    $title = $d['title'] . ' ' . $d['keywords'];
    $hash = sha1($d['vid'] . "\0" . $title . "\0" . $d['description'] . "\0" . $text);
    $old = one('SELECT text_hash, tf FROM ai_index WHERE document_id=?', [$docId]);
    if ($old && !$force && $old['text_hash'] === $hash) return;

    $tf = ai_tf($title, $d['description'] . "\n" . $text);
    arsort($tf);
    $tf = array_slice($tf, 0, AI_VECTOR_SIZE * 2, true);
    // document frequencies: take the old words out, put the new ones in
    $oldTokens = $old ? array_keys(json_decode((string)$old['tf'], true) ?: []) : [];
    $newTokens = array_map('strval', array_keys($tf));
    $gone = array_values(array_diff($oldTokens, $newTokens));
    $came = array_values(array_diff($newTokens, $oldTokens));
    foreach (array_chunk($gone, 400) as $c) q('UPDATE ai_df SET df=GREATEST(df-1,0) WHERE token IN (' . implode(',', array_fill(0, count($c), '?')) . ')', $c);
    foreach (array_chunk($came, 400) as $c) q('INSERT INTO ai_df (token, df) VALUES ' . implode(',', array_fill(0, count($c), '(?,1)')) . ' ON DUPLICATE KEY UPDATE df=df+1', $c);

    $vec = ai_vector($tf);
    $mh = ai_minhash($text);
    $sum = ai_summary($text, $vec);
    $sens = ai_sensitive($d['description'] . "\n" . $text);
    q('INSERT INTO ai_index (document_id, version_id, text_hash, tf, vec, minhash, summary, sens_info, updated_at) VALUES (?,?,?,?,?,?,?,?,NOW())
        ON DUPLICATE KEY UPDATE version_id=VALUES(version_id), text_hash=VALUES(text_hash), tf=VALUES(tf), vec=VALUES(vec), minhash=VALUES(minhash), summary=VALUES(summary), sens_info=VALUES(sens_info), updated_at=NOW()',
        [$docId, (int)$d['vid'], $hash, json_encode($tf, JSON_UNESCAPED_UNICODE), json_encode($vec, JSON_UNESCAPED_UNICODE), $mh ? implode(',', $mh) : null,
         $sum ? json_encode($sum, JSON_UNESCAPED_UNICODE) : null, $sens['level'] ? json_encode($sens, JSON_UNESCAPED_UNICODE) : null]);
}

function ai_unindex(int $docId): void {
    $old = one('SELECT tf FROM ai_index WHERE document_id=?', [$docId]);
    if (!$old) return;
    $tokens = array_map('strval', array_keys(json_decode((string)$old['tf'], true) ?: []));
    foreach (array_chunk($tokens, 400) as $c) q('UPDATE ai_df SET df=GREATEST(df-1,0) WHERE token IN (' . implode(',', array_fill(0, count($c), '?')) . ')', $c);
    q('DELETE FROM ai_index WHERE document_id=?', [$docId]);
}

/**
 * Indexed documents most like the given vector / fingerprint, limited to those this person can see.
 * Returns [doc_id => ['sim' => cosine, 'dup' => minhash similarity]] best first.
 */
function ai_neighbours(array $vec, ?array $mh, array $u, int $limit = 8, array $exclude = []): array {
    if (!$vec && !$mh) return [];
    $q = array_flip(array_map('strval', array_slice(array_keys($vec), 0, 30)));
    // vectors are stored ready-weighted at index time, so comparing needs no further database work
    $rows = all('SELECT a.document_id, a.vec, a.minhash FROM ai_index a JOIN documents d ON d.id=a.document_id WHERE d.deleted_at IS NULL ORDER BY a.updated_at DESC LIMIT ' . AI_MAX_CORPUS);
    $ex = array_flip($exclude);
    $scores = [];
    foreach ($rows as $r) {
        $id = (int)$r['document_id'];
        if (isset($ex[$id])) continue;
        $sim = 0.0;
        if ($vec && $r['vec']) {
            $v = json_decode((string)$r['vec'], true) ?: [];
            if (array_intersect_key($v, $q)) $sim = ai_cosine($vec, $v);
        }
        $dup = ($mh && $r['minhash']) ? ai_minhash_sim($mh, array_map('intval', explode(',', $r['minhash']))) : 0.0;
        if ($sim < 0.12 && $dup < 0.3) continue;
        $scores[$id] = ['sim' => round($sim, 3), 'dup' => round($dup, 3)];
    }
    uasort($scores, fn($a, $b) => max($b['dup'], $b['sim']) <=> max($a['dup'], $a['sim']));
    // keep only what this person may see (never hint at documents they can't open)
    $ids = array_slice(array_keys($scores), 0, $limit * 4);
    if (!$ids) return [];
    $visible = array_column(hydrate_docs(all('SELECT ' . DOC_COLS . ' FROM documents d WHERE d.deleted_at IS NULL AND d.id IN (' . in_list($ids) . ')'), $u), null, 'id');
    $out = [];
    foreach ($ids as $id) { if (!isset($visible[$id])) continue; $out[$id] = $scores[$id] + ['doc' => $visible[$id]]; if (count($out) >= $limit) break; }
    return $out;
}

/**
 * Full analysis of a file that is about to be uploaded: tags, content type, classification, title/number/date,
 * keywords and look-alike documents. $ctx = ['filename', 'library_id'].
 */
function ai_analyze(string $text, string $filename, array $u): array {
    $base = preg_replace('/[_\-.]+/', ' ', pathinfo($filename, PATHINFO_FILENAME));
    $ext = ai_extract($text, $filename);
    $tf = ai_tf($base . ' ' . ($ext['title'] ?? ''), $text);
    $vec = ai_vector($tf);
    $mh = ai_minhash($text);
    $nb = ai_neighbours($vec, $mh, $u, 8);

    // 1. tags: words in the text that match the term store, and tags used on similar documents
    $terms = [];
    foreach (suggest_terms($base . "\n" . ($ext['title'] ?? '') . "\n" . mb_substr($text, 0, 60000), 12) as $s) {
        $terms[$s['id']] = array_merge($s, ['score' => round(min(1.0, 0.4 + 0.12 * $s['score']), 2), 'why' => 'Found in the text']);
    }
    $simIds = array_keys(array_filter($nb, fn($n) => $n['sim'] >= 0.2));
    if ($simIds) {
        $w = []; $wsum = 0;
        foreach ($simIds as $id) $wsum += $nb[$id]['sim'];
        foreach (all('SELECT dt.document_id, t.id, t.label, t.termset_id, s.name AS termset FROM document_terms dt JOIN terms t ON t.id=dt.term_id JOIN termsets s ON s.id=t.termset_id
                WHERE t.deprecated=0 AND dt.document_id IN (' . in_list($simIds) . ')') as $r) {
            $tid = (int)$r['id'];
            $w[$tid] = ($w[$tid] ?? ['id' => $tid, 'label' => $r['label'], 'termset_id' => (int)$r['termset_id'], 'termset' => $r['termset'], 'v' => 0, 'n' => 0]);
            $w[$tid]['v'] += $nb[(int)$r['document_id']]['sim']; $w[$tid]['n']++;
        }
        foreach ($w as $tid => $x) {
            $score = $x['v'] / max($wsum, 0.0001) * min(1, $x['n'] / 2);   // needs support from at least two documents for full weight
            if ($score < 0.25) continue;
            if (isset($terms[$tid])) { $terms[$tid]['score'] = round(min(1.0, $terms[$tid]['score'] + $score * 0.5), 2); $terms[$tid]['why'] = 'Found in the text and used on similar documents'; }
            else $terms[$tid] = ['id' => $tid, 'label' => $x['label'], 'termset_id' => $x['termset_id'], 'termset' => $x['termset'], 'score' => round($score * 0.9, 2),
                'why' => 'Used on ' . $x['n'] . ' similar document' . ($x['n'] > 1 ? 's' : '')];
        }
    }
    $terms = array_values($terms);
    usort($terms, fn($a, $b) => $b['score'] <=> $a['score']);
    $terms = array_map(fn($t) => $t + ['auto' => $t['score'] >= 0.6], array_slice($terms, 0, 10));

    // 2. content type: vote of similar documents, nudged by the type's name appearing in the file name or heading
    $ct = null;
    $votes = []; $total = 0;
    foreach ($nb as $id => $n) { if ($n['sim'] < 0.15 || !$n['doc']['content_type_id']) continue; $votes[$n['doc']['content_type_id']] = ($votes[$n['doc']['content_type_id']] ?? 0) + $n['sim']; $total += $n['sim']; }
    $hayTitle = mb_strtolower($base . ' ' . ($ext['title'] ?? ''));
    $hayBody = mb_strtolower(mb_substr($text, 0, 1500));
    foreach (all('SELECT id, name FROM content_types') as $c) {
        $w = 0;
        foreach (preg_split('/\s*\/\s*/u', mb_strtolower($c['name'])) as $nm) {   // "Certificate / Permit" → either word
            $nm = ai_stem(trim($nm));
            if (mb_strlen($nm) < 4) continue;
            $rx = '/\b' . preg_quote($nm, '/') . '(s|es)?\b/u';
            if (preg_match($rx, $hayTitle)) $w = max($w, 1.0);
            elseif (preg_match($rx, $hayBody)) $w = max($w, 0.25);
        }
        if ($w) { $votes[(int)$c['id']] = ($votes[(int)$c['id']] ?? 0) + $w; $total += $w; }
    }
    if ($votes) {
        arsort($votes);
        $best = (int)array_key_first($votes);
        $conf = $votes[$best] / max($total, 0.0001);
        if ($conf >= 0.45) $ct = ['id' => $best, 'name' => (string)val('SELECT name FROM content_types WHERE id=?', [$best]), 'confidence' => round($conf, 2), 'auto' => $conf >= 0.6];
    }

    // 3. classification
    $sens = ai_sensitive($text);

    // 4. look-alikes: near copies first, then related reading
    $dups = []; $similar = [];
    foreach ($nb as $id => $n) {
        $row = ['id' => $id, 'title' => $n['doc']['title'], 'doc_number' => $n['doc']['doc_number'], 'library' => $n['doc']['library'], 'version' => $n['doc']['version'] ?? '',
            'can_version' => doc_level(load_doc($id), $u) >= LVL_CONTRIBUTE];
        if ($n['dup'] >= 0.5) $dups[] = $row + ['match' => (int)round($n['dup'] * 100)];
        elseif ($n['sim'] >= 0.25 && count($similar) < 3) $similar[] = $row + ['match' => (int)round($n['sim'] * 100)];
    }

    return ['title' => $ext['title'], 'doc_number' => $ext['doc_number'], 'revision' => $ext['revision'], 'date' => $ext['date'],
        'keywords' => ai_keywords($vec, $text), 'terms' => $terms, 'content_type' => $ct, 'sensitive' => $sens,
        'near_duplicates' => array_slice($dups, 0, 3), 'similar' => $similar, 'has_text' => trim($text) !== ''];
}

/** Similar documents for the document page, by meaning of the text (not just shared tags). */
function ai_related_for(int $docId, array $u, int $limit = 5, array $exclude = []): array {
    if (!ai_on()) return [];
    $row = one('SELECT vec, minhash FROM ai_index WHERE document_id=?', [$docId]);
    if (!$row) return [];
    $vec = json_decode((string)$row['vec'], true) ?: [];
    $mh = $row['minhash'] ? array_map('intval', explode(',', $row['minhash'])) : null;
    $out = [];
    foreach (ai_neighbours($vec, $mh, $u, $limit, array_merge([$docId], $exclude)) as $id => $n) {
        if ($n['sim'] < 0.2 && $n['dup'] < 0.5) continue;
        $out[] = $n['doc'] + ['match' => (int)round(max($n['sim'], $n['dup']) * 100), 'near_copy' => $n['dup'] >= 0.7];
    }
    return $out;
}

/* ---------------- Staged uploads (analyse first, publish after the person has checked) ---------------- */

function ai_stage_cleanup(): void {
    foreach (all('SELECT token, stored_name FROM upload_stage WHERE created_at < DATE_SUB(NOW(), INTERVAL 1 DAY) LIMIT 200') as $r) {
        @unlink(storage_path('stage/' . $r['stored_name']));
        q('DELETE FROM upload_stage WHERE token=?', [$r['token']]);
    }
}
