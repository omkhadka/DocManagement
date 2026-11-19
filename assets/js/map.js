/* Knowledge map: who knows what, how topics connect, which documents belong together */
'use strict';

route('/map', async (page, _, params) => {
  setTitle('Knowledge map');
  let mode = params.mode === 'docs' ? 'docs' : 'topics';
  let lib = +params.lib || 0;
  page.innerHTML = `
    <div class="page-h"><div><h1>Knowledge map</h1><p class="muted">Who knows what, how subjects connect, and which documents belong together — drawn from everything you can open.</p></div></div>
    <div class="km-bar">
      <div class="seg" id="kmMode"><button data-m="topics">${icon('users', 'sm')}Topics &amp; experts</button><button data-m="docs">${icon('file', 'sm')}Documents</button></div>
      <select class="input" id="kmLib" style="max-width:240px"><option value="0">All libraries</option></select>
      <div class="km-find"><input class="input" id="kmFind" placeholder="Find a topic, person or document…"></div>
      <span class="faint small" id="kmInfo"></span>
    </div>
    <div class="km-wrap">
      <div class="km-stage" id="kmStage"><svg id="kmSvg" class="km-svg"><g id="kmView"><g id="kmEdges"></g><g id="kmNodes"></g></g></svg>
        <div class="km-legend" id="kmLegend"></div>
        <div class="km-zoom"><button class="mini-btn" data-z="in" title="Zoom in">${icon('plus', 'sm')}</button><button class="mini-btn" data-z="out" title="Zoom out">−</button><button class="mini-btn" data-z="fit" title="Fit to screen">${icon('grid', 'sm')}</button></div>
        <div class="km-empty hidden" id="kmEmpty"></div>
      </div>
      <aside class="km-side" id="kmSide"></aside>
    </div>`;
  const svg = $('#kmSvg'), view = $('#kmView'), gE = $('#kmEdges'), gN = $('#kmNodes'), side = $('#kmSide'), stage = $('#kmStage');
  const NS = 'http://www.w3.org/2000/svg';
  let data = null, nodes = [], edges = [], byId = {}, adj = {}, raf = 0, alpha = 1, sel = null;
  let tx = 0, ty = 0, k = 1;
  const css = getComputedStyle(document.documentElement);
  const C = { topic: '#7BAA2A', person: '#1479B8', risk: '#E5484D' };

  const apply = () => { view.setAttribute('transform', `translate(${tx},${ty}) scale(${k})`); svg.classList.toggle('zoomed', k > 1.25); };
  const fit = () => {
    if (!nodes.length) return;
    const W = stage.clientWidth, H = stage.clientHeight;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    nodes.forEach((n) => { x0 = Math.min(x0, n.x - n.r); y0 = Math.min(y0, n.y - n.r); x1 = Math.max(x1, n.x + n.r); y1 = Math.max(y1, n.y + n.r); });
    k = Math.min(2.2, Math.max(0.25, Math.min(W / (x1 - x0 + 120), H / (y1 - y0 + 120))));
    tx = W / 2 - k * (x0 + x1) / 2; ty = H / 2 - k * (y0 + y1) / 2; apply();
  };

  const showHint = () => {
    side.innerHTML = `<div class="km-hint">${totoMark()}<div><b>How to read the map</b><p class="small muted">${mode === 'topics'
      ? 'Green circles are <b>topics</b> (tags), blue circles are <b>people</b>. A line means that person writes or comments on that topic; bigger means more documents. A <b style="color:var(--red)">red ring</b> means only one person has ever written about that topic — knowledge at risk if they leave.'
      : 'Each circle is a <b>document</b>, coloured by library. Lines join documents that are linked, share a tag, or that Toto found similar in meaning. Clusters are bodies of knowledge.'}
      </p><p class="small muted">Click anything to explore it. Drag to move, scroll to zoom.</p></div></div>`;
  };
  const load = async () => {
    cancelAnimationFrame(raf);
    $('#kmMode').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.m === mode));
    showHint();
    data = await api('map.graph', undefined, { query: { mode, library_id: lib || '' } });
    if (!$('#kmLib').options.length || $('#kmLib').options.length === 1) $('#kmLib').innerHTML = '<option value="0">All libraries</option>' + data.libraries.map((l) => `<option value="${l.id}" ${l.id === lib ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
    build();
  };

  const radius = (n) => n.type === 'person' ? 9 + Math.sqrt(n.count) * 4 : n.type === 'topic' ? 7 + Math.sqrt(n.count) * 5 : 6 + Math.min(10, Math.sqrt(n.count) * 1.5);
  const build = () => {
    nodes = data.nodes.map((n, i) => {
      const a = (i / data.nodes.length) * Math.PI * 2, rr = 120 + Math.random() * 220;
      return Object.assign({}, n, { x: Math.cos(a) * rr, y: Math.sin(a) * rr, vx: 0, vy: 0, r: 0 });
    });
    nodes.forEach((n) => { n.r = radius(n); });
    byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    // topic-to-topic lines only where subjects really travel together, so the map stays readable
    const withMin = data.edges.filter((e) => e.k === 'with').length > nodes.length * 1.5 ? 2 : 1;
    edges = data.edges.filter((e) => byId[e.s] && byId[e.t] && (e.k !== 'with' || e.w >= withMin)).map((e) => Object.assign({}, e, { a: byId[e.s], b: byId[e.t] }));
    adj = {}; edges.forEach((e) => { (adj[e.s] = adj[e.s] || []).push(e); (adj[e.t] = adj[e.t] || []).push(e); });
    $('#kmInfo').textContent = mode === 'topics'
      ? `${nodes.filter((n) => n.type === 'topic').length} topics · ${nodes.filter((n) => n.type === 'person').length} people · from ${data.total_docs} documents`
      : `${nodes.length} documents · ${edges.length} connections`;
    const empty = !nodes.length;
    $('#kmEmpty').classList.toggle('hidden', !empty);
    $('#kmEmpty').innerHTML = empty ? `${totoMark()}<div><b>Nothing to map yet.</b><p class="small muted">${mode === 'topics' ? 'Topics come from tags. Tag a few documents (Toto suggests them at upload) and the map fills in.' : 'Upload a few documents and they will appear here.'}</p></div>` : '';
    // draw
    gE.innerHTML = ''; gN.innerHTML = '';
    edges.forEach((e) => { const l = document.createElementNS(NS, 'line'); l.setAttribute('class', 'km-e km-e-' + e.k); l.setAttribute('stroke-width', Math.min(5, 0.7 + e.w * 0.6)); gE.appendChild(l); e.el = l; });
    nodes.forEach((n) => {
      const g = document.createElementNS(NS, 'g'); g.setAttribute('class', `km-n km-${n.type}${n.risk ? ' km-risk' : ''}${(n.type === 'topic' && n.count < 2) || (n.type === 'doc' && nodes.length > 40) ? ' km-minor' : ''}`); g.dataset.id = n.id;
      const fill = n.type === 'doc' ? (n.color || '#8A94A3') : C[n.type];
      g.innerHTML = `${n.risk ? `<circle r="${n.r + 5}" class="km-ring"/>` : ''}<circle r="${n.r}" fill="${esc(fill)}"/>${n.type === 'person' ? `<text class="km-ini" dy="0.35em">${esc(initials(n.label))}</text>` : ''}<text class="km-l" dy="${n.r + 13}">${esc(n.label.length > 34 ? n.label.slice(0, 32) + '…' : n.label)}</text><title>${esc(n.label)}${n.sub ? ' — ' + esc(n.sub) : ''}</title>`;
      gN.appendChild(g); n.el = g;
    });
    $('#kmLegend').innerHTML = mode === 'topics'
      ? `<span><i style="background:${C.topic}"></i>Topic</span><span><i style="background:${C.person}"></i>Person</span><span><i class="ring"></i>Only one person knows it</span>`
      : (() => { const used = new Set(nodes.map((n) => n.sub.split(' · ').pop())); return data.libraries.filter((l) => used.has(l.name)).map((l) => `<span><i style="background:${esc(l.color)}"></i>${esc(l.name)}</span>`).join('') + '<span><i class="dash"></i>Similar text</span>'; })();
    alpha = 1; sel = null;
    const t0 = performance.now();
    for (let i = 0; i < 160; i++) tick(true);   // settle most of it before the first paint
    draw(); fit();
    const loop = () => { if (alpha > 0.01 && document.body.contains(svg)) { tick(); draw(); raf = requestAnimationFrame(loop); } };
    raf = requestAnimationFrame(loop);
    void t0;
    if (params.focus && byId[params.focus]) select(byId[params.focus], true);
  };

  // a small force simulation: nodes push apart, lines pull together, everything drifts to the middle
  const tick = (fast) => {
    const n = nodes.length; if (!n) return;
    const rep = mode === 'topics' ? 7000 : 3200;
    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j]; let dx = a.x - b.x, dy = a.y - b.y; let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 0.5; }
        if (d2 > 250000) continue;
        const f = rep / d2 * alpha, d = Math.sqrt(d2);
        const minD = a.r + b.r + 14; const push = d < minD ? (minD - d) * 0.25 : 0;
        const fx = (dx / d) * (f + push), fy = (dy / d) * (f + push);
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      }
    }
    edges.forEach((e) => {
      const a = e.a, b = e.b, dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      const len = (mode === 'topics' ? (e.k === 'with' ? 150 : 110) : (e.k === 'tag' ? 130 : 80)) + a.r + b.r;
      const f = (d - len) * 0.02 * Math.min(1.5, e.k === 'with' ? e.w * 0.4 : e.w) * alpha;
      const fx = dx / d * f, fy = dy / d * f;
      if (!a.fixed) { a.vx += fx; a.vy += fy; } if (!b.fixed) { b.vx -= fx; b.vy -= fy; }
    });
    nodes.forEach((a) => {
      a.vx -= a.x * 0.004 * alpha; a.vy -= a.y * 0.004 * alpha;
      if (a.fixed) { a.vx = a.vy = 0; return; }
      a.vx *= 0.55; a.vy *= 0.55; a.x += Math.max(-30, Math.min(30, a.vx)); a.y += Math.max(-30, Math.min(30, a.vy));
    });
    alpha *= fast ? 0.985 : 0.975;
  };
  const draw = () => {
    edges.forEach((e) => { e.el.setAttribute('x1', e.a.x); e.el.setAttribute('y1', e.a.y); e.el.setAttribute('x2', e.b.x); e.el.setAttribute('y2', e.b.y); });
    nodes.forEach((n) => n.el.setAttribute('transform', `translate(${n.x},${n.y})`));
  };
  const nudge = () => { if (alpha < 0.2) { alpha = 0.2; cancelAnimationFrame(raf); const loop = () => { if (alpha > 0.01 && document.body.contains(svg)) { tick(); draw(); raf = requestAnimationFrame(loop); } }; raf = requestAnimationFrame(loop); } };

  /* ---- selection and the side panel ---- */
  const docRow = (id) => { const d = data.docs[id]; if (!d) return ''; return `<a class="km-doc" href="#/doc/${d.id}">${fileIcon(d.ext, 'sm')}<span><b>${esc(d.title)}</b><span class="faint small">${esc([d.doc_number, d.library].filter(Boolean).join(' · '))}</span></span></a>`; };
  const neighbourIds = (n) => new Set((adj[n.id] || []).map((e) => (e.s === n.id ? e.t : e.s)));
  const select = (n, center) => {
    sel = n;
    const near = neighbourIds(n);
    nodes.forEach((m) => m.el.classList.toggle('dim', m !== n && !near.has(m.id)));
    nodes.forEach((m) => { m.el.classList.toggle('sel', m === n); m.el.classList.toggle('near', near.has(m.id)); });
    edges.forEach((e) => e.el.classList.toggle('dim', e.s !== n.id && e.t !== n.id));
    if (center) { const W = stage.clientWidth, H = stage.clientHeight; k = Math.max(k, 1); tx = W / 2 - k * n.x; ty = H / 2 - k * n.y; apply(); }
    let html = '';
    if (n.type === 'topic') {
      const ex = n.experts || [];
      const top = ex[0];
      html = `<div class="km-h"><span class="km-dot" style="background:${C.topic}"></span><div><h3>${esc(n.label)}</h3><span class="faint small">${esc(n.sub || 'Topic')} · ${plural(n.count, 'document')}</span></div></div>
        <div class="km-toto">${totoMark()}<p>${top ? `<b>${esc(top.name)}</b> is the go-to person for ${esc(n.label)} — ${top.docs} of ${n.count} document${n.count > 1 ? 's' : ''}.` : 'Nobody has written about this yet.'}
          ${n.risk ? `<br><b style="color:var(--red)">⚠ Only ${esc(top.name.split(' ')[0])} has written about this.</b> If ${esc(top.name.split(' ')[0])} moves on, this knowledge leaves too — ask a colleague to review or co-author.` : ''}</p></div>
        ${ex.length ? `<div class="label">Who knows it</div><div class="km-people">${ex.slice(0, 8).map((p) => `<button class="km-person" data-go="p${p.id}">${avatar(p.name)}<span>${esc(p.name)}</span><span class="faint small">${plural(p.docs, 'doc')}</span></button>`).join('')}</div>` : ''}
        <div class="label">Documents</div><div class="km-docs">${(n.docs || []).slice(0, 15).map(docRow).join('')}</div>
        <a class="btn sm" href="#/search?q=${encodeURIComponent('tag:"' + n.label + '"')}">${icon('search', 'sm')}Search this topic</a>`;
    } else if (n.type === 'person') {
      const tps = (n.topics || []).map((t) => byId['t' + t]).filter(Boolean);
      const sole = (n.sole || []).map((t) => byId['t' + t]).filter(Boolean);
      html = `<div class="km-h">${avatar(n.label)}<div><h3>${esc(n.label)}</h3><span class="faint small">${esc(n.sub || '')}</span></div></div>
        <div class="km-stats"><div><b>${n.count}</b><span>documents</span></div><div><b>${n.comments || 0}</b><span>comments</span></div><div><b>${tps.length}</b><span>topics</span></div></div>
        ${sole.length ? `<div class="km-toto risk">${totoMark()}<p><b>Knowledge only ${esc(n.label.split(' ')[0])} holds:</b> ${sole.map((t) => esc(t.label)).join(', ')}. Worth a handover note or a second author.</p></div>` : ''}
        ${tps.length ? `<div class="label">Knows about</div><div class="chips">${tps.map((t) => `<button class="chip ${t.risk ? 'risk' : ''}" data-go="${t.id}">${esc(t.label)}</button>`).join('')}</div>` : ''}
        <div class="label">Documents</div><div class="km-docs">${(n.docs || []).slice(0, 15).map(docRow).join('')}</div>
        <a class="btn sm" href="#/person/${n.id.slice(1)}">${icon('user', 'sm')}Profile</a>`;
    } else {
      const d = data.docs[n.doc];
      const links = (adj[n.id] || []).map((e) => ({ other: e.s === n.id ? e.t : e.s, e })).sort((a, b) => b.e.w - a.e.w);
      html = `<div class="km-h"><span class="km-dot" style="background:${esc(n.color || '#8A94A3')}"></span><div><h3>${esc(n.label)}</h3><span class="faint small">${esc(n.sub)}</span></div></div>
        <div class="small muted">${esc(d.content_type || 'Document')} · by ${esc(d.owner)} · ${esc(fmtDate(d.modified))}</div>
        <a class="btn sm primary" href="#/doc/${d.id}">${icon('open', 'sm')}Open document</a>
        ${links.length ? `<div class="label">Connected to</div><div class="km-docs">${links.slice(0, 12).map(({ other, e }) => { const o = byId[other]; return `<button class="km-doc" data-go="${other}">${fileIcon(data.docs[o.doc]?.ext || '', 'sm')}<span><b>${esc(o.label)}</b><span class="faint small">${e.k === 'similar' ? `${e.sim}% similar text` : e.k === 'link' ? 'linked' : 'shares a tag'}</span></span></button>`; }).join('')}</div>` : '<p class="small muted">Not connected to anything yet — a good candidate for tags or a related-document link.</p>'}`;
    }
    side.innerHTML = html + `<button class="linklike small" data-clear>Clear selection</button>`;
  };
  const clearSel = () => { sel = null; nodes.forEach((m) => m.el.classList.remove('dim', 'sel', 'near')); edges.forEach((e) => e.el.classList.remove('dim')); showHint(); };

  /* ---- pan, zoom, drag ---- */
  let drag = null, panning = null, moved = false;
  const pt = (ev) => { const r = svg.getBoundingClientRect(); return { x: (ev.clientX - r.left - tx) / k, y: (ev.clientY - r.top - ty) / k }; };
  svg.addEventListener('pointerdown', (ev) => {
    moved = false;
    const g = ev.target.closest('.km-n');
    if (g) { drag = byId[g.dataset.id]; drag.fixed = true; svg.setPointerCapture(ev.pointerId); return; }
    panning = { x: ev.clientX, y: ev.clientY, tx, ty }; svg.setPointerCapture(ev.pointerId);
  });
  svg.addEventListener('pointermove', (ev) => {
    if (drag) { const p = pt(ev); drag.x = p.x; drag.y = p.y; moved = true; nudge(); draw(); }
    else if (panning) { const dx = ev.clientX - panning.x, dy = ev.clientY - panning.y; if (Math.abs(dx) + Math.abs(dy) > 3) moved = true; tx = panning.tx + dx; ty = panning.ty + dy; apply(); }
  });
  svg.addEventListener('pointerup', (ev) => {
    if (drag) { const n = drag; drag = null; if (!moved) { n.fixed = false; select(n); } return; }
    if (panning && !moved && !ev.target.closest('.km-n')) clearSel();
    panning = null;
  });
  svg.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const r = svg.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
    const nk = Math.max(0.2, Math.min(4, k * (ev.deltaY < 0 ? 1.15 : 0.87)));
    tx = mx - (mx - tx) * nk / k; ty = my - (my - ty) * nk / k; k = nk; apply();
  }, { passive: false });
  page.querySelector('.km-zoom').addEventListener('click', (e) => {
    const z = e.target.closest('[data-z]')?.dataset.z; if (!z) return;
    if (z === 'fit') return fit();
    const W = stage.clientWidth / 2, H = stage.clientHeight / 2, nk = Math.max(0.2, Math.min(4, k * (z === 'in' ? 1.3 : 0.77)));
    tx = W - (W - tx) * nk / k; ty = H - (H - ty) * nk / k; k = nk; apply();
  });
  side.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]'); if (go && byId[go.dataset.go]) { e.preventDefault(); select(byId[go.dataset.go], true); return; }
    if (e.target.closest('[data-clear]')) clearSel();
  });
  $('#kmMode').addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (!b || b.dataset.m === mode) return; mode = b.dataset.m; history.replaceState(null, '', `#/map?mode=${mode}${lib ? '&lib=' + lib : ''}`); load(); });
  $('#kmLib').addEventListener('change', (e) => { lib = +e.target.value; history.replaceState(null, '', `#/map?mode=${mode}${lib ? '&lib=' + lib : ''}`); load(); });
  $('#kmFind').addEventListener('input', debounce((e) => {
    const q = e.target.value.trim().toLowerCase(); if (!q) return;
    const hit = nodes.find((n) => n.label.toLowerCase().startsWith(q)) || nodes.find((n) => n.label.toLowerCase().includes(q));
    if (hit) select(hit, true);
  }, 250));
  window.addEventListener('resize', debounce(() => document.body.contains(svg) && fit(), 300));
  await load();
});
