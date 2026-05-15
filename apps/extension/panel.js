// panel.js — runs inside panel.html

const LOCAL_SERVER = 'http://localhost:4242';

// ── State ──────────────────────────────────────────────────────────────────────
let selectedEl = null;   // { selector, tag, classes, styles, rect, text }
let isPicking  = false;
let serverUp   = false;
let pendingChanges = {}; // { 'css-prop': 'value' }
let toastTimer = null;

// ── Helpers ────────────────────────────────────────────────────────────────────

function send(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(resp);
    });
  });
}

function toast(msg, ms = 2000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function px(val) { return parseFloat(val) || 0; }

function setLabel(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

// ── Section collapse toggle ────────────────────────────────────────────────────

document.querySelectorAll('.section-header').forEach(btn => {
  btn.addEventListener('click', () => {
    const name = btn.dataset.section;
    const body = document.getElementById('sec-' + name);
    const chevron = btn.querySelector('.chevron');
    body.classList.toggle('collapsed');
    chevron.textContent = body.classList.contains('collapsed') ? '▸' : '▾';
  });
});

// ── Pick button ────────────────────────────────────────────────────────────────

document.getElementById('pick-btn').addEventListener('click', async () => {
  if (isPicking) {
    isPicking = false;
    document.getElementById('pick-btn').classList.remove('active');
    document.getElementById('pick-btn').textContent = '⊕ Pick';
    await send({ type: 'ot:stop-pick' });
  } else {
    isPicking = true;
    document.getElementById('pick-btn').classList.add('active');
    document.getElementById('pick-btn').textContent = '✕ Cancel';
    await send({ type: 'ot:start-pick' });
  }
});

// ── Receive selected element from content script ───────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'ot:element-selected') return;

  isPicking = false;
  document.getElementById('pick-btn').classList.remove('active');
  document.getElementById('pick-btn').textContent = '⊕ Pick';

  selectedEl = msg.info;
  pendingChanges = {};
  renderInspector(selectedEl);
});

// ── Render inspector with element styles ──────────────────────────────────────

function renderInspector(info) {
  const s = info.styles;

  document.getElementById('empty').style.display = 'none';
  document.getElementById('el-header').style.display = 'block';
  document.getElementById('inspector').style.display = 'block';
  document.getElementById('actions').style.display = 'flex';

  document.getElementById('el-selector').textContent = info.selector;
  document.getElementById('el-meta').textContent =
    `<${info.tag}> · ${info.rect.w}×${info.rect.h}px${info.classes.length ? ' · .' + info.classes.slice(0,2).join('.') : ''}`;

  // Color
  const bgHex = toHexFallback(s.backgroundColor);
  setVal('bg-color', bgHex); setVal('bg-text', bgHex);
  const txHex = toHexFallback(s.color);
  setVal('text-color', txHex); setVal('text-text', txHex);
  const bdHex = toHexFallback(s.borderColor);
  setVal('border-color', bdHex); setVal('border-text', bdHex);

  // Typography
  const fs = px(s.fontSize) || 14;
  setVal('font-size', fs); setLabel('lbl-fontsize', `Size ${fs}px`);
  const fw = parseFloat(s.fontWeight) || 400;
  setVal('font-weight', fw); setLabel('lbl-fontweight', `Weight ${fw}`);
  const lh = parseFloat(s.lineHeight) || 1.5;
  setVal('line-height', lh); setLabel('lbl-lineheight', `Line H ${lh}`);
  setVal('text-align', s.textAlign || 'left');

  // Spacing
  const pt = px(s.paddingTop), pr = px(s.paddingRight),
        pb = px(s.paddingBottom), pl = px(s.paddingLeft),
        mt = px(s.marginTop), mb = px(s.marginBottom);
  setVal('padding-top', pt);    setLabel('lbl-pt', `Pad Top ${pt}px`);
  setVal('padding-right', pr);  setLabel('lbl-pr', `Pad Right ${pr}px`);
  setVal('padding-bottom', pb); setLabel('lbl-pb', `Pad Bot ${pb}px`);
  setVal('padding-left', pl);   setLabel('lbl-pl', `Pad Left ${pl}px`);
  setVal('margin-top', mt);     setLabel('lbl-mt', `Margin T ${mt}px`);
  setVal('margin-bottom', mb);  setLabel('lbl-mb', `Margin B ${mb}px`);

  // Layout
  const br = px(s.borderRadius), op = parseFloat(s.opacity) || 1;
  setVal('border-radius', br); setLabel('lbl-br', `Radius ${br}px`);
  setVal('opacity', op);       setLabel('lbl-op', `Opacity ${op}`);
  setVal('display', s.display || 'block');
  setVal('width', s.width || 'auto');
  setVal('height', s.height || 'auto');
}

function toHexFallback(val) {
  if (!val) return '#000000';
  if (val.startsWith('#')) return val;
  const m = val.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return '#000000';
  return '#' + [m[1], m[2], m[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
}

// ── Wire up all controls ──────────────────────────────────────────────────────

function wireControl(id, cssProp, transform, labelId, labelFn) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', () => {
    const val = transform ? transform(el.value) : el.value;
    if (labelId && labelFn) setLabel(labelId, labelFn(el.value));
    applyLive(cssProp, val);
  });
}

function applyLive(prop, value) {
  if (!selectedEl) return;
  pendingChanges[prop] = value;
  send({ type: 'ot:apply-style', selector: selectedEl.selector, prop, value });
}

// Color pairs (picker + text in sync)
function wireColorPair(pickerId, textId, cssProp) {
  const picker = document.getElementById(pickerId);
  const text = document.getElementById(textId);
  picker.addEventListener('input', () => { text.value = picker.value; applyLive(cssProp, picker.value); });
  text.addEventListener('input', () => {
    if (/^#[0-9a-fA-F]{6}$/.test(text.value)) { picker.value = text.value; applyLive(cssProp, text.value); }
  });
}

wireColorPair('bg-color', 'bg-text', 'background-color');
wireColorPair('text-color', 'text-text', 'color');
wireColorPair('border-color', 'border-text', 'border-color');

wireControl('font-size',   'font-size',   v => `${v}px`, 'lbl-fontsize',   v => `Size ${v}px`);
wireControl('font-weight', 'font-weight', null,           'lbl-fontweight', v => `Weight ${v}`);
wireControl('line-height', 'line-height', null,           'lbl-lineheight', v => `Line H ${parseFloat(v).toFixed(2)}`);
wireControl('text-align',  'text-align',  null);

wireControl('padding-top',    'padding-top',    v => `${v}px`, 'lbl-pt', v => `Pad Top ${v}px`);
wireControl('padding-right',  'padding-right',  v => `${v}px`, 'lbl-pr', v => `Pad Right ${v}px`);
wireControl('padding-bottom', 'padding-bottom', v => `${v}px`, 'lbl-pb', v => `Pad Bot ${v}px`);
wireControl('padding-left',   'padding-left',   v => `${v}px`, 'lbl-pl', v => `Pad Left ${v}px`);
wireControl('margin-top',     'margin-top',     v => `${v}px`, 'lbl-mt', v => `Margin T ${v}px`);
wireControl('margin-bottom',  'margin-bottom',  v => `${v}px`, 'lbl-mb', v => `Margin B ${v}px`);

wireControl('border-radius', 'border-radius', v => `${v}px`, 'lbl-br', v => `Radius ${v}px`);
wireControl('opacity',       'opacity',       null,           'lbl-op', v => `Opacity ${parseFloat(v).toFixed(2)}`);
wireControl('display',       'display',       null);
wireControl('width',         'width',         null);
wireControl('height',        'height',        null);

// ── Reset button ──────────────────────────────────────────────────────────────

document.getElementById('btn-reset').addEventListener('click', async () => {
  if (!selectedEl) return;
  pendingChanges = {};
  await send({ type: 'ot:reset-styles', selector: selectedEl.selector });
  renderInspector(selectedEl); // re-render with original values
  toast('Preview reset');
});

// ── Apply to Source button ────────────────────────────────────────────────────

document.getElementById('btn-apply').addEventListener('click', async () => {
  if (!selectedEl || !serverUp) return;
  const entries = Object.entries(pendingChanges);
  if (!entries.length) { toast('No changes to apply'); return; }

  try {
    const r = await fetch(`${LOCAL_SERVER}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selector: selectedEl.selector,
        changes: entries.map(([property, value]) => ({ property, value })),
      }),
    });
    const data = await r.json();
    if (data.ok) toast(`Applied ${entries.length} change(s) to source ✓`, 3000);
    else toast('Apply failed: ' + (data.error || 'unknown'), 4000);
  } catch {
    toast('Server not reachable', 3000);
  }
});

// ── Check local server availability ──────────────────────────────────────────

async function checkServer() {
  try {
    const r = await fetch(`${LOCAL_SERVER}/version`, { signal: AbortSignal.timeout(2000) });
    serverUp = r.ok;
  } catch {
    serverUp = false;
  }
  const applyBtn = document.getElementById('btn-apply');
  const banner = document.getElementById('server-banner');
  if (serverUp) {
    applyBtn.disabled = false;
    applyBtn.title = 'Write changes to source files';
    banner.classList.remove('show');
  } else {
    applyBtn.disabled = true;
    applyBtn.title = 'Start local server to enable';
    if (selectedEl) banner.classList.add('show');
  }
}

// Check on load and every 10s
checkServer();
setInterval(checkServer, 10000);
