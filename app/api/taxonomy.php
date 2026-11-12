<?php
declare(strict_types=1);

function api_taxonomy_get() {
    me();
    $types = all('SELECT * FROM content_types ORDER BY name');
    $map = [];
    foreach (all('SELECT content_type_id, field_id FROM content_type_fields') as $r) $map[(int)$r['content_type_id']][] = (int)$r['field_id'];
    $usage = [];
    foreach (all('SELECT content_type_id, COUNT(*) n FROM documents WHERE deleted_at IS NULL GROUP BY content_type_id') as $r) $usage[(int)$r['content_type_id']] = (int)$r['n'];
    foreach ($types as &$t) { $t['id'] = (int)$t['id']; $t['review_months'] = (int)$t['review_months']; $t['fields'] = $map[$t['id']] ?? []; $t['docs'] = $usage[$t['id']] ?? 0; }
    unset($t);
    $fields = all('SELECT * FROM fields ORDER BY sort, name');
    foreach ($fields as &$f) {
        $f['id'] = (int)$f['id']; $f['termset_id'] = $f['termset_id'] ? (int)$f['termset_id'] : null; $f['multi'] = (int)$f['multi'];
        $f['required'] = (int)$f['required']; $f['options'] = $f['options'] ? json_decode($f['options'], true) : null; $f['filterable'] = (int)$f['filterable'];
    }
    unset($f);
    $sets = all('SELECT * FROM termsets ORDER BY group_name, name');
    $termUse = [];
    foreach (all('SELECT term_id, COUNT(DISTINCT dt.document_id) n FROM document_terms dt JOIN documents d ON d.id=dt.document_id AND d.deleted_at IS NULL GROUP BY term_id') as $r) $termUse[(int)$r['term_id']] = (int)$r['n'];
    $terms = all('SELECT * FROM terms ORDER BY sort, label');
    $by = [];
    foreach ($terms as $t) {
        $by[(int)$t['termset_id']][] = ['id' => (int)$t['id'], 'parent_id' => $t['parent_id'] ? (int)$t['parent_id'] : null, 'label' => $t['label'],
            'synonyms' => $t['synonyms'], 'sort' => (int)$t['sort'], 'deprecated' => (int)$t['deprecated'], 'docs' => $termUse[(int)$t['id']] ?? 0];
    }
    foreach ($sets as &$s) { $s['id'] = (int)$s['id']; $s['navigable'] = (int)$s['navigable']; $s['terms'] = $by[$s['id']] ?? []; }
    return ['content_types' => $types, 'fields' => $fields, 'termsets' => $sets];
}

function api_taxonomy_type_save() {
    must_post(); require_admin();
    $id = iarg('id');
    $data = ['name' => sarg('name', '', 80), 'code' => strtoupper(preg_replace('/[^A-Za-z0-9]/', '', sarg('code', '', 8))), 'description' => sarg('description', '', 255),
        'color' => preg_match('/^#[0-9a-fA-F]{6}$/', sarg('color')) ? sarg('color') : '#5B6B73', 'review_months' => max(0, min(120, iarg('review_months')))];
    if ($data['name'] === '' || $data['code'] === '') fail('A content type needs a name and a short code (used in document numbers).');
    if ($id) update('content_types', $data, 'id=?', [$id]); else $id = insert('content_types', $data);
    if (is_array(arg('fields'))) {
        q('DELETE FROM content_type_fields WHERE content_type_id=?', [$id]);
        foreach (array_unique(array_map('intval', arg('fields'))) as $fid) if ($fid) insert('content_type_fields', ['content_type_id' => $id, 'field_id' => $fid]);
    }
    audit('content_type_save', 'content_type', $id, $data['name']);
    return ['id' => $id];
}
function api_taxonomy_type_delete() {
    must_post(); require_admin();
    $id = iarg('id');
    $n = (int)val('SELECT COUNT(*) FROM documents WHERE content_type_id=? AND deleted_at IS NULL', [$id]);
    if ($n) fail("$n documents use this content type. Change them first.");
    q('DELETE FROM content_type_fields WHERE content_type_id=?', [$id]);
    q('DELETE FROM content_types WHERE id=?', [$id]);
    audit('content_type_delete', 'content_type', $id);
    return [];
}

function api_taxonomy_field_save() {
    must_post(); require_admin();
    $id = iarg('id');
    $type = sarg('type', 'text');
    if (!in_array($type, ['text', 'number', 'date', 'choice', 'term', 'user', 'bool'], true)) fail('Unknown property type.');
    $opts = null;
    if ($type === 'choice') {
        $o = arg('options', []);
        if (is_string($o)) $o = preg_split('/\r?\n|,/', $o);
        $o = array_values(array_filter(array_map('trim', (array)$o)));
        if (!$o) fail('Add at least one choice.');
        $opts = json_encode($o, JSON_UNESCAPED_UNICODE);
    }
    $data = ['name' => sarg('name', '', 80), 'type' => $type, 'options' => $opts, 'termset_id' => $type === 'term' ? (iarg('termset_id') ?: null) : null,
        'multi' => arg('multi') ? 1 : 0, 'required' => arg('required') ? 1 : 0, 'description' => sarg('description', '', 255), 'filterable' => arg('filterable', 1) ? 1 : 0];
    if ($data['name'] === '') fail('Give the property a name.');
    if ($type === 'term' && !$data['termset_id']) fail('Choose the term set this property draws from.');
    if ($id) update('fields', $data, 'id=?', [$id]); else $id = insert('fields', $data + ['sort' => (int)val('SELECT COALESCE(MAX(sort),0)+1 FROM fields')]);
    audit('field_save', 'field', $id, $data['name']);
    return ['id' => $id];
}
function api_taxonomy_field_delete() {
    must_post(); require_admin();
    $id = iarg('id');
    foreach (['content_type_fields', 'document_meta'] as $t) q("DELETE FROM $t WHERE field_id=?", [$id]);
    q('DELETE FROM document_terms WHERE field_id=?', [$id]);
    q('DELETE FROM fields WHERE id=?', [$id]);
    audit('field_delete', 'field', $id);
    return [];
}

function api_taxonomy_termset_save() {
    must_post(); require_admin();
    $id = iarg('id');
    $data = ['name' => sarg('name', '', 120), 'group_name' => sarg('group_name', 'TGISL', 80) ?: 'TGISL', 'description' => sarg('description', '', 255), 'navigable' => arg('navigable', 1) ? 1 : 0];
    if ($data['name'] === '') fail('Give the term set a name.');
    if ($id) update('termsets', $data, 'id=?', [$id]); else $id = insert('termsets', $data);
    audit('termset_save', 'termset', $id, $data['name']);
    return ['id' => $id];
}
function api_taxonomy_termset_delete() {
    must_post(); require_admin();
    $id = iarg('id');
    if (val('SELECT id FROM fields WHERE termset_id=? LIMIT 1', [$id])) fail('A property uses this term set. Delete or change that property first.');
    $ids = array_map('intval', array_column(all('SELECT id FROM terms WHERE termset_id=?', [$id]), 'id'));
    q('DELETE FROM document_terms WHERE term_id IN (' . in_list($ids) . ')');
    q('DELETE FROM terms WHERE termset_id=?', [$id]);
    q('DELETE FROM termsets WHERE id=?', [$id]);
    audit('termset_delete', 'termset', $id);
    return [];
}

function api_taxonomy_term_save() {
    must_post(); require_admin();
    $id = iarg('id');
    $data = ['label' => sarg('label', '', 120), 'synonyms' => sarg('synonyms', '', 400), 'deprecated' => arg('deprecated') ? 1 : 0];
    if ($data['label'] === '') fail('A term needs a label.');
    if ($id) {
        if (array_key_exists('parent_id', input())) {
            $pid = iarg('parent_id') ?: null;
            if ($pid === $id) fail('A term cannot be its own parent.');
            $data['parent_id'] = $pid;
        }
        update('terms', $data, 'id=?', [$id]);
    } else {
        $set = iarg('termset_id');
        if (!val('SELECT id FROM termsets WHERE id=?', [$set])) fail('Choose a term set.');
        $pid = iarg('parent_id') ?: null;
        $id = insert('terms', $data + ['termset_id' => $set, 'parent_id' => $pid,
            'sort' => (int)val('SELECT COALESCE(MAX(sort),0)+1 FROM terms WHERE termset_id=? AND ' . ($pid ? 'parent_id=?' : 'parent_id IS NULL'), $pid ? [$set, $pid] : [$set])]);
    }
    // keep index fresh for docs using this term
    foreach (array_column(all('SELECT DISTINCT document_id FROM document_terms WHERE term_id=? LIMIT 500', [$id]), 'document_id') as $did) reindex_doc((int)$did);
    audit('term_save', 'term', $id, $data['label']);
    return ['id' => $id];
}
function api_taxonomy_term_delete() {
    must_post(); require_admin();
    $id = iarg('id');
    $ids = [$id]; $frontier = [$id];
    while ($frontier) { $k = array_map('intval', array_column(all('SELECT id FROM terms WHERE parent_id IN (' . in_list($frontier) . ')'), 'id')); $ids = array_merge($ids, $k); $frontier = $k; }
    $n = (int)val('SELECT COUNT(DISTINCT document_id) FROM document_terms WHERE term_id IN (' . in_list($ids) . ')');
    if ($n && sarg('force') !== '1') fail("$n documents are tagged with this term or its children.", 409, ['in_use' => $n]);
    q('DELETE FROM document_terms WHERE term_id IN (' . in_list($ids) . ')');
    q('DELETE FROM terms WHERE id IN (' . in_list($ids) . ')');
    audit('term_delete', 'term', $id);
    return [];
}
function api_taxonomy_term_merge() {
    must_post(); require_admin();
    $from = iarg('from'); $to = iarg('to');
    if (!$from || !$to || $from === $to) fail('Choose two different terms.');
    q('INSERT IGNORE INTO document_terms (document_id, term_id, field_id) SELECT document_id, ?, field_id FROM document_terms WHERE term_id=?', [$to, $from]);
    q('DELETE FROM document_terms WHERE term_id=?', [$from]);
    $label = (string)val('SELECT label FROM terms WHERE id=?', [$from]);
    $syn = (string)val('SELECT synonyms FROM terms WHERE id=?', [$to]);
    update('terms', ['synonyms' => mb_substr(trim($syn . ', ' . $label, ', '), 0, 400)], 'id=?', [$to]);
    q('UPDATE terms SET parent_id=? WHERE parent_id=?', [$to, $from]);
    q('DELETE FROM terms WHERE id=?', [$from]);
    audit('term_merge', 'term', $to, "Merged \"$label\"");
    return [];
}
