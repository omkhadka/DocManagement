<?php
/**
 * Ask Toto — a librarian you can ask in plain words.
 *
 * "Where is the latest hydrotest procedure for the bullets?"  "How many drawings did Engineering add this month?"
 * "Who approved the fire & gas philosophy?"  "What is the hold time for the hydrotest?"  …then "only PDFs", "what about drawings?"
 *
 * Plain PHP, no AI service: the question is read against the platform's own vocabulary (content types, libraries,
 * people, the term store and its synonyms, dates, file types), the rest becomes keywords; documents are ranked by
 * full-text score, keyword coverage, tags and Toto's text similarity; the reply quotes the sentence that best answers it.
 * Only documents the person can open are ever counted, named or quoted.
 */
declare(strict_types=1);

const ASK_QWORDS = ['knows', 'know', 'expert', 'experts', 'expertise', 'ask', 'talk', 'contact', 'good', 'explain', 'specialist', 'go-to', 'person', 'someone', 'anybody', 'anyone', 'what', 'where', 'which', 'who', 'whom', 'whose', 'when', 'why', 'how', 'is', 'are', 'was', 'were', 'do', 'does', 'did', 'can', 'could', 'should', 'would',
    'will', 'find', 'show', 'give', 'list', 'get', 'me', 'we', 'us', 'our', 'you', 'your', 'please', 'any', 'all', 'some', 'documents', 'document', 'docs', 'doc', 'files', 'file',
    'the', 'a', 'an', 'about', 'for', 'on', 'of', 'in', 'to', 'with', 'from', 'by', 'that', 'this', 'those', 'these', 'there', 'here', 'have', 'has', 'had', 'need', 'want',
    'looking', 'look', 'search', 'tell', 'know', 'latest', 'newest', 'recent', 'recently', 'current', 'last', 'first', 'related', 'regarding', 'concerning', 'many', 'much',
    'number', 'count', 'total', 'it', 'its', 'them', 'they', 'one', 'ones', 'i', 'my', 'mine', 'only', 'just', 'also', 'and', 'or', 'not', 'no', 'kindly', 'hub', 'platform',
    'say', 'says', 'said', 'mention', 'mentions', 'written', 'wrote', 'uploaded', 'upload', 'approved', 'published', 'owns', 'owner', 'author', 'made', 'created', 'version',
    'copy', 'library', 'libraries', 'folder', 'available', 'exist', 'exists', 'got', 'keep', 'kept', 'stored', 'saved', 'put', 'see', 'open', 'read', 'check', 'need', 'help',
    'anything', 'something', 'everything', 'thing', 'things', 'stuff', 'info', 'information', 'details', 'detail', 'type', 'kind', 'up', 'out', 'as', 'at', 'be', 'been', 'if', 'than',
    'then', 'into', 'over', 'under', 'between', 'during', 'since', 'before', 'after', 'until', 'till', 'today', 'yesterday', 'week', 'month', 'year', 'days', 'weeks', 'months', 'years',
    'ago', 'past', 'new', 'old', 'older', 'oldest', 'same', 'other', 'another', 'more', 'most', 'less', 'please', 'thanks', 'thank', 'toto', 'hi', 'hello', 'hey'];

const ASK_CT_ALIASES = [
    'minutes of meeting' => ['minutes', 'mom', 'meeting minutes', 'meeting notes'], 'purchase order' => ['po', 'pos', 'lpo', 'lpos', 'purchase orders'],
    'lesson learned' => ['lessons learned', 'lessons learnt', 'lesson learnt', 'lessons', 'lesson'], 'specification' => ['spec', 'specs'],
    'procedure' => ['sop', 'sops'], 'correspondence' => ['letter', 'letters', 'email', 'emails', 'mail'], 'presentation' => ['slides', 'deck', 'decks'],
    'contract' => ['agreement', 'agreements'], 'drawing' => ['dwg', 'layout', 'layouts', 'p&id', 'pid', 'diagram', 'diagrams'], 'datasheet' => ['data sheet', 'data sheets'],
    'report' => ['reports'], 'policy' => ['policies'], 'method statement' => ['ms', 'method statements'],
];

const ASK_EXT = [
    'pdf' => ['pdf', 'pdfs'], 'docx' => ['word', 'doc', 'docx'], 'xlsx' => ['excel', 'spreadsheet', 'spreadsheets', 'xls', 'xlsx', 'sheet', 'sheets'],
    'pptx' => ['powerpoint', 'ppt', 'pptx'], 'dwg' => ['cad', 'autocad', 'dxf'], 'jpg' => ['image', 'images', 'photo', 'photos', 'picture', 'pictures'],
    'msg' => ['outlook', 'msg', 'eml'],
];
const ASK_EXT_GROUP = ['pdf' => ['pdf'], 'docx' => ['doc', 'docx', 'odt', 'rtf'], 'xlsx' => ['xls', 'xlsx', 'xlsm', 'csv', 'ods'], 'pptx' => ['ppt', 'pptx', 'odp'],
    'dwg' => ['dwg', 'dxf'], 'jpg' => ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'], 'msg' => ['msg', 'eml']];
const ASK_EXT_NAME = ['pdf' => 'PDFs', 'docx' => 'Word files', 'xlsx' => 'spreadsheets', 'pptx' => 'PowerPoint files', 'dwg' => 'CAD files', 'jpg' => 'pictures', 'msg' => 'e-mails'];

function ask_rx(string $phrase): string { return '/(?<![\p{L}\p{N}])' . str_replace('\ ', '\s+', preg_quote(mb_strtolower($phrase), '/')) . '(?:s|es)?(?![\p{L}\p{N}])/u'; }

/** Empty understanding of a question. */
function ask_blank(): array {
    return ['keywords' => [], 'terms' => [], 'ct' => [], 'lib' => [], 'owner' => [], 'ext' => [], 'since' => null, 'until' => null, 'period' => '',
        'status' => '', 'review' => '', 'conf' => [], 'mine' => false, 'fav' => false, 'number' => '', 'sort' => ''];
}

/** Validates a context sent back by the browser (it is only ever used as filters, re-checked here). */
function ask_clean_context($c): ?array {
    if (!is_array($c)) return null;
    $b = ask_blank();
    $b['keywords'] = array_slice(array_values(array_filter(array_map(fn($w) => mb_substr(preg_replace('/[^\p{L}\p{N}&\/.\- ]+/u', '', (string)$w), 0, 40), (array)($c['keywords'] ?? [])))), 0, 12);
    foreach (['terms', 'ct', 'lib', 'owner'] as $k) $b[$k] = array_slice(array_values(array_unique(array_filter(array_map('intval', (array)($c[$k] ?? []))))), 0, 10);
    $b['ext'] = array_values(array_intersect((array)($c['ext'] ?? []), array_keys(ASK_EXT_GROUP)));
    foreach (['since', 'until'] as $k) $b[$k] = isset($c[$k]) && preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$c[$k]) ? (string)$c[$k] : null;
    $b['period'] = mb_substr((string)($c['period'] ?? ''), 0, 40);
    $b['status'] = in_array($c['status'] ?? '', ['draft', 'pending', 'published', 'checked_out'], true) ? $c['status'] : '';
    $b['review'] = in_array($c['review'] ?? '', ['overdue', 'due'], true) ? $c['review'] : '';
    $b['conf'] = array_values(array_intersect((array)($c['conf'] ?? []), ['public', 'internal', 'confidential', 'restricted']));
    $b['mine'] = !empty($c['mine']); $b['fav'] = !empty($c['fav']);
    $b['number'] = mb_substr(preg_replace('/[^A-Za-z0-9\/._-]/', '', (string)($c['number'] ?? '')), 0, 40);
    $b['sort'] = ($c['sort'] ?? '') === 'newest' ? 'newest' : (($c['sort'] ?? '') === 'oldest' ? 'oldest' : '');
    return $b;
}

/** Reads a question into filters, keywords and an intent. */
function ask_parse(string $q, ?array $ctx, array $u): array {
    $orig = trim($q);
    $lc = ' ' . mb_strtolower(preg_replace('/[“”"?!,;]+/u', ' ', $orig)) . ' ';
    $f = ask_blank();
    $used = [];   // words that were understood as filters, so they are not also keywords
    $eat = function (string $phrase) use (&$used) { foreach (preg_split('/\s+/u', mb_strtolower(trim($phrase))) as $w) if ($w !== '') $used[$w] = true; };

    // intent
    $intent = 'find';
    if (preg_match('/^\s*(hi|hello|hey|jambo|habari|hujambo|good\s+(morning|afternoon|evening))\b/u', $lc) && str_word_count($lc) <= 4) $intent = 'greet';
    elseif (preg_match('/^\s*(thanks|thank\s+you|asante|cheers|great|perfect|ok|okay)\b/u', $lc) && str_word_count($lc) <= 5) $intent = 'thanks';
    elseif (preg_match('/\b(what\s+can\s+you\s+do|how\s+do\s+i\s+(use|ask)|who\s+are\s+you|help\s+me\s+use)\b/u', $lc)) $intent = 'help';
    elseif (preg_match('/\b(how\s+many|number\s+of|count\s+(of|the)|total\s+number)\b/u', $lc)) $intent = 'count';
    elseif (preg_match('/\bwho\s+(knows|is\s+(an?|the)\s+(expert|specialist|go-to)|is\s+good\s+(at|with)|can\s+(help|explain)|should\s+i\s+(ask|talk\s+to|contact|call))\b|\b(experts?|specialists?|go-to\s+person)\s+(on|in|for)\b/u', $lc)) $intent = 'expert';
    elseif (preg_match('/^\s*who\b|\bwho\s+(wrote|approved|owns|uploaded|published|prepared|is\s+(the\s+)?(owner|author|responsible))\b/u', $lc)) $intent = 'who';
    elseif (preg_match('/^\s*(what|how|why|when|which\s+(pressure|temperature|value|date|size|rate|time))\b/u', $lc) && !preg_match('/^\s*(what|which)\s+(documents?|files?|procedures?|drawings?|reports?)\b|^\s*(what|how)\s+about\b/u', $lc)) $intent = 'answer';
    if (preg_match('/\b(latest|newest|most\s+recent|current|up[\s-]to[\s-]date|recently\s+(added|uploaded|updated))\b/u', $lc)) $f['sort'] = 'newest';
    if (preg_match('/\b(oldest|earliest|first\s+version)\b/u', $lc)) $f['sort'] = 'oldest';

    // follow-up? ("only PDFs", "what about drawings", "and from last year")
    $refine = $ctx && (preg_match('/^\s*(only|just|and|also|but|now|then|what\s+about|how\s+about|same|those|these|them|from|in|newer|older|newest|oldest|latest|sort|without|excluding|except)\b/u', $lc)
        || str_word_count($lc) <= 3);
    $replaceKw = $ctx && preg_match('/^\s*(what|how)\s+about\b/u', $lc);

    // document number
    if (preg_match('/\b([A-Z]{2,6}(?:-[A-Z0-9]{1,8}){1,4})\b/u', $orig, $m) && preg_match('/\d/', $m[1])) { $f['number'] = $m[1]; $eat(mb_strtolower($m[1])); }

    // content types
    foreach (all('SELECT id, name FROM content_types') as $c) {
        $forms = [];
        foreach (preg_split('/\s*\/\s*/u', mb_strtolower($c['name'])) as $part) $forms[] = $part;
        $forms = array_merge($forms, ASK_CT_ALIASES[mb_strtolower($c['name'])] ?? []);
        foreach ($forms as $fm) {
            if (mb_strlen($fm) < 2) continue;
            if (mb_strlen($fm) <= 3 && !preg_match('/(?<![\p{L}])' . preg_quote(mb_strtoupper($fm), '/') . 's?(?![\p{L}])/u', $orig) && $fm !== 'sop' && $fm !== 'mom') continue;   // short codes only in capitals
            if (preg_match(ask_rx($fm), $lc)) { $f['ct'][] = (int)$c['id']; $eat($fm); $eat($fm . 's'); $eat($fm . 'es'); break; }
        }
    }
    $f['ct'] = array_values(array_unique($f['ct']));

    // libraries ("in Engineering", "HSE library", "from HR")
    foreach (all('SELECT id, name, code FROM libraries WHERE deleted_at IS NULL') as $l) {
        if (container_level((int)$l['id'], null, $u) < LVL_READ) continue;   // only libraries this person can open
        $name = mb_strtolower($l['name']);
        $first = mb_strtolower(preg_split('/[\s&]+/u', $l['name'])[0]);
        $hit = preg_match(ask_rx($name), $lc) ? $name : null;
        if (!$hit && $l['code'] && preg_match('/(?<![\p{L}])' . preg_quote(strtoupper($l['code']), '/') . '(?![\p{L}])/u', $orig)) $hit = mb_strtolower($l['code']);
        if (!$hit && mb_strlen($first) >= 3 && preg_match('/\b(in|from|under|inside|within|of)\s+(the\s+)?' . preg_quote($first, '/') . '\b/u', $lc)) $hit = $first;
        if (!$hit && mb_strlen($first) >= 3 && preg_match('/\b' . preg_quote($first, '/') . '\s+(library|department|team|folder)\b/u', $lc)) $hit = $first;
        if ($hit) { $f['lib'][] = (int)$l['id']; $eat($hit); $eat('library'); }
    }
    // "human resources" library also answers to HR / personnel
    if (!$f['lib'] && preg_match('/\b(hr|personnel)\b/u', $lc) && ($hr = val("SELECT id FROM libraries WHERE deleted_at IS NULL AND (code IN ('HR','HRA') OR name LIKE 'Human%') LIMIT 1"))
        && container_level((int)$hr, null, $u) >= LVL_READ) { $f['lib'][] = (int)$hr; $eat('hr'); }

    // people: "by Grace", "Grace's", "uploaded by Peter Otieno", "from Brian"
    foreach (all('SELECT id, name FROM users WHERE active=1') as $p) {
        $parts = array_filter(preg_split('/\s+/u', mb_strtolower($p['name'])), fn($x) => mb_strlen($x) >= 3);
        foreach (array_merge([mb_strtolower($p['name'])], $parts) as $nm) {
            $n = preg_quote($nm, '/');
            if (preg_match('/\b(by|from|owner|author|of)\s+' . $n . '\b|\b' . $n . '(\'s|’s)/u', $lc) || ($intent === 'who' ? false : preg_match('/\b(written|uploaded|prepared|sent|shared|made|approved|published|created)\s+by\s+' . $n . '\b/u', $lc))) {
                $f['owner'][] = (int)$p['id'];
                foreach (preg_split('/\s+/u', mb_strtolower($p['name'])) as $w) $eat($w);
                $eat($nm . "'s"); $eat($nm . '’s');
                break;
            }
        }
    }
    if (preg_match('/\b(my\s+(own\s+)?(documents?|files?|uploads?|procedures?|drawings?|reports?)|i\s+(uploaded|wrote|own|created|prepared)|mine)\b/u', $lc)) $f['mine'] = true;
    if (preg_match('/\b(my\s+)?favou?rites?\b/u', $lc)) { $f['fav'] = true; $eat('favourites'); $eat('favorites'); $eat('favourite'); $eat('favorite'); }

    // file types
    foreach (ASK_EXT as $key => $words) foreach ($words as $w) {
        if ($w === 'doc' && !preg_match('/\b(word\s+)?doc\s+(file|files|format)\b|\.doc\b/u', $lc)) continue;   // "doc" usually means document
        if ($w === 'sheet' && !preg_match('/\b(excel|spread)\b/u', $lc) && !preg_match('/\bsheets?\s+(file|files)\b/u', $lc)) continue;
        if (preg_match(ask_rx($w), $lc)) { $f['ext'][] = $key; $eat($w); $eat($w . 's'); break; }
    }
    $f['ext'] = array_values(array_unique($f['ext']));

    // dates
    $today = new DateTimeImmutable('today');
    $months = ['january' => 1, 'february' => 2, 'march' => 3, 'april' => 4, 'may' => 5, 'june' => 6, 'july' => 7, 'august' => 8, 'september' => 9, 'october' => 10, 'november' => 11, 'december' => 12,
        'jan' => 1, 'feb' => 2, 'mar' => 3, 'apr' => 4, 'jun' => 6, 'jul' => 7, 'aug' => 8, 'sep' => 9, 'sept' => 9, 'oct' => 10, 'nov' => 11, 'dec' => 12];
    $setP = function (?DateTimeImmutable $a, ?DateTimeImmutable $b, string $label, string $phrase) use (&$f, $eat) {
        $f['since'] = $a ? $a->format('Y-m-d') : null; $f['until'] = $b ? $b->format('Y-m-d') : null; $f['period'] = $label; $eat($phrase);
    };
    if (preg_match('/\btoday\b/u', $lc)) $setP($today, null, 'today', 'today');
    elseif (preg_match('/\byesterday\b/u', $lc)) $setP($today->modify('-1 day'), $today, 'yesterday', 'yesterday');
    elseif (preg_match('/\bthis\s+week\b/u', $lc)) $setP($today->modify('monday this week'), null, 'this week', 'this week');
    elseif (preg_match('/\blast\s+week\b/u', $lc)) $setP($today->modify('monday last week'), $today->modify('monday this week'), 'last week', 'last week');
    elseif (preg_match('/\bthis\s+month\b/u', $lc)) $setP($today->modify('first day of this month'), null, 'this month', 'this month');
    elseif (preg_match('/\blast\s+month\b/u', $lc)) $setP($today->modify('first day of last month'), $today->modify('first day of this month'), 'last month', 'last month');
    elseif (preg_match('/\bthis\s+year\b/u', $lc)) $setP($today->setDate((int)$today->format('Y'), 1, 1), null, 'this year', 'this year');
    elseif (preg_match('/\blast\s+year\b/u', $lc)) { $y = (int)$today->format('Y') - 1; $setP($today->setDate($y, 1, 1), $today->setDate($y + 1, 1, 1), 'in ' . $y, 'last year'); }
    elseif (preg_match('/\b(last|past)\s+(\d{1,3}|two|three|four|five|six|seven|ten|twelve)\s+(day|week|month|year)s?\b/u', $lc, $m)) {
        $n = is_numeric($m[2]) ? (int)$m[2] : ['two' => 2, 'three' => 3, 'four' => 4, 'five' => 5, 'six' => 6, 'seven' => 7, 'ten' => 10, 'twelve' => 12][$m[2]];
        $setP($today->modify("-$n {$m[3]}"), null, "in the last $n {$m[3]}" . ($n > 1 ? 's' : ''), $m[0]);
    }
    elseif (preg_match('/\b(since|after|from)\s+(' . implode('|', array_keys($months)) . ')(?:\s+(\d{4}))?\b/u', $lc, $m)) {
        $y = isset($m[3]) ? (int)$m[3] : (int)$today->format('Y'); $mo = $months[$m[2]];
        if (!isset($m[3]) && $mo > (int)$today->format('n')) $y--;
        $setP($today->setDate($y, $mo, 1), null, 'since ' . ucfirst($m[2]) . " $y", $m[0]);
    }
    elseif (preg_match('/\b(in|during)\s+(' . implode('|', array_keys($months)) . ')(?:\s+(\d{4}))?\b/u', $lc, $m)) {
        $y = isset($m[3]) ? (int)$m[3] : (int)$today->format('Y'); $mo = $months[$m[2]];
        if (!isset($m[3]) && $mo > (int)$today->format('n')) $y--;
        $a = $today->setDate($y, $mo, 1);
        $setP($a, $a->modify('first day of next month'), 'in ' . ucfirst($m[2]) . " $y", $m[0]);
    }
    elseif (preg_match('/\b(in|during|from)\s+((?:19|20)\d{2})\b/u', $lc, $m)) { $y = (int)$m[2]; $setP($today->setDate($y, 1, 1), $today->setDate($y + 1, 1, 1), "in $y", $m[0]); }
    elseif (preg_match('/\bbefore\s+((?:19|20)\d{2})\b/u', $lc, $m)) $setP(null, $today->setDate((int)$m[1], 1, 1), 'before ' . $m[1], $m[0]);

    // status, review, classification
    if (preg_match('/\b(overdue|past\s+due|late\s+for\s+review)\b/u', $lc)) { $f['review'] = 'overdue'; $eat('overdue'); $eat('review'); }
    elseif (preg_match('/\b(due\s+for\s+review|need(s|ing)?\s+(a\s+)?review|review\s+due|up\s+for\s+review)\b/u', $lc)) { $f['review'] = 'due'; $eat('due review needs needing'); }
    if (preg_match('/\bdrafts?\b/u', $lc)) { $f['status'] = 'draft'; $eat('draft'); $eat('drafts'); }
    elseif (preg_match('/\b(waiting|pending)(\s+for)?\s+approval\b/u', $lc)) { $f['status'] = 'pending'; $eat('waiting pending approval'); }
    elseif (preg_match('/\bchecked[\s-]out\b|\blocked\b/u', $lc)) { $f['status'] = 'checked_out'; $eat('checked out locked'); }
    foreach (['confidential', 'restricted', 'public'] as $c) if (preg_match('/\b' . $c . '\b/u', $lc)) { $f['conf'][] = $c; $eat($c); }

    // tags from the term store (labels and synonyms)
    foreach (suggest_terms($orig, 6) as $t) {
        $f['terms'][] = (int)$t['id'];
        $row = one('SELECT label, synonyms FROM terms WHERE id=?', [$t['id']]);
        foreach (array_merge([$row['label']], explode(',', (string)$row['synonyms'])) as $ph) {
            $ph = mb_strtolower(trim(preg_replace('/\s*[–-]\s.*$/u', '', $ph)));
            if ($ph !== '' && preg_match(ask_rx($ph), $lc)) $eat($ph);
        }
    }

    // whatever is left is what the document is about
    $stop = array_flip(ASK_QWORDS);
    $aiStop = array_diff_key(ai_stopwords(), array_flip(['time', 'date', 'page', 'note', 'notes', 'copy', 'total']));
    $kw = [];
    if (preg_match_all('/[\p{L}\p{N}][\p{L}\p{N}&\/.\-]*/u', $lc, $m)) foreach ($m[0] as $w) {
        $w = trim($w, '.-/');
        if ($w === '' || isset($used[$w]) || isset($stop[$w]) || isset($aiStop[$w])) continue;
        if (mb_strlen($w) < 2 || (mb_strlen($w) < 3 && !preg_match('/\d/', $w))) continue;
        $kw[] = $w;
    }
    $f['keywords'] = array_values(array_unique($kw));

    // follow-up: start from what we were talking about
    $nothingNew = !$f['keywords'] && !$f['terms'] && !$f['ct'] && !$f['lib'] && !$f['owner'] && !$f['ext'] && !$f['period'] && !$f['status'] && !$f['review'] && !$f['conf'] && !$f['number'] && !$f['mine'] && !$f['fav'];
    if ($ctx && $nothingNew) $refine = true;
    if ($refine && $ctx) {
        $base = $ctx;
        foreach (['ct', 'lib', 'owner', 'ext', 'conf'] as $k) if ($f[$k]) $base[$k] = $f[$k];
        foreach (['since', 'until', 'period'] as $k) if ($f['period']) $base[$k] = $f[$k];
        foreach (['status', 'review', 'number', 'sort'] as $k) if ($f[$k]) $base[$k] = $f[$k];
        if ($f['mine']) $base['mine'] = true;
        if ($f['fav']) $base['fav'] = true;
        if (preg_match('/\b(without|excluding|except|any\s+type|all\s+types)\b/u', $lc)) { $base['ct'] = $f['ct'] ? array_values(array_diff($ctx['ct'], $f['ct'])) : []; }
        if ($replaceKw && ($f['keywords'] || $f['terms'])) { $base['keywords'] = $f['keywords']; $base['terms'] = $f['terms']; }
        elseif ($f['keywords'] || $f['terms']) { $base['keywords'] = array_values(array_unique(array_merge($ctx['keywords'], $f['keywords']))); $base['terms'] = array_values(array_unique(array_merge($ctx['terms'], $f['terms']))); }
        $f = $base;
        if ($intent === 'find' && !empty($ctx['_intent']) && in_array($ctx['_intent'], ['count'], true) && !preg_match('/\b(show|list|which)\b/u', $lc)) $intent = $ctx['_intent'];
    }
    return [$f, $intent];
}

/** SQL conditions for the understood filters (permissions are applied afterwards, per document). */
function ask_where(array $f, array $u, array $skip = []): array {
    $w = ['d.deleted_at IS NULL']; $p = [];
    if ($f['ct'] && !in_array('ct', $skip, true)) $w[] = 'd.content_type_id IN (' . in_list($f['ct']) . ')';
    if ($f['lib'] && !in_array('lib', $skip, true)) $w[] = 'd.library_id IN (' . in_list($f['lib']) . ')';
    if ($f['owner'] && !in_array('owner', $skip, true)) $w[] = 'd.owner_id IN (' . in_list($f['owner']) . ')';
    if ($f['mine'] && !in_array('mine', $skip, true)) { $w[] = 'd.owner_id = ?'; $p[] = $u['id']; }
    if ($f['fav'] && !in_array('fav', $skip, true)) { $w[] = 'd.id IN (SELECT document_id FROM favorites WHERE user_id=?)'; $p[] = $u['id']; }
    if ($f['ext'] && !in_array('ext', $skip, true)) {
        $exts = []; foreach ($f['ext'] as $e) $exts = array_merge($exts, ASK_EXT_GROUP[$e] ?? []);
        $w[] = "d.current_version_id IN (SELECT id FROM document_versions WHERE ext IN ('" . implode("','", $exts) . "'))";
    }
    if (!in_array('period', $skip, true)) {
        if ($f['since']) { $w[] = 'd.updated_at >= ?'; $p[] = $f['since']; }
        if ($f['until']) { $w[] = 'd.updated_at < ?'; $p[] = $f['until']; }
    }
    if ($f['status'] && !in_array('status', $skip, true)) {
        if ($f['status'] === 'checked_out') $w[] = 'd.checked_out_by IS NOT NULL';
        else { $w[] = 'd.status = ?'; $p[] = $f['status']; }
    }
    if ($f['review'] && !in_array('review', $skip, true)) $w[] = $f['review'] === 'overdue' ? 'd.review_date < CURDATE()' : 'd.review_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)';
    if ($f['conf'] && !in_array('conf', $skip, true)) $w[] = "d.confidentiality IN ('" . implode("','", $f['conf']) . "')";
    if ($f['number'] && !in_array('number', $skip, true)) { $w[] = 'd.doc_number LIKE ?'; $p[] = '%' . addcslashes($f['number'], '%_') . '%'; }
    return [$w, $p];
}

/** Finds and ranks documents for the understood question. Returns hydrated docs with a score and the reasons. */
function ask_search(array $f, array $u, array $skip = []): array {
    [$w, $p] = ask_where($f, $u, $skip);
    $kw = $f['keywords'];
    $terms = $f['terms'] ? term_descendants($f['terms']) : [];
    $textual = $kw || $terms;
    $scoreSql = '0'; $sp = [];
    if ($textual) {
        $or = []; $op = [];
        $nl = implode(' ', $kw);
        foreach ($kw as $k) { $lk = '%' . addcslashes($k, '%_') . '%'; $or[] = '(d.title LIKE ? OR d.doc_number LIKE ? OR d.keywords LIKE ? OR d.description LIKE ? OR d.search_text LIKE ?)'; array_push($op, $lk, $lk, $lk, $lk, $lk); }
        if ($terms) $or[] = 'd.id IN (SELECT document_id FROM document_terms WHERE term_id IN (' . in_list($terms) . '))';
        if ($nl !== '') { $or[] = 'MATCH(d.title, d.description, d.keywords, d.doc_number, d.search_text) AGAINST (? IN NATURAL LANGUAGE MODE)'; $op[] = $nl; $scoreSql = 'MATCH(d.title, d.description, d.keywords, d.doc_number, d.search_text) AGAINST (?)'; $sp[] = $nl; }
        $w[] = '(' . implode(' OR ', $or) . ')'; $p = array_merge($p, $op);
    }
    $order = $f['sort'] === 'oldest' ? 'd.updated_at ASC' : ($textual ? '_s DESC, d.updated_at DESC' : 'd.updated_at DESC');
    try { $rows = all('SELECT ' . DOC_COLS . ", $scoreSql AS _s FROM documents d WHERE " . implode(' AND ', $w) . " ORDER BY $order LIMIT 400", array_merge($sp, $p)); }
    catch (Throwable $e) { $rows = []; }
    if (!$rows) return [];
    $raw = array_column($rows, null, 'id');
    $docs = hydrate_docs($rows, $u);   // never count, name or quote what this person can't open
    if (!$docs) return [];

    // ranking
    $stems = array_map(fn($k) => ai_stem(mb_strtolower($k)), $kw);
    $texts = [];
    $ids = array_slice(array_column($docs, 'id'), 0, 120);
    if ($textual) foreach (all('SELECT id, LEFT(search_text, 150000) t FROM documents WHERE id IN (' . in_list($ids) . ')') as $t) $texts[(int)$t['id']] = mb_strtolower((string)$t['t']);
    $qvec = $kw ? ai_vector(ai_tf(implode(' ', $kw), '')) : [];
    $vecs = [];
    if ($qvec) foreach (all('SELECT document_id, vec FROM ai_index WHERE document_id IN (' . in_list($ids) . ')') as $r) $vecs[(int)$r['document_id']] = json_decode((string)$r['vec'], true) ?: [];
    $termSet = array_flip($terms);
    $maxFt = max(0.0001, max(array_map(fn($d) => (float)($raw[$d['id']]['_s'] ?? 0), $docs)));
    foreach ($docs as &$d) {
        $why = []; $s = 0.0;
        $title = mb_strtolower($d['title'] . ' ' . $d['doc_number'] . ' ' . $d['keywords']);
        $body = $texts[$d['id']] ?? '';
        $hit = 0;
        foreach ($kw as $i => $k) {
            $k = mb_strtolower($k); $st = $stems[$i];
            $inTitle = mb_strpos($title, $st) !== false;
            $inBody = $inTitle || mb_strpos($body, $st) !== false;
            if ($inTitle) $s += 6;
            if ($inBody) { $hit++; $why[] = $k; }
        }
        if ($kw) $s += 14 * ($hit / count($kw));
        $tagged = array_values(array_filter($d['terms'], fn($t) => isset($termSet[$t['id']])));
        if ($tagged) { $s += 7 * count($tagged); foreach ($tagged as $t) $why[] = 'tag: ' . $t['label']; }
        if ($textual) $s += 6 * ((float)($raw[$d['id']]['_s'] ?? 0) / $maxFt);
        if ($qvec && isset($vecs[$d['id']])) $s += 10 * ai_cosine($qvec, $vecs[$d['id']]);
        if ($f['number'] && $d['doc_number'] && mb_stripos($d['doc_number'], $f['number']) !== false) $s += 30;
        if ($d['status'] === 'published') $s += 1;
        $s += min(2, log(1 + $d['views']) / 3);
        $d['_rank'] = $s; $d['_why'] = array_values(array_unique($why));
        $d['_cover'] = $kw ? $hit / count($kw) : 1;
    }
    unset($d);
    // documents that match none of the words and none of the tags are noise from the loose full-text match
    if ($textual) $docs = array_values(array_filter($docs, fn($d) => $d['_cover'] > 0 || $d['_why']));
    usort($docs, fn($a, $b) => $b['_rank'] <=> $a['_rank']);
    if ($textual && $docs) { $cut = $docs[0]['_rank'] * 0.3; $docs = array_values(array_filter($docs, fn($d) => $d['_rank'] >= $cut)); }   // drop the barely-related tail
    if ($f['sort'] && $docs) {   // newest / oldest among the relevant ones
        $top = $docs[0]['_rank'];
        $rel = array_values(array_filter($docs, fn($d) => !$textual || $d['_rank'] >= $top * 0.55));
        usort($rel, fn($a, $b) => $f['sort'] === 'oldest' ? strcmp((string)$a['modified'], (string)$b['modified']) : strcmp((string)$b['modified'], (string)$a['modified']));
        $ids = array_flip(array_column($rel, 'id'));
        $docs = array_merge($rel, array_values(array_filter($docs, fn($d) => !isset($ids[$d['id']]))));
    }
    return $docs;
}

/** The sentence in the best documents that best answers the question. */
function ask_passage(array $docs, array $f, string $question): ?array {
    if (!$f['keywords'] || !$docs) return null;
    $stems = array_map(fn($k) => ai_stem(mb_strtolower($k)), $f['keywords']);
    $idf = ai_idf($stems);
    $variants = [];   // a few everyday equivalents, so "hold time" finds "held for two hours"
    $more = ['hold' => ['held', 'holding'], 'time' => ['hour', 'minute', 'duration', 'period', 'day'], 'run' => ['ran', 'running'], 'keep' => ['kept'], 'buy' => ['bought', 'purchase'],
        'cost' => ['price', 'value', 'kes', 'usd', 'amount'], 'price' => ['cost', 'rate', 'kes', 'usd'], 'pay' => ['paid', 'payment'], 'deadline' => ['due', 'date', 'by'], 'frequency' => ['every', 'monthly', 'weekly', 'daily', 'annually'],
        'often' => ['every', 'monthly', 'weekly', 'daily', 'annually'], 'temperature' => ['°c', 'degc', 'deg'], 'pressure' => ['bar', 'barg', 'psi', 'kpa', 'mpa'], 'responsible' => ['shall', 'owner', 'by'], 'who' => ['shall']];
    foreach ($stems as $st) $variants[$st] = array_merge([$st], $more[$st] ?? []);
    $ql = mb_strtolower($question);
    $wantsNumber = (bool)preg_match('/\b(how\s+(long|much|many|often|far|big|high|low)|time|duration|pressure|temperature|size|rate|limit|percentage|minimum|maximum|interval|frequency|cost|price|when|date|deadline)\b/u', $ql);
    $numRx = '/\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|once|twice|daily|weekly|monthly|annually|yearly)\b/u';
    $best = null;
    foreach (array_slice($docs, 0, 4) as $rank => $d) {
        // the text of the version this person sees
        $text = (string)val('SELECT LEFT(extracted_text, 120000) FROM document_versions WHERE id=?', [$d['version_id']]);
        if ($text === '') continue;
        foreach (preg_split('/(?<=[.!?])\s+(?=[\p{Lu}\d"“(])|\n+/u', $text, -1, PREG_SPLIT_NO_EMPTY) as $sent) {
            $sent = trim($sent, " \t-•*·–");
            $len = mb_strlen($sent);
            if ($len < 25 || $len > 420) continue;
            if (!preg_match('/\p{Ll}/u', $sent) || mb_strtolower($sent) === mb_strtolower($d['title'])) continue;   // headings and titles are not answers
            $ls = mb_strtolower($sent);
            $score = 0.0; $hits = 0;
            foreach ($stems as $st) foreach ($variants[$st] as $v) if (mb_strpos($ls, $v) !== false) { $score += $idf[$st] ?? 1; $hits++; break; }
            if (!$hits) continue;
            if ($wantsNumber) $score *= preg_match($numRx, $ls) ? 1.6 : 0.5;
            $score *= (1 - 0.1 * $rank);                 // prefer the best-ranked document
            $score /= max(1, sqrt($len / 120));          // and shorter, to-the-point sentences
            $need = count($stems) >= 3 ? 2 : 1;
            if ($hits < $need) continue;
            if (!$best || $score > $best['score']) $best = ['score' => $score, 'text' => $sent, 'doc' => $d, 'hits' => $hits];
        }
    }
    if (!$best) return null;
    return ['text' => $best['text'], 'doc_id' => $best['doc']['id'], 'title' => $best['doc']['title'], 'doc_number' => $best['doc']['doc_number'],
        'version' => $best['doc']['version'], 'words' => $f['keywords'], 'complete' => $best['hits'] === count($stems)];
}

/** Human words for what was understood (each one can be removed with a click). */
function ask_chips(array $f): array {
    $c = [];
    foreach ($f['ct'] as $id) $c[] = ['k' => 'ct', 'v' => $id, 'label' => (string)val('SELECT name FROM content_types WHERE id=?', [$id])];
    foreach ($f['lib'] as $id) $c[] = ['k' => 'lib', 'v' => $id, 'label' => 'in ' . (string)val('SELECT name FROM libraries WHERE id=?', [$id])];
    foreach ($f['owner'] as $id) $c[] = ['k' => 'owner', 'v' => $id, 'label' => 'by ' . (string)val('SELECT name FROM users WHERE id=?', [$id])];
    if ($f['mine']) $c[] = ['k' => 'mine', 'v' => 1, 'label' => 'my documents'];
    if ($f['fav']) $c[] = ['k' => 'fav', 'v' => 1, 'label' => 'my favourites'];
    foreach ($f['terms'] as $id) $c[] = ['k' => 'terms', 'v' => $id, 'label' => 'tag: ' . (string)val('SELECT label FROM terms WHERE id=?', [$id])];
    foreach ($f['ext'] as $e) $c[] = ['k' => 'ext', 'v' => $e, 'label' => ASK_EXT_NAME[$e] ?? $e];
    if ($f['period']) $c[] = ['k' => 'period', 'v' => 1, 'label' => 'changed ' . $f['period']];
    if ($f['status']) $c[] = ['k' => 'status', 'v' => 1, 'label' => ['draft' => 'drafts', 'pending' => 'waiting for approval', 'published' => 'published', 'checked_out' => 'checked out'][$f['status']]];
    if ($f['review']) $c[] = ['k' => 'review', 'v' => 1, 'label' => $f['review'] === 'overdue' ? 'review overdue' : 'review due soon'];
    foreach ($f['conf'] as $x) $c[] = ['k' => 'conf', 'v' => $x, 'label' => ucfirst($x)];
    if ($f['number']) $c[] = ['k' => 'number', 'v' => 1, 'label' => 'number ' . $f['number']];
    foreach ($f['keywords'] as $k) $c[] = ['k' => 'keywords', 'v' => $k, 'label' => '“' . $k . '”'];
    if ($f['sort']) $c[] = ['k' => 'sort', 'v' => 1, 'label' => $f['sort'] === 'newest' ? 'newest first' : 'oldest first'];
    return $c;
}

/** "procedures about hydrotest in Engineering Documents changed this month" */
function ask_describe(array $f, int $n): string {
    $what = 'document';
    if (count($f['ct']) === 1) $what = mb_strtolower((string)val('SELECT name FROM content_types WHERE id=?', [$f['ct'][0]]));
    $what = $n === 1 ? $what : (preg_match('/(s|x|ch|sh)$/u', $what) ? $what . 'es' : (preg_match('/[^aeiou]y$/u', $what) ? mb_substr($what, 0, -1) . 'ies' : $what . 's'));
    if ($f['ext'] && count($f['ext']) === 1) $what .= ' (' . (ASK_EXT_NAME[$f['ext'][0]] ?? '') . ')';
    $bits = [];
    $about = array_merge(array_map(fn($k) => '“' . $k . '”', $f['keywords']), array_map(fn($id) => (string)val('SELECT label FROM terms WHERE id=?', [$id]), $f['terms']));
    if ($about) $bits[] = 'about ' . ask_join($about);
    if ($f['lib']) $bits[] = 'in ' . ask_join(array_map(fn($id) => (string)val('SELECT name FROM libraries WHERE id=?', [$id]), $f['lib']));
    if ($f['owner']) $bits[] = 'by ' . ask_join(array_map(fn($id) => (string)val('SELECT name FROM users WHERE id=?', [$id]), $f['owner']));
    if ($f['mine']) $bits[] = 'that you own';
    if ($f['fav']) $bits[] = 'in your favourites';
    if ($f['period']) $bits[] = 'changed ' . $f['period'];
    if ($f['review']) $bits[] = $f['review'] === 'overdue' ? 'that are overdue for review' : 'due for review soon';
    if ($f['status'] === 'draft') $bits[] = 'still in draft';
    if ($f['status'] === 'checked_out') $bits[] = 'that are checked out';
    if ($f['conf']) $bits[] = 'classified ' . ask_join($f['conf'], 'or');
    if ($f['number']) $bits[] = 'numbered like ' . $f['number'];
    return trim($what . ' ' . implode(' ', $bits));
}

function ask_join(array $xs, string $and = 'and'): string {
    $xs = array_values(array_filter($xs, fn($x) => $x !== ''));
    if (count($xs) <= 1) return $xs[0] ?? '';
    return implode(', ', array_slice($xs, 0, -1)) . " $and " . end($xs);
}

function ask_doc_ref(array $d): string {
    return '**' . $d['title'] . '**' . ($d['doc_number'] ? ' (' . $d['doc_number'] . ($d['version'] ? ', v' . $d['version'] : '') . ')' : '');
}

/** Someone to ask when the shelves are empty: the head of the department behind the library, or whoever writes most on the subject. */
function ask_expert(array $f, array $u): ?array {
    $uid = null; $why = '';
    if ($f['terms']) {
        // counted over published Public / Internal documents only, so the hint never reveals sensitive ones
        $r = one("SELECT d.owner_id, COUNT(*) n FROM document_terms dt JOIN documents d ON d.id=dt.document_id WHERE d.deleted_at IS NULL AND d.published_version_id IS NOT NULL
            AND d.confidentiality IN ('public','internal') AND dt.term_id IN (" . in_list($f['terms']) . ') GROUP BY d.owner_id ORDER BY n DESC LIMIT 1');
        if ($r) { $uid = (int)$r['owner_id']; $why = 'writes most of the documents on this subject'; }
    }
    if (!$uid && $f['lib']) {
        $r = one("SELECT u.id FROM libraries l JOIN users u ON u.department_id=l.department_id AND u.role='head' AND u.active=1 WHERE l.id=? LIMIT 1", [$f['lib'][0]]);
        if ($r) { $uid = (int)$r['id']; $why = 'heads the department that keeps this library'; }
    }
    if (!$uid || $uid === $u['id']) return null;
    $p = one('SELECT u.id, u.name, u.job_title, u.email, d.name AS department FROM users u LEFT JOIN departments d ON d.id=u.department_id WHERE u.id=? AND u.active=1', [$uid]);
    return $p ? $p + ['why' => $why] : null;
}

function ask_doc_out(array $d): array {
    return ['id' => $d['id'], 'title' => $d['title'], 'doc_number' => $d['doc_number'], 'version' => $d['version'], 'library' => $d['library'], 'library_color' => $d['library_color'],
        'content_type' => $d['content_type'], 'content_type_color' => $d['content_type_color'], 'ext' => $d['ext'], 'modified' => $d['modified'], 'owner' => $d['owner'],
        'status' => $d['status'], 'confidentiality' => $d['confidentiality'], 'why' => array_slice($d['_why'] ?? [], 0, 5)];
}

/** The endpoint: question in, a librarian's answer out. */
function toto_ask(string $q, ?array $ctx, array $remove, array $u): array {
    $q = trim(mb_substr($q, 0, 400));
    [$f, $intent] = ask_parse($q, $ctx, $u);
    // the person clicked a chip away
    foreach ($remove as $r) {
        $k = (string)($r['k'] ?? ''); $v = $r['v'] ?? null;
        if (in_array($k, ['ct', 'lib', 'owner', 'terms'], true)) $f[$k] = array_values(array_diff($f[$k], [(int)$v]));
        elseif (in_array($k, ['ext', 'conf', 'keywords'], true)) $f[$k] = array_values(array_diff($f[$k], [(string)$v]));
        elseif ($k === 'period') { $f['since'] = $f['until'] = null; $f['period'] = ''; }
        elseif (in_array($k, ['status', 'review', 'number', 'sort'], true)) $f[$k] = '';
        elseif (in_array($k, ['mine', 'fav'], true)) $f[$k] = false;
    }
    $name = explode(' ', (string)$u['name'])[0];
    $out = ['intent' => $intent, 'reply' => [], 'docs' => [], 'passage' => null, 'chips' => [], 'suggest' => [], 'expert' => null, 'total' => 0];

    if ($intent === 'greet' || $intent === 'help' || ($intent === 'thanks' && !$ctx)) {
        $out['reply'][] = $intent === 'greet' ? "Hello $name! I'm Toto, the librarian of this hub." : ($intent === 'thanks' ? "You're welcome, $name." : "I'm Toto, the librarian of this hub.");
        $out['reply'][] = 'Ask me the way you would ask a colleague — I know the libraries, document types, tags, people and dates here, and I can quote the sentence that answers your question.';
        $out['suggest'] = ['Where is the latest hydrotest procedure?', 'How many drawings were added this month?', 'Which documents are overdue for review?', 'Show me my documents from last week'];
        return $out;
    }
    if ($intent === 'thanks') { $out['reply'][] = "You're welcome, $name. Anything else I can find for you?"; $out['context'] = $ctx; return $out; }

    $hasAny = $f['keywords'] || $f['terms'] || $f['ct'] || $f['lib'] || $f['owner'] || $f['ext'] || $f['period'] || $f['status'] || $f['review'] || $f['conf'] || $f['number'] || $f['mine'] || $f['fav'];
    if (!$hasAny) {
        $out['reply'][] = "I'm not sure what to look for yet. Tell me a subject, a document type, a library, a person or a time — for example *the latest permit to work procedure* or *drawings changed last week*.";
        $out['suggest'] = ['Latest procedures', 'Documents changed this week', 'My documents'];
        return $out;
    }

    $docs = ask_search($f, $u);
    $relaxed = [];
    // a good librarian widens the search before saying no
    if (!$docs && $intent !== 'count') {   // (a count is never widened: the number must mean what was asked)
        foreach ([['period', 'the date limit'], ['ext', 'the file type'], ['ct', 'the document type'], ['owner', 'the author'], ['lib', 'the library'], ['status', 'the status']] as [$k, $label]) {
            $has = $k === 'period' ? (bool)$f['period'] : !empty($f[$k]);
            if (!$has) continue;
            $relaxed[] = $k;
            $docs = ask_search($f, $u, $relaxed);
            if ($docs) { $relaxedLabel = $label; break; }
        }
    }
    $out['chips'] = ask_chips($f);
    $out['total'] = count($docs);
    $desc = ask_describe($f, count($docs));
    $descNone = ask_describe($f, 2);

    if (!$docs && $intent === 'count') {
        $out['reply'][] = 'You can see **no** ' . $descNone . '.';
        $out['context'] = $f + ['_intent' => $intent];
        return $out;
    }
    if (!$docs) {
        $out['reply'][] = "I looked everywhere you have access to, but I couldn't find any $descNone.";
        if ($f['keywords']) $out['reply'][] = 'Try another word for it — a synonym, a tag name, or the document number if you know it.';
        $out['reply'][] = 'If it lives in a library you can’t open yet, an administrator can give you access.';
        $out['expert'] = ask_expert($f, $u);
        $out['context'] = $f + ['_intent' => $intent];
        audit('ask', 'search', null, mb_substr('Toto: ' . $q, 0, 200) . ' · no results');
        return $out;
    }
    if ($relaxed) {
        $out['reply'][] = 'Nothing matched exactly, so I left out ' . $relaxedLabel . ' — here is what comes closest.';
        foreach ($relaxed as $k) { if ($k === 'period') { $f['since'] = $f['until'] = null; $f['period'] = ''; } elseif ($k === 'status') $f['status'] = ''; else $f[$k] = []; }
        $out['chips'] = ask_chips($f);
        $desc = ask_describe($f, count($docs));
    }

    $top = $docs[0];
    $n = count($docs);
    if ($intent === 'expert') {
        // who knows most: authors of the matching documents (only documents this person can open), comments count a little
        $by = [];
        foreach ($docs as $i => $d) { $w = $i < 5 ? 1.0 : 0.6; $by[$d['owner_id']] = ['name' => $d['owner'], 'n' => ($by[$d['owner_id']]['n'] ?? 0) + 1, 'w' => ($by[$d['owner_id']]['w'] ?? 0) + $w]; }
        $ids = array_column($docs, 'id');
        foreach (all('SELECT c.user_id, u.name, COUNT(*) n FROM comments c JOIN users u ON u.id=c.user_id WHERE c.document_id IN (' . in_list($ids) . ') GROUP BY c.user_id, u.name') as $c)
            $by[(int)$c['user_id']] = ['name' => $c['name'], 'n' => $by[(int)$c['user_id']]['n'] ?? 0, 'w' => ($by[(int)$c['user_id']]['w'] ?? 0) + 0.3 * (int)$c['n'], 'c' => (int)$c['n']];
        uasort($by, fn($a, $b) => $b['w'] <=> $a['w']);
        $about = ask_describe(array_merge($f, ['ct' => []]), 2);
        $about = preg_replace('/^(documents?\s+)?(about\s+)?/u', '', $about);
        $list = array_slice($by, 0, 3, true);
        $names = array_map(fn($p) => '**' . $p['name'] . '** (' . ($p['n'] ? $p['n'] . ' document' . ($p['n'] > 1 ? 's' : '') : '') . (!empty($p['c']) ? ($p['n'] ? ', ' : '') . $p['c'] . ' comment' . ($p['c'] > 1 ? 's' : '') : '') . ')', $list);
        $first = reset($list);
        $out['reply'][] = 'For ' . ($about ?: 'that') . ', the go-to person is ' . array_shift($names) . '.';
        if ($names) $out['reply'][] = 'Also worth asking: ' . ask_join($names) . '.';
        if (count($by) === 1 && $n >= 2) $out['reply'][] = '⚠ Only ' . explode(' ', $first['name'])[0] . ' has written about this — that knowledge sits with one person.';
        $out['actions'] = [['label' => 'See it on the knowledge map', 'href' => '#/map' . ($f['terms'] ? '?focus=t' . $f['terms'][0] : '')]];
        $out['people'] = array_map(fn($id, $p) => ['id' => $id, 'name' => $p['name']], array_keys($list), $list);
    } elseif ($intent === 'count') {
        $out['reply'][] = 'You can see **' . $n . '** ' . ask_describe($f, $n) . '.';
        $byLib = [];
        foreach ($docs as $d) $byLib[$d['library']] = ($byLib[$d['library']] ?? 0) + 1;
        arsort($byLib);
        if (count($byLib) > 1) $out['reply'][] = 'By library: ' . implode(', ', array_map(fn($l, $c) => "$l $c", array_keys(array_slice($byLib, 0, 5, true)), array_slice($byLib, 0, 5, true))) . '.';
    } elseif ($intent === 'who') {
        $d = load_doc($top['id']);
        $pub = $d['published_version_id'] ? one('SELECT v.created_at, u.name FROM document_versions v LEFT JOIN users u ON u.id=v.uploaded_by WHERE v.id=?', [$d['published_version_id']]) : null;
        $appr = one("SELECT a.decided_at, u.name FROM approvals a JOIN users u ON u.id=a.decided_by WHERE a.document_id=? AND a.decision='approved' ORDER BY a.id DESC LIMIT 1", [$d['id']]);
        $s = ask_doc_ref($top) . ' belongs to **' . $top['owner'] . '**';
        if ($appr && approvals_on()) $s .= '; it was approved by **' . $appr['name'] . '** on ' . date('j M Y', strtotime((string)$appr['decided_at']));
        elseif ($pub) $s .= '; the version you see was published by **' . $pub['name'] . '** on ' . date('j M Y', strtotime((string)$pub['created_at']));
        $out['reply'][] = $s . '.';
        if ($n > 1) $out['reply'][] = 'If you meant another one, ' . ($n === 2 ? 'the other match is below.' : 'the other ' . ($n - 1) . ' matches are below.');
    } else {
        $passage = ($intent === 'answer' || $f['keywords']) ? ask_passage($docs, $f, $q) : null;
        if ($intent === 'answer' && $passage) {
            $out['reply'][] = 'Here’s what ' . ($passage['doc_id'] === $top['id'] ? ask_doc_ref($top) : '**' . $passage['title'] . '**') . ' says:';
            $out['passage'] = $passage;
            if ($n > 1) $out['reply2'] = 'I found ' . $n . ' ' . ask_describe($f, $n) . ' in all — the closest ones are below.';
        } else {
            if ($f['sort'] === 'newest') $lead = 'The latest is ' . ask_doc_ref($top) . ', updated ' . date('j M Y', strtotime((string)$top['modified'])) . ' by ' . $top['owner'] . '.';
            elseif ($f['sort'] === 'oldest') $lead = 'The oldest is ' . ask_doc_ref($top) . ', from ' . date('j M Y', strtotime((string)$top['modified'])) . '.';
            else $lead = ($n === 1 ? 'I found one: ' : 'The best match is ') . ask_doc_ref($top) . ' in ' . $top['library'] . '.';
            $out['reply'][] = ($n > 1 ? 'I found **' . $n . '** ' . $desc . '. ' : '') . $lead;
            if ($passage && $passage['doc_id'] === $top['id'] && $passage['complete']) { $out['passage'] = $passage; $out['reply2'] = null; }
            if ($intent === 'answer' && !$passage) $out['reply'][] = 'I couldn’t find a sentence that answers that directly, so open the document to check.';
        }
        if ($top['has_newer_draft'] ?? false) $out['reply'][] = 'A newer draft of it is being prepared.';
        if (($top['review_date'] ?? null) && $top['review_date'] < date('Y-m-d')) $out['reply'][] = 'Note: it was due for review on ' . date('j M Y', strtotime((string)$top['review_date'])) . ', so check it is still current.';
    }

    $out['docs'] = array_map('ask_doc_out', array_slice($docs, 0, $intent === 'count' ? 10 : 8));
    // follow-ups a librarian would offer
    if ($n > 3) {
        if (!$f['ct']) { $cts = []; foreach ($docs as $d) if ($d['content_type']) $cts[$d['content_type']] = ($cts[$d['content_type']] ?? 0) + 1; arsort($cts); foreach (array_slice(array_keys($cts), 0, 2) as $c) $out['suggest'][] = 'Only ' . mb_strtolower($c) . (preg_match('/s$/', $c) ? '' : 's'); }
        if (!$f['period']) $out['suggest'][] = 'Only from this year';
        if (!$f['ext']) { $ex = []; foreach ($docs as $d) $ex[$d['ext']] = ($ex[$d['ext']] ?? 0) + 1; if (($ex['pdf'] ?? 0) && ($ex['pdf'] ?? 0) < $n) $out['suggest'][] = 'Only PDFs'; }
    }
    if ($n > 1 && $f['sort'] !== 'newest') $out['suggest'][] = 'Newest first';
    if ($intent !== 'count' && $n > 1) $out['suggest'][] = 'How many are there?';
    $out['context'] = $f + ['_intent' => $intent];
    $out['search_q'] = trim(implode(' ', $f['keywords']));
    audit('ask', 'search', null, mb_substr('Toto: ' . $q, 0, 200) . " · $n found");
    return $out;
}
