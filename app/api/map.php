<?php
/**
 * Knowledge map: who knows what, how topics connect, and which documents belong together.
 * Built only from documents the person asking can open.
 */
declare(strict_types=1);

const MAP_MAX_DOCS = 400;

function api_map_graph() {
    $u = me();
    $mode = sarg('mode', 'topics', 10) === 'docs' ? 'docs' : 'topics';
    $lib = iarg('library_id');
    $w = ['d.deleted_at IS NULL']; $p = [];
    if ($lib) { if (container_level($lib, null, $u) < LVL_READ) fail('You can’t open that library.', 403); $w[] = 'd.library_id = ?'; $p[] = $lib; }
    $rows = all('SELECT ' . DOC_COLS . ' FROM documents d WHERE ' . implode(' AND ', $w) . ' ORDER BY d.updated_at DESC LIMIT ' . (MAP_MAX_DOCS * 2), $p);
    $docs = array_slice(hydrate_docs($rows, $u), 0, MAP_MAX_DOCS);   // only what this person can open
    $ids = array_column($docs, 'id');
    $byId = array_column($docs, null, 'id');
    $out = ['mode' => $mode, 'nodes' => [], 'edges' => [], 'docs' => [], 'total_docs' => count($docs),
        'libraries' => array_values(array_map(fn($l) => ['id' => (int)$l['id'], 'name' => $l['name'], 'color' => $l['color']],
            array_filter(all('SELECT id, name, color FROM libraries WHERE deleted_at IS NULL ORDER BY name'), fn($l) => container_level((int)$l['id'], null, $u) >= LVL_READ)))];
    if (!$docs) return $out;

    foreach ($docs as $d) $out['docs'][$d['id']] = ['id' => $d['id'], 'title' => $d['title'], 'doc_number' => $d['doc_number'], 'library' => $d['library'], 'library_color' => $d['library_color'],
        'ext' => $d['ext'], 'owner_id' => $d['owner_id'], 'owner' => $d['owner'], 'content_type' => $d['content_type'], 'modified' => $d['modified'], 'views' => (int)$d['views'],
        'terms' => array_map(fn($t) => (int)$t['id'], $d['terms'])];

    // comments count as knowledge too (only on documents this person can see)
    $comments = all('SELECT document_id, user_id, COUNT(*) n FROM comments WHERE document_id IN (' . in_list($ids) . ') GROUP BY document_id, user_id');

    if ($mode === 'topics') {
        $terms = []; $people = []; $pt = []; $tt = [];
        foreach ($docs as $d) {
            $tids = array_values(array_unique(array_map(fn($t) => (int)$t['id'], $d['terms'])));
            foreach ($d['terms'] as $t) {
                $tid = (int)$t['id'];
                $terms[$tid] = $terms[$tid] ?? ['label' => $t['label'], 'set' => '', 'docs' => [], 'authors' => []];
                $terms[$tid]['docs'][$d['id']] = true;
                $terms[$tid]['authors'][$d['owner_id']] = ($terms[$tid]['authors'][$d['owner_id']] ?? 0) + 1;
                $pt[$d['owner_id']][$tid] = ($pt[$d['owner_id']][$tid] ?? 0) + 1;
            }
            $people[$d['owner_id']] = $people[$d['owner_id']] ?? ['name' => $d['owner'], 'docs' => [], 'comments' => 0];
            $people[$d['owner_id']]['docs'][$d['id']] = true;
            for ($i = 0; $i < count($tids); $i++) for ($j = $i + 1; $j < count($tids); $j++) {
                $k = min($tids[$i], $tids[$j]) . '-' . max($tids[$i], $tids[$j]);
                $tt[$k] = ($tt[$k] ?? 0) + 1;
            }
        }
        foreach ($comments as $c) {
            $d = $byId[(int)$c['document_id']] ?? null; if (!$d) continue;
            $uid = (int)$c['user_id'];
            $people[$uid] = $people[$uid] ?? ['name' => '', 'docs' => [], 'comments' => 0];
            $people[$uid]['comments'] += (int)$c['n'];
            foreach ($d['terms'] as $t) $pt[$uid][(int)$t['id']] = ($pt[$uid][(int)$t['id']] ?? 0) + 0.5 * (int)$c['n'];
        }
        $missing = array_keys(array_filter($people, fn($x) => $x['name'] === ''));
        if ($missing) foreach (all('SELECT id, name FROM users WHERE id IN (' . in_list($missing) . ')') as $r) $people[(int)$r['id']]['name'] = $r['name'];
        $meta = $people ? array_column(all('SELECT u.id, u.job_title, d.name AS department FROM users u LEFT JOIN departments d ON d.id=u.department_id WHERE u.id IN (' . in_list(array_keys($people)) . ')'), null, 'id') : [];

        if ($terms) foreach (all('SELECT t.id, s.name FROM terms t JOIN termsets s ON s.id=t.termset_id WHERE t.id IN (' . in_list(array_keys($terms)) . ')') as $r) $terms[(int)$r['id']]['set'] = $r['name'];
        foreach ($terms as $tid => $t) {
            $n = count($t['docs']);
            $authors = $t['authors']; arsort($authors);
            $out['nodes'][] = ['id' => "t$tid", 'type' => 'topic', 'label' => $t['label'], 'sub' => $t['set'], 'count' => $n, 'docs' => array_keys($t['docs']),
                'experts' => array_map(fn($uid, $c) => ['id' => $uid, 'name' => $people[$uid]['name'] ?? '', 'docs' => $c], array_keys($authors), array_values($authors)),
                // knowledge that sits with one person only
                'risk' => $n >= 2 && count($authors) === 1];
        }
        foreach ($people as $uid => $pp) {
            $topics = $pt[$uid] ?? []; arsort($topics);
            $out['nodes'][] = ['id' => "p$uid", 'type' => 'person', 'label' => $pp['name'], 'sub' => trim(($meta[$uid]['job_title'] ?? '') . (isset($meta[$uid]['department']) && $meta[$uid]['department'] ? ' · ' . $meta[$uid]['department'] : ''), ' ·'),
                'count' => count($pp['docs']), 'comments' => $pp['comments'], 'docs' => array_keys($pp['docs']), 'topics' => array_slice(array_keys($topics), 0, 12),
                'sole' => array_values(array_filter(array_keys($topics), fn($tid) => isset($terms[$tid]) && count($terms[$tid]['authors']) === 1 && count($terms[$tid]['docs']) >= 2 && isset($terms[$tid]['authors'][$uid])))];
            foreach ($topics as $tid => $wgt) $out['edges'][] = ['s' => "p$uid", 't' => "t$tid", 'w' => round($wgt, 1), 'k' => 'knows'];
        }
        foreach ($tt as $k => $wgt) { [$a, $b] = explode('-', $k); $out['edges'][] = ['s' => "t$a", 't' => "t$b", 'w' => $wgt, 'k' => 'with']; }
        return $out;
    }

    // documents: explicit links + Toto's text similarity
    foreach ($docs as $d) $out['nodes'][] = ['id' => 'd' . $d['id'], 'type' => 'doc', 'label' => $d['title'], 'sub' => trim($d['doc_number'] . ' · ' . $d['library'], ' ·'),
        'color' => $d['library_color'], 'count' => max(1, (int)$d['views']), 'doc' => $d['id']];
    $seen = [];
    foreach (all('SELECT document_id a, related_id b FROM document_links WHERE document_id IN (' . in_list($ids) . ') AND related_id IN (' . in_list($ids) . ')') as $l) {
        $k = min($l['a'], $l['b']) . '-' . max($l['a'], $l['b']); if (isset($seen[$k])) continue; $seen[$k] = 1;
        $out['edges'][] = ['s' => 'd' . $l['a'], 't' => 'd' . $l['b'], 'w' => 3, 'k' => 'link'];
    }
    $vecs = [];
    foreach (array_chunk($ids, 200) as $chunk) foreach (all('SELECT document_id, vec FROM ai_index WHERE document_id IN (' . in_list($chunk) . ')') as $r) $vecs[(int)$r['document_id']] = json_decode((string)$r['vec'], true) ?: [];
    $vid = array_keys($vecs);
    $best = [];
    for ($i = 0, $n = count($vid); $i < $n; $i++) for ($j = $i + 1; $j < $n; $j++) {
        $s = ai_cosine($vecs[$vid[$i]], $vecs[$vid[$j]]);
        if ($s < 0.22) continue;
        $best[$vid[$i]][$vid[$j]] = $s; $best[$vid[$j]][$vid[$i]] = $s;
    }
    foreach ($best as $a => $list) {
        arsort($list);
        foreach (array_slice($list, 0, 3, true) as $b => $s) {
            $k = min($a, $b) . '-' . max($a, $b); if (isset($seen[$k])) continue; $seen[$k] = 1;
            $out['edges'][] = ['s' => "d$a", 't' => "d$b", 'w' => round($s * 4, 2), 'k' => 'similar', 'sim' => (int)round($s * 100)];
        }
    }
    // shared tags hold documents of one topic together loosely
    $byTerm = [];
    foreach ($docs as $d) foreach ($d['terms'] as $t) $byTerm[(int)$t['id']][] = $d['id'];
    foreach ($byTerm as $list) {
        if (count($list) > 12) continue;   // very common tags would only make a hairball
        for ($i = 0; $i < count($list); $i++) for ($j = $i + 1; $j < count($list); $j++) {
            $k = min($list[$i], $list[$j]) . '-' . max($list[$i], $list[$j]); if (isset($seen[$k])) continue; $seen[$k] = 1;
            $out['edges'][] = ['s' => 'd' . $list[$i], 't' => 'd' . $list[$j], 'w' => 0.8, 'k' => 'tag'];
        }
    }
    return $out;
}
