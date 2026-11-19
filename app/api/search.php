<?php
declare(strict_types=1);
require_once KM_APP . '/api/docs.php';
require_once KM_APP . '/toto_ask.php';
require_once KM_APP . '/toto_chat.php';
require_once KM_APP . '/toto_help.php';

/** Splits "pump type:pdf owner:grace \"fire water\"" into words, phrases and operators. */
function parse_query(string $q): array {
    $ops = []; $words = []; $phrases = [];
    preg_match_all('/(\w+):"([^"]*)"|(\w+):(\S+)|"([^"]+)"|(\S+)/u', $q, $m, PREG_SET_ORDER);
    foreach ($m as $t) {
        if (!empty($t[1])) $ops[strtolower($t[1])][] = $t[2];
        elseif (!empty($t[3]) && in_array(strtolower($t[3]), ['type', 'ext', 'lib', 'library', 'ct', 'owner', 'by', 'status', 'tag', 'after', 'before', 'number', 'no'], true)) $ops[strtolower($t[3])][] = $t[4];
        elseif (!empty($t[5])) $phrases[] = $t[5];
        else { $w = trim($t[0]); if ($w !== '') $words[] = $w; }
    }
    return compact('ops', 'words', 'phrases');
}

function api_search_query() {
    $u = me();
    $raw = sarg('q', '', 500);
    $pq = parse_query($raw);
    $where = ['d.deleted_at IS NULL']; $p = [];
    $o = $pq['ops'];
    foreach (array_merge($o['type'] ?? [], $o['ext'] ?? []) as $e) { $where[] = 'd.current_version_id IN (SELECT id FROM document_versions WHERE ext = ?)'; $p[] = strtolower(ltrim($e, '.')); }
    foreach (array_merge($o['lib'] ?? [], $o['library'] ?? []) as $l) { $where[] = 'd.library_id IN (SELECT id FROM libraries WHERE code = ? OR name LIKE ?)'; $p[] = strtoupper($l); $p[] = "%$l%"; }
    foreach ($o['ct'] ?? [] as $c) { $where[] = 'd.content_type_id IN (SELECT id FROM content_types WHERE code = ? OR name LIKE ?)'; $p[] = strtoupper($c); $p[] = "%$c%"; }
    foreach (array_merge($o['owner'] ?? [], $o['by'] ?? []) as $w) { $where[] = 'd.owner_id IN (SELECT id FROM users WHERE name LIKE ? OR email LIKE ?)'; $p[] = "%$w%"; $p[] = "$w%"; }
    foreach ($o['status'] ?? [] as $s) { $where[] = 'd.status = ?'; $p[] = strtolower($s); }
    foreach ($o['tag'] ?? [] as $t) { $where[] = 'd.id IN (SELECT document_id FROM document_terms WHERE term_id IN (SELECT id FROM terms WHERE label LIKE ? OR synonyms LIKE ?))'; $p[] = "%$t%"; $p[] = "%$t%"; }
    foreach ($o['after'] ?? [] as $t) if (strtotime($t)) { $where[] = 'd.updated_at >= ?'; $p[] = date('Y-m-d', strtotime($t)); }
    foreach ($o['before'] ?? [] as $t) if (strtotime($t)) { $where[] = 'd.updated_at < ?'; $p[] = date('Y-m-d', strtotime($t . ' +1 day')); }
    foreach (array_merge($o['number'] ?? [], $o['no'] ?? []) as $t) { $where[] = 'd.doc_number LIKE ?'; $p[] = "%$t%"; }
    if ($lib = iarg('library_id')) { $where[] = 'd.library_id = ?'; $p[] = $lib; }
    if ($libs = array_filter(array_map('intval', (array)arg('libs', [])))) $where[] = 'd.library_id IN (' . in_list($libs) . ')';
    $baseWhere = $where; $baseP = $p;
    doc_filters($where, $p);

    $words = $pq['words']; $phrases = $pq['phrases'];
    $hasText = $words || $phrases;
    $scoreSql = '0';
    $sp = [];
    $textWhere = [];
    $tp = [];
    if ($hasText) {
        $ft = [];
        foreach ($words as $w) {
            $clean = preg_replace('/[+\-><()~*"@]+/u', ' ', $w);
            foreach (preg_split('/\s+/', trim($clean)) as $piece) if (mb_strlen($piece) >= 3) $ft[] = '+' . $piece . '*';
        }
        foreach ($phrases as $ph) $ft[] = '+"' . str_replace('"', '', $ph) . '"';
        $ftq = implode(' ', $ft);
        // Text match via FULLTEXT where possible, plus LIKE so short codes (e.g. "C2", "PO") and stopwords still match.
        $likeParts = [];
        foreach (array_merge($words, $phrases) as $w) {
            $likeParts[] = '(d.title LIKE ? OR d.doc_number LIKE ? OR d.keywords LIKE ? OR d.search_text LIKE ? OR d.description LIKE ?)';
            $lk = '%' . addcslashes($w, '%_') . '%';
            array_push($tp, $lk, $lk, $lk, $lk, $lk);
        }
        $likeSql = implode(' AND ', $likeParts);
        if ($ftq !== '') {
            $textWhere[] = "(MATCH(d.title, d.description, d.keywords, d.doc_number, d.search_text) AGAINST (? IN BOOLEAN MODE) OR ($likeSql))";
            $tp = array_merge([$ftq], $tp);
            $scoreSql = 'MATCH(d.title, d.description, d.keywords, d.doc_number, d.search_text) AGAINST (?)';
            $sp[] = implode(' ', array_merge($words, $phrases));
        } else $textWhere[] = "($likeSql)";
    }
    $allWhere = array_merge($where, $textWhere);
    $sql = 'SELECT ' . DOC_COLS . ", $scoreSql AS _score FROM documents d WHERE " . implode(' AND ', $allWhere) . ' ORDER BY _score DESC, d.updated_at DESC LIMIT 1500';
    try {
        $rows = all($sql, array_merge($sp, $p, $tp));
    } catch (Throwable $e) { // FULLTEXT not available → LIKE only
        $rows = [];
    }

    // Relevance boosts on title / number / terms
    $needle = mb_strtolower(trim(implode(' ', array_merge($words, $phrases))));
    $texts = [];
    if ($rows && $hasText) foreach (all('SELECT id, LEFT(search_text, 200000) t FROM documents WHERE id IN (' . in_list(array_column($rows, 'id')) . ')') as $t) $texts[(int)$t['id']] = (string)$t['t'];
    foreach ($rows as &$r) {
        $s = (float)$r['_score'];
        if ($needle !== '') {
            $tl = mb_strtolower($r['title']);
            if (mb_strpos($tl, $needle) !== false) $s += 12;
            foreach (array_merge($words, $phrases) as $w) if (mb_strpos($tl, mb_strtolower($w)) !== false) $s += 4;
            if ($r['doc_number'] && mb_stripos($r['doc_number'], $needle) !== false) $s += 25;
            if (mb_stripos((string)$r['keywords'], $needle) !== false) $s += 5;
            $r['_snippet'] = make_snippet($texts[(int)$r['id']] ?? (string)$r['description'], array_merge($phrases, $words));
        }
        if ($r['status'] === 'published') $s += 1;
        $s += min(3, log(1 + (int)$r['views']) / 2);
        $r['_score'] = $s;
    }
    unset($r);
    $docs = hydrate_docs($rows, $u);
    if (sarg('sort', 'relevance') === 'relevance') usort($docs, fn($a, $b) => ($b['score'] ?? 0) <=> ($a['score'] ?? 0));
    else sort_docs($docs);

    // Facets from the result set before user filters
    $facetRows = $hasText || $baseWhere !== $where ? all('SELECT ' . DOC_COLS . ' FROM documents d WHERE ' . implode(' AND ', array_merge($baseWhere, $textWhere)) . ' LIMIT 1500',
        array_merge($baseP, $tp)) : $rows;
    $facets = doc_facets(hydrate_docs($facetRows, $u));

    // Synonym-aware related terms for refining
    $related = [];
    if ($needle !== '' && mb_strlen($needle) >= 2) {
        foreach (all('SELECT t.id, t.label, s.name AS termset FROM terms t JOIN termsets s ON s.id=t.termset_id WHERE t.deprecated=0 AND (t.label LIKE ? OR t.synonyms LIKE ?) LIMIT 6',
            ["%$needle%", "%$needle%"]) as $t) $related[] = ['id' => (int)$t['id'], 'label' => $t['label'], 'termset' => $t['termset']];
    }
    $people = [];
    if ($needle !== '' && !$pq['ops']) {
        $people = all('SELECT u.id, u.name, u.job_title, u.email, d.name AS department FROM users u LEFT JOIN departments d ON d.id=u.department_id
            WHERE u.active=1 AND (u.name LIKE ? OR u.job_title LIKE ?) LIMIT 4', ["%$needle%", "%$needle%"]);
    }
    if ($needle !== '' || $pq['ops']) audit('search', 'search', null, mb_substr($raw, 0, 200));
    return ['docs' => array_slice($docs, 0, 500), 'total' => count($docs), 'facets' => $facets, 'related_terms' => $related, 'people' => $people,
        'parsed' => ['words' => $words, 'phrases' => $phrases, 'ops' => $pq['ops']]];
}

function api_search_suggest() {
    $u = me();
    $q = sarg('q', '', 120);
    if (mb_strlen($q) < 1) return ['docs' => [], 'terms' => [], 'people' => [], 'libraries' => []];
    $like = '%' . addcslashes($q, '%_') . '%';
    $rows = all('SELECT ' . DOC_COLS . ' FROM documents d WHERE d.deleted_at IS NULL AND (d.title LIKE ? OR d.doc_number LIKE ? OR d.keywords LIKE ?) ORDER BY d.views DESC LIMIT 40', [$like, $like, $like]);
    $docs = array_slice(hydrate_docs($rows, $u), 0, 6);
    $terms = all('SELECT t.id, t.label, s.name AS termset FROM terms t JOIN termsets s ON s.id=t.termset_id WHERE t.deprecated=0 AND (t.label LIKE ? OR t.synonyms LIKE ?) ORDER BY t.label LIMIT 5', [$like, $like]);
    $people = all('SELECT u.id, u.name, u.job_title, d.name AS department FROM users u LEFT JOIN departments d ON d.id=u.department_id WHERE u.active=1 AND u.name LIKE ? LIMIT 4', [$like]);
    $libs = [];
    $ctx = perm_ctx($u);
    foreach (all('SELECT id, name, code, color FROM libraries WHERE deleted_at IS NULL AND (name LIKE ? OR code LIKE ?) LIMIT 5', [$like, $like]) as $l)
        if (($ctx['lib'][(int)$l['id']] ?? 0) > 0) $libs[] = $l;
    return ['docs' => $docs, 'terms' => $terms, 'people' => $people, 'libraries' => $libs];
}

function api_search_saved() {
    $u = me();
    return ['items' => all('SELECT id, name, query, created_at FROM saved_searches WHERE user_id=? ORDER BY name', [$u['id']])];
}
function api_search_save() {
    must_post();
    $u = me();
    $name = sarg('name', '', 120);
    if ($name === '') fail('Name the search so you can find it again.');
    $id = insert('saved_searches', ['user_id' => $u['id'], 'name' => $name, 'query' => mb_substr(json_encode(arg('query', [])), 0, 4000)]);
    return ['id' => $id];
}
function api_search_unsave() {
    must_post();
    q('DELETE FROM saved_searches WHERE id=? AND user_id=?', [iarg('id'), me()['id']]);
    return [];
}

/** Ask Toto: a question in plain words → a librarian's answer (only documents this person can open). */
function api_search_ask() {
    must_post();
    $u = me();
    if (!ai_on()) fail('Toto is switched off. An administrator can switch it on in Settings.');
    $in = input();
    $q = is_scalar($in['q'] ?? null) ? (string)$in['q'] : '';
    if (trim($q) === '' && empty($in['remove'])) fail('Type a question for Toto.');
    // a person asks at conversation speed; scripts that hammer the endpoint are slowed down
    $now = time();
    $_SESSION['ask_times'] = array_values(array_filter((array)($_SESSION['ask_times'] ?? []), fn($t) => $t > $now - 60));
    if (count($_SESSION['ask_times']) >= 40) fail('That was a lot of questions in a minute — give Toto a moment and ask again.', 429);
    $_SESSION['ask_times'][] = $now;
    $ctx = ask_clean_context($in['context'] ?? null);
    // filters sent back by the browser are re-checked: libraries this person can't open are dropped
    if ($ctx) $ctx['lib'] = array_values(array_filter($ctx['lib'], fn($id) => (bool)val('SELECT id FROM libraries WHERE id=? AND deleted_at IS NULL', [$id]) && container_level($id, null, $u) >= LVL_READ));
    if ($ctx && isset($in['context']['_intent']) && in_array($in['context']['_intent'], ['find', 'count', 'who', 'answer'], true)) $ctx['_intent'] = $in['context']['_intent'];
    $remove = array_slice(array_filter((array)($in['remove'] ?? []), 'is_array'), 0, 20);
    $q = trim(mb_substr($q, 0, 400));
    $chat = chat_clean_state($in['chat'] ?? null);
    $prefix = [];
    if ($q !== '' && !$remove) {
        // 1. Toto's temper (insults, shouting, impatience, repeats, apologies)
        [$chat, $override, $prefix] = toto_temper($q, $chat, $u);
        if ($override) return $override + ['context' => $ctx];
        // 2. "how do I …" about the platform
        if ($h = toto_help($q, $u)) {
            return ['intent' => 'help', 'reply' => array_merge($prefix, [str_replace('%s', '**' . $h['title'] . '**', chat_pick(['Sure! %s, step by step:', 'Easy one — %s:', 'Happy to explain. %s:', 'Here’s how it works — %s:']))]),
                'steps' => $h['steps'], 'actions' => $h['actions'], 'mood' => 'happy', 'chat' => $chat, 'context' => $ctx, 'docs' => [], 'chips' => [], 'total' => 0,
                'suggest' => ['What else can you do?']];
        }
        // 3. small talk
        if ($c = toto_chat($q, $chat, $u)) {
            $c['reply'] = array_merge($prefix, $c['reply']);
            return $c + ['context' => $ctx];
        }
    }
    // 4. the librarian
    $r = toto_ask($q, $ctx, $remove, $u);
    $r['reply'] = array_merge($prefix, $r['reply']);
    $r['chat'] = $chat;
    $r['mood'] = $r['mood'] ?? (($chat['annoy'] ?? 0) >= 2 ? 'grumpy' : ($r['total'] ? 'happy' : 'sorry'));
    return $r;
}
