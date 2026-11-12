/* Text recognition (OCR) in the browser: makes scanned / picture-only PDFs and images searchable.
   Engine: tesseract.js + PDF.js, served from assets/ocr (no outside services; files never leave the company). */
'use strict';

const OCR_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'];
const OCRQ = { jobs: [], running: null, worker: null, idleTimer: null, done: 0, failed: 0, listeners: new Set() };
const absUrl = (p) => new URL(p, location.href).href;

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src; s.dataset.src = src; s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the text-recognition engine (' + src + '). Check that the assets/ocr folder was uploaded.'));
    document.head.appendChild(s);
  });
}

async function ocrWorker() {
  clearTimeout(OCRQ.idleTimer);
  if (OCRQ.worker) return OCRQ.worker;
  await loadScriptOnce('assets/ocr/tesseract.min.js');
  OCRQ.worker = await Tesseract.createWorker('eng', 1, {   // 1 = LSTM engine (accurate, uses the smaller core build)
    workerPath: absUrl('assets/ocr/worker.min.js'),
    corePath: absUrl('assets/ocr/core'),
    langPath: absUrl('assets/ocr/lang'),
    gzip: false,
    workerBlobURL: false,
    logger: (m) => { if (OCRQ.running && m.status === 'recognizing text') OCRQ.running.pageProgress = m.progress; notifyOcr(); },
  });
  // Automatic page layout (3). The library default (6, "one block of text") can skip rows in tables.
  await OCRQ.worker.setParameters({ tessedit_pageseg_mode: '3', preserve_interword_spaces: '1' });
  return OCRQ.worker;
}
async function pdfLib() {
  await loadScriptOnce('assets/ocr/pdf.min.js');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'assets/ocr/pdf.worker.min.js';
  return window.pdfjsLib;
}

/** Draws an image file onto a canvas (decoding is done by the browser, so WEBP/GIF/BMP work too). */
async function imageToCanvas(blob, maxSide = 3600) {
  const bmp = await createImageBitmap(blob);
  // small pictures are enlarged (up to 2×): recognition is far more accurate when letters are larger
  let k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  if (bmp.width < 2200) k = Math.min(2, 2200 / bmp.width, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close && bmp.close();
  return c;
}

/**
 * Reads the text of a file. PDFs: pages that already contain real text keep it; picture-only pages are recognised.
 * Returns { text, pages, ranPages, confidence }.
 */
async function recogniseFile(blob, ext, job) {
  ext = String(ext).toLowerCase();
  const worker = await ocrWorker();
  if (ext !== 'pdf') {
    job.pages = 1; job.page = 1; notifyOcr();
    const { data } = await worker.recognize(await imageToCanvas(blob));
    return { text: data.text || '', pages: 1, ranPages: 1, confidence: Math.round(data.confidence || 0) };
  }
  const lib = await pdfLib();
  const pdf = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
  job.pages = pdf.numPages; notifyOcr();
  const parts = []; let ran = 0, confSum = 0;
  for (let n = 1; n <= pdf.numPages; n++) {
    job.page = n; job.pageProgress = 0; notifyOcr();
    const page = await pdf.getPage(n);
    const tc = await page.getTextContent();
    const native = tc.items.map((i) => i.str + (i.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+/g, ' ').trim();
    if (native.replace(/\s/g, '').length >= 40) { parts.push(native); page.cleanup(); continue; }
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(4.5, Math.max(2, 2600 / base.width));     // ~300 dpi for an A4 page: best accuracy in tests
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    const { data } = await worker.recognize(c);
    parts.push(((native ? native + '\n' : '') + (data.text || '')).trim());
    ran++; confSum += data.confidence || 0;
    c.width = c.height = 0; page.cleanup();
  }
  pdf.destroy();
  return { text: parts.join('\n\n'), pages: pdf.numPages || job.pages, ranPages: ran, confidence: ran ? Math.round(confSum / ran) : 100 };
}

/* ---------- Background queue ---------- */
/** Adds a document version to the background queue. source: a File (just uploaded) or nothing (fetched from the server). */
function ocrEnqueue({ docId, versionId, title, ext, file = null }) {
  if (!OCR_EXT.includes(String(ext).toLowerCase())) return false;
  if (OCRQ.running?.versionId === versionId || OCRQ.jobs.some((j) => j.versionId === versionId)) return false;
  OCRQ.jobs.push({ docId, versionId, title, ext, file, state: 'queued', page: 0, pages: 0, pageProgress: 0 });
  notifyOcr();
  if (!OCRQ.running) runOcrQueue();
  return true;
}
function ocrJobFor(versionId) { return OCRQ.running?.versionId === versionId ? OCRQ.running : OCRQ.jobs.find((j) => j.versionId === versionId) || null; }

async function runOcrQueue() {
  while (OCRQ.jobs.length) {
    const job = OCRQ.jobs.shift();
    OCRQ.running = job; job.state = 'running'; notifyOcr();
    try {
      let blob = job.file;
      if (!blob) {
        const res = await fetch(`download.php?id=${job.docId}&v=${job.versionId}&inline=1`, { credentials: 'same-origin' });
        if (!res.ok) throw new Error((await res.text()).slice(0, 160) || 'Could not open the file (' + res.status + ').');
        blob = await res.blob();
      }
      const r = await recogniseFile(blob, job.ext, job);
      const saved = await api('docs.ocr_save', { id: job.docId, version_id: job.versionId, text: r.text.slice(0, 400000), pages: r.pages, ocr_pages_run: r.ranPages, confidence: r.confidence });
      job.state = 'done'; job.words = saved.words || 0; OCRQ.done++;
      if (r.ranPages) toast(saved.words ? `“${job.title}” is now searchable — ${saved.words} words recognised.` : `No readable text was found in “${job.title}”.`, saved.words ? '' : 'err');
    } catch (e) {
      job.state = 'failed'; job.error = e.message; OCRQ.failed++;
      toast(`Couldn't read text from “${job.title}”: ${e.message}`, 'err', 7000);
    }
    OCRQ.listeners.forEach((fn) => { try { fn(job); } catch (e) {} });
    OCRQ.running = null; notifyOcr();
  }
  // free the engine's memory after a quiet period
  OCRQ.idleTimer = setTimeout(async () => { if (!OCRQ.running && !OCRQ.jobs.length && OCRQ.worker) { await OCRQ.worker.terminate().catch(() => {}); OCRQ.worker = null; } }, 120000);
}

/* ---------- Progress chip ---------- */
function notifyOcr() {
  let chip = document.getElementById('ocrChip');
  const job = OCRQ.running;
  if (!job && !OCRQ.jobs.length) { chip?.remove(); return; }
  if (!chip) { chip = document.createElement('div'); chip.id = 'ocrChip'; chip.className = 'ocr-chip'; chip.setAttribute('role', 'status'); document.body.appendChild(chip); }
  const pct = job && job.pages ? Math.round(((job.page - 1) + (job.pageProgress || 0)) / job.pages * 100) : 0;
  const waiting = OCRQ.jobs.length;
  chip.innerHTML = `<span class="ocr-spin" aria-hidden="true"></span><div><b>Making ${waiting ? (waiting + 1) + ' documents' : 'a document'} searchable</b>
    <span>${job ? esc(job.title) + (job.pages > 1 ? ` · page ${job.page} of ${job.pages}` : '') : 'Starting…'}</span>
    <i class="ocr-bar"><i style="width:${pct}%"></i></i></div>`;
  chip.title = 'Text is read in this browser tab. Keep the tab open until it finishes.';
}
window.addEventListener('beforeunload', (e) => { if (OCRQ.running || OCRQ.jobs.length) { e.preventDefault(); e.returnValue = ''; } });

/* ---------- Admin: make existing documents searchable ---------- */
route('/admin/ocr', async (page) => {
  guardAdmin();
  const r = await api('docs.ocr_queue');
  setTitle('Searchable text');
  page.innerHTML = `${adminNav('ocr')}<div class="page-head"><div class="grow"><h1>Searchable text</h1>
    <p>Scanned PDFs, pictures pasted into Word, and photos contain no real text, so search can't see the words in them. Text recognition (OCR) reads those words so they become searchable. It runs in this browser tab — nothing is sent outside the company.</p></div>
    ${r.items.length ? `<button class="btn primary" id="ocrAll">${icon('sparkle', 'sm')}Make all ${r.items.length} searchable</button>` : ''}</div>
    <div class="stat-row"><div class="stat ${r.items.length ? 'warn' : ''}"><b>${r.items.length}</b><span>Documents without searchable text</span></div><div class="stat"><b>${r.done}</b><span>${r.done === 1 ? 'Version' : 'Versions'} already recognised</span></div></div>
    ${r.items.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Document</th><th>Library</th><th>Version</th><th>Size</th><th>Status</th></tr></thead><tbody>
      ${r.items.map((x) => `<tr data-v="${x.version_id}"><td><div class="doc-title">${fileIcon(x.ext, 'sm')}<div><a class="tt" href="#/doc/${x.id}">${esc(x.title)}</a><div class="nn">${esc(x.doc_number || '')}</div></div></div></td>
        <td>${esc(x.library)}</td><td class="ver">${esc(x.version)}${x.is_current ? '' : ' <span class="faint small">(published)</span>'}</td><td class="nowrap">${fmtSize(x.size)}</td>
        <td class="nowrap" data-st="${x.version_id}"><button class="btn sm" data-one="${x.version_id}">Make searchable</button></td></tr>`).join('')}
    </tbody></table></div>
    <p class="faint small">Allow roughly 5–15 seconds per page. Keep this tab open while it works; you can use other pages of the Hub meanwhile.</p>`
    : emptyState('check', 'Every document has searchable text', 'New scans and pictures are read automatically when they are uploaded.')}`;
  const byV = Object.fromEntries(r.items.map((x) => [x.version_id, x]));
  const paint = () => {
    r.items.forEach((x) => {
      const cell = page.querySelector(`[data-st="${x.version_id}"]`); if (!cell) return;
      const j = ocrJobFor(x.version_id);
      if (x._done) cell.innerHTML = x._done;
      else if (j && j.state === 'running') cell.innerHTML = `<span class="status pending">Reading${j.pages > 1 ? ` page ${j.page} of ${j.pages}` : '…'}</span>`;
      else if (j) cell.innerHTML = '<span class="faint">Waiting…</span>';
    });
  };
  const onJob = (job) => {
    const x = byV[job.versionId]; if (!x) return;
    x._done = job.state === 'done' ? `<span class="status published">${job.words} words</span>` : `<span class="status rejected" title="${esc(job.error || '')}">Failed</span>`;
    paint();
  };
  OCRQ.listeners.add(onJob);
  const timer = setInterval(paint, 700);
  const add = (x) => ocrEnqueue({ docId: x.id, versionId: x.version_id, title: x.title, ext: x.ext });
  page.querySelector('#ocrAll')?.addEventListener('click', (e) => { r.items.forEach(add); e.target.disabled = true; paint(); });
  page.addEventListener('click', (e) => { const b = e.target.closest('[data-one]'); if (b) { add(byV[+b.dataset.one]); paint(); } });
  return () => { OCRQ.listeners.delete(onJob); clearInterval(timer); };
});
