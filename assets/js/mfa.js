/* Two-step verification: sign-in code step, set-up with QR code, recovery codes, profile panel */
'use strict';

/* ---------- QR code (assets/qrcode.js, MIT, bundled locally) ---------- */
function qrSvg(text, px = 200) {
  if (typeof qrcode !== 'function') return '<div class="faint small">QR code unavailable — use the key below.</div>';
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  const n = q.getModuleCount(), m = 4, size = n + m * 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
  return `<svg viewBox="0 0 ${size} ${size}" width="${px}" height="${px}" shape-rendering="crispEdges" role="img" aria-label="QR code for your authenticator app"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#0E2A3B"/></svg>`;
}
const groupKey = (k) => k.replace(/(.{4})/g, '$1 ').trim();

function otpInput(id = 'otp') {
  return `<input class="input otp" id="${id}" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="7" placeholder="000000" aria-label="6-digit code">`;
}
/** Keeps an OTP box to digits and calls onFull when 6 digits are entered. */
function wireOtp(input, onFull) {
  input.addEventListener('input', () => {
    if (input.dataset.mode === 'recovery') return;
    input.value = input.value.replace(/\D/g, '').slice(0, 6);
    if (input.value.length === 6) onFull();
  });
}

/* ---------- Sign-in, step 2 ---------- */
function loginPanel(html) {
  if (!$('.login-form')) renderLogin();
  const p = $('.login-form');
  p.innerHTML = html;
  return p;
}

function renderMfaVerify(opts = {}) {
  setTitle('Two-step verification');
  const days = opts.remember_days ?? 30;
  const p = loginPanel(`
    <h1>Enter your code</h1>
    <p class="muted">${opts.name ? esc(opts.name.split(' ')[0]) + ', open' : 'Open'} Google Authenticator on your phone and enter the 6-digit code shown for <b>${esc(S.settings.site_name)}</b>.</p>
    <form id="mfaForm" class="mfa-form" novalidate>
      <div class="field"><label for="otp" id="otpLabel">Authenticator code</label>${otpInput()}<span class="hint" id="otpHint">The code changes every 30 seconds.</span></div>
      ${days > 0 ? `<label class="check"><input type="checkbox" id="mfaRemember"><span>Trust this device for ${days} days<br><span class="small muted">Don't tick this on a shared or public computer.</span></span></label>` : ''}
      <div id="mfaErr" class="alert red hidden">${icon('alert')}<span></span></div>
      <button class="btn primary" style="height:44px" type="submit">Verify</button>
      <div class="mfa-links"><button type="button" class="linklike" id="useRecovery">Use a recovery code instead</button><button type="button" class="linklike" id="mfaBack">Back to sign in</button></div>
    </form>
    <p class="login-foot">Lost your phone and your recovery codes? Ask a platform administrator to reset two-step verification for your account.</p>`);
  const f = $('#mfaForm', p), inp = $('#otp', p), btn = f.querySelector('button[type=submit]');
  setTimeout(() => inp.focus(), 20);
  const submit = async () => {
    if (btn.disabled) return;
    const code = inp.value.trim();
    if (!code) return inp.focus();
    btn.disabled = true; btn.textContent = 'Checking…';
    try {
      const r = await api('auth.mfa_verify', { code, remember: $('#mfaRemember', p)?.checked ? 1 : 0 });
      S.user = r.user; S.csrf = r.csrf; S.settings = r.settings; S.dir = S.tax = S.libs = null;
      await startApp();
    } catch (err) {
      if (err.status === 440 || err.status === 429) return renderLogin(err.message);
      const box = $('#mfaErr', p); box.classList.remove('hidden'); box.querySelector('span').textContent = err.message;
      btn.disabled = false; btn.textContent = 'Verify'; inp.value = ''; inp.focus();
    }
  };
  f.onsubmit = (e) => { e.preventDefault(); submit(); };
  wireOtp(inp, submit);
  $('#useRecovery', p).onclick = (e) => {
    const rec = inp.dataset.mode !== 'recovery';
    inp.dataset.mode = rec ? 'recovery' : '';
    inp.value = ''; inp.maxLength = rec ? 12 : 7; inp.placeholder = rec ? 'xxxx-xxxx' : '000000';
    inp.inputMode = rec ? 'text' : 'numeric'; inp.classList.toggle('otp', !rec); inp.classList.toggle('mono', rec);
    $('#otpLabel', p).textContent = rec ? 'Recovery code' : 'Authenticator code';
    $('#otpHint', p).textContent = rec ? 'Each recovery code works once.' : 'The code changes every 30 seconds.';
    e.target.textContent = rec ? 'Use the authenticator app instead' : 'Use a recovery code instead';
    inp.focus();
  };
  $('#mfaBack', p).onclick = async () => { await api('auth.mfa_cancel', {}).catch(() => {}); renderLogin(); };
}

/* ---------- Set-up (used at sign-in and from the profile page) ---------- */
async function mfaSetupFlow(host, { pending = false, rememberDays = 0, onDone } = {}) {
  host.innerHTML = '<div class="loading"><div class="boot-mark"></div></div>';
  let r;
  try { r = await api('auth.mfa_setup_begin', {}); }
  catch (e) { if (e.status === 401) return; host.innerHTML = `<div class="alert red">${icon('alert')}<span>${esc(e.message)}</span></div>`; return; }
  host.innerHTML = `
    <ol class="mfa-steps">
      <li><b>Install an authenticator app</b><span>Google Authenticator from the App Store or Google Play. Microsoft Authenticator also works.</span></li>
      <li><b>Scan this QR code</b><span>In the app tap <b>+</b> → <b>Scan a QR code</b>.</span>
        <div class="qr-wrap"><div class="qr-box">${qrSvg(r.uri)}</div>
          <div class="qr-alt"><span class="small muted">Can't scan? Choose <b>Enter a setup key</b> and type:</span>
            <code class="secret" id="mfaSecret">${esc(groupKey(r.secret))}</code>
            <span class="small muted">Account: ${esc(r.account)} · Time based</span>
            <button type="button" class="btn sm" id="copyKey">${icon('link', 'sm')}Copy key</button></div></div></li>
      <li><b>Enter the 6-digit code from the app</b>
        <div class="mfa-confirm">${otpInput('setupOtp')}<button type="button" class="btn primary" id="setupGo">Turn on</button></div>
        ${pending && rememberDays > 0 ? `<label class="check" style="margin-top:10px"><input type="checkbox" id="setupRemember"><span>Trust this device for ${rememberDays} days</span></label>` : ''}
        <div id="setupErr" class="alert red hidden" style="margin-top:10px">${icon('alert')}<span></span></div></li>
    </ol>`;
  const inp = $('#setupOtp', host), go = $('#setupGo', host);
  $('#copyKey', host).onclick = () => { navigator.clipboard?.writeText(r.secret).then(() => toast('Key copied.')); };
  const confirm = async () => {
    if (go.disabled) return;
    if (inp.value.length !== 6) return inp.focus();
    go.disabled = true; go.textContent = 'Checking…';
    try {
      const res = await api('auth.mfa_setup_confirm', { code: inp.value, remember: $('#setupRemember', host)?.checked ? 1 : 0 });
      if (res.user) { S.user = res.user; S.csrf = res.csrf; S.settings = res.settings; S.dir = S.tax = S.libs = null; }
      showRecoveryCodes(host, res.codes, { onContinue: onDone, first: true });
    } catch (e) {
      if (e.status === 401) return;
      const box = $('#setupErr', host); box.classList.remove('hidden'); box.querySelector('span').textContent = e.message;
      go.disabled = false; go.textContent = 'Turn on'; inp.value = ''; inp.focus();
      if (e.status === 409 || e.status === 429) setTimeout(() => mfaSetupFlow(host, { pending, rememberDays, onDone }), 1800);
    }
  };
  wireOtp(inp, confirm);
  go.onclick = confirm;
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirm(); });
  setTimeout(() => inp.focus(), 30);
}

function showRecoveryCodes(host, codes, { onContinue, first = false } = {}) {
  const text = `${S.settings.site_name} — recovery codes\nAccount: ${S.user?.email || ''}\nCreated: ${new Date().toLocaleString('en-GB')}\n\n` +
    codes.join('\n') + '\n\nEach code can be used once instead of an authenticator code. Keep them somewhere safe.\n';
  host.innerHTML = `
    ${first ? `<div class="alert teal">${icon('check')}<div class="grow"><b>Two-step verification is on</b>From now on you'll enter a code from your phone after your password.</div></div>` : ''}
    <div><h3 style="margin-bottom:6px">Save your recovery codes</h3>
    <p class="muted small" style="margin:0">If you lose your phone, each of these codes lets you sign in once. They're shown only now — download or print them and keep them somewhere safe, away from your phone.</p></div>
    <div class="codes-grid">${codes.map((c) => `<code>${esc(c)}</code>`).join('')}</div>
    <div class="btn-row"><button type="button" class="btn" id="dlCodes">${icon('download', 'sm')}Download .txt</button><button type="button" class="btn" id="cpCodes">${icon('link', 'sm')}Copy</button><button type="button" class="btn" id="prCodes">${icon('file', 'sm')}Print</button></div>
    <label class="check"><input type="checkbox" id="ackCodes"><span>I've saved my recovery codes</span></label>
    <button type="button" class="btn primary" id="codesDone" disabled style="height:42px">Continue</button>`;
  $('#dlCodes', host).onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = 'TGISL-KM-recovery-codes.txt'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $('#cpCodes', host).onclick = () => navigator.clipboard?.writeText(text).then(() => toast('Recovery codes copied.'));
  $('#prCodes', host).onclick = () => {
    const w = window.open('', '_blank', 'width=480,height=640');
    if (!w) return toast('Allow pop-ups to print, or use Download.', 'err');
    w.document.write(`<pre style="font:15px/1.7 monospace;padding:24px">${esc(text)}</pre>`); w.document.close(); w.focus(); w.print();
  };
  $('#ackCodes', host).onchange = (e) => { $('#codesDone', host).disabled = !e.target.checked; };
  $('#codesDone', host).onclick = () => onContinue && onContinue();
}

/** Full-page set-up when the organisation requires it (at sign-in, or for someone already signed in). */
function renderMfaEnrollGate({ pending = false, rememberDays = 0 } = {}) {
  setTitle('Set up two-step verification');
  const p = loginPanel(`
    <h1>Set up two-step verification</h1>
    <p class="muted">${esc(S.settings.site_name)} requires a second step for your account. After your password you'll enter a code from an app on your phone, so a stolen password alone can't open the documents.</p>
    <div id="mfaSetupHost" class="mfa-setup"></div>
    <div class="mfa-links" style="margin-top:14px"><button type="button" class="linklike" id="mfaGateOut">${pending ? 'Back to sign in' : 'Sign out'}</button></div>`);
  p.classList.add('wide');
  $('#mfaGateOut', p).onclick = async () => {
    if (pending) await api('auth.mfa_cancel', {}).catch(() => {}); else await api('auth.logout', {}).catch(() => {});
    S.user = null; const s = await api('auth.session'); S.csrf = s.csrf; renderLogin();
  };
  mfaSetupFlow($('#mfaSetupHost', p), {
    pending, rememberDays,
    onDone: async () => { if (S.user) { S.user.mfa_enabled = 1; S.user.mfa_must_enroll = false; } location.hash = ''; await startApp(); },
  });
}

/* ---------- Profile panel ---------- */
async function mfaProfilePanel(host) {
  const st = await api('auth.mfa_status');
  const devs = st.devices || [];
  const browser = (ua) => { ua = ua || ''; const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser'; const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone / iPad' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : ''; return b + (os ? ' on ' + os : ''); };
  host.innerHTML = `<div class="panel-h"><h3>Two-step verification</h3>${st.enabled ? '<span class="pill" style="color:var(--green)">' + icon('shield', 'sm') + 'On</span>' : '<span class="pill">Off</span>'}</div>
    <div class="panel-b" style="display:grid;gap:14px">
    ${st.enabled ? `
      <p class="muted small" style="margin:0">On since ${esc(fmtDate(st.enabled_at))}. After your password you enter a code from your authenticator app.${st.required ? ' Required for your role.' : ''}</p>
      <dl class="kv"><dt>Recovery codes</dt><dd>${st.recovery_left} unused${st.recovery_left <= 3 ? ' <span style="color:var(--amber)">· running low</span>' : ''}</dd>
        <dt>Trusted devices</dt><dd>${devs.length ? devs.map((d) => `${esc(browser(d.user_agent))} <span class="faint small">· until ${esc(fmtDate(d.expires_at))}</span>`).join('<br>') : '<span class="faint">None</span>'}</dd></dl>
      <div class="btn-row"><button class="btn" id="mfaNewCodes">${icon('refresh', 'sm')}New recovery codes</button>
        ${devs.length ? `<button class="btn" id="mfaForget">${icon('x', 'sm')}Forget trusted devices</button>` : ''}
        ${st.required ? '' : `<button class="btn danger" id="mfaOff">Turn off</button>`}</div>`
    : `<p class="muted small" style="margin:0">Add a second step to your sign-in: after your password, enter a 6-digit code from Google Authenticator on your phone. Someone who learns your password still can't get in.</p>
      <div><button class="btn primary" id="mfaOn">${icon('shield', 'sm')}Turn on two-step verification</button></div>`}
    </div>`;
  const reload = () => mfaProfilePanel(host);
  $('#mfaOn', host)?.addEventListener('click', () => {
    const m = modal({ title: 'Turn on two-step verification', size: 'wide', body: '<div id="mSetup" class="mfa-setup"></div>', onClose: reload });
    mfaSetupFlow(m.$('#mSetup'), { onDone: () => { S.user.mfa_enabled = 1; m.close(); toast('Two-step verification is on.'); } });
  });
  const askCode = (title, ok, extra = '') => new Promise((resolve) => {
    let done = false;
    const m = modal({ title, body: `${extra}<div class="field"><label for="ac">Code from your authenticator app</label>${otpInput('ac')}<span class="hint">Or enter one of your recovery codes.</span></div>`,
      foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>${esc(ok)}</button>`, onClose: () => { if (!done) resolve(null); } });
    m.$('#ac').maxLength = 12;
    m.$('#ac').addEventListener('input', (e) => { if (/^\d/.test(e.target.value)) e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); });
    m.$('[data-ok]').onclick = () => { done = true; const v = { code: m.$('#ac').value.trim(), password: m.$('#ap')?.value }; m.close(); resolve(v); };
  });
  $('#mfaNewCodes', host)?.addEventListener('click', async () => {
    const v = await askCode('New recovery codes', 'Create new codes', '<p class="muted small" style="margin:0">Your old recovery codes stop working.</p>'); if (!v) return;
    const r = await run(api('auth.mfa_recovery_new', { code: v.code }));
    const m = modal({ title: 'New recovery codes', body: '<div id="rc" style="display:grid;gap:14px"></div>', onClose: reload });
    showRecoveryCodes(m.$('#rc'), r.codes, { onContinue: () => m.close() });
  });
  $('#mfaForget', host)?.addEventListener('click', async () => { await run(api('auth.mfa_devices_forget', {}), (r) => r.message); reload(); });
  $('#mfaOff', host)?.addEventListener('click', async () => {
    const v = await askCode('Turn off two-step verification', 'Turn off', '<p class="muted small" style="margin:0">Your account will be protected by your password only.</p><div class="field"><label for="ap">Password</label><input class="input" type="password" id="ap" autocomplete="current-password"></div>');
    if (!v) return;
    await run(api('auth.mfa_disable', v), (r) => r.message); S.user.mfa_enabled = 0; reload();
  });
}
