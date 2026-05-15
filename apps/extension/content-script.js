// content-script.js
// Injected into every page. Handles:
//   • Element picking (hover ring + click to select)
//   • Live CSS injection / preview
//   • Style reset

(function () {
  if (window.__OT_INJECTED__) return;
  window.__OT_INJECTED__ = true;

  // ── State ────────────────────────────────────────────────────────────────────
  let picking = false;
  let styleTag = null;         // <style> tag we inject for live preview
  let pendingStyles = {};      // { selector: { prop: value } }
  let ringEl = null;
  let labelEl = null;

  // ── Utilities ────────────────────────────────────────────────────────────────

  function toHex(rgb) {
    if (!rgb) return null;
    if (rgb.startsWith('#')) return rgb;
    const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return null;
    return '#' + [m[1], m[2], m[3]]
      .map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
  }

  function bestSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    const classes = Array.from(el.classList)
      .filter(c => !/^(js-|is-|has-)/.test(c))
      .slice(0, 3);
    if (classes.length) {
      const sel = '.' + classes.map(c => CSS.escape(c)).join('.');
      try { if (document.querySelectorAll(sel).length === 1) return sel; } catch {}
    }
    // Fall back to nth-child path (max 4 levels)
    const parts = [];
    let node = el;
    for (let i = 0; i < 4 && node && node !== document.body; i++) {
      const tag = node.tagName.toLowerCase();
      const siblings = node.parentElement
        ? Array.from(node.parentElement.children).filter(c => c.tagName === node.tagName)
        : [];
      const idx = siblings.indexOf(node) + 1;
      parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${idx})` : tag);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  function getElementInfo(el) {
    const cs = window.getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      selector: bestSelector(el),
      tag: el.tagName.toLowerCase(),
      classes: Array.from(el.classList),
      text: el.innerText?.slice(0, 80) || '',
      rect: { w: Math.round(r.width), h: Math.round(r.height) },
      styles: {
        backgroundColor: toHex(cs.backgroundColor) || cs.backgroundColor,
        color: toHex(cs.color) || cs.color,
        borderColor: toHex(cs.borderColor) || cs.borderColor,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight,
        textAlign: cs.textAlign,
        paddingTop: cs.paddingTop,
        paddingRight: cs.paddingRight,
        paddingBottom: cs.paddingBottom,
        paddingLeft: cs.paddingLeft,
        marginTop: cs.marginTop,
        marginBottom: cs.marginBottom,
        borderRadius: cs.borderRadius,
        opacity: cs.opacity,
        display: cs.display,
        width: cs.width,
        height: cs.height,
      },
    };
  }

  // ── Pick ring UI ─────────────────────────────────────────────────────────────

  function ensureRing() {
    if (!ringEl) {
      ringEl = document.createElement('div');
      ringEl.id = '__ot_ring__';
      Object.assign(ringEl.style, {
        position: 'fixed', pointerEvents: 'none', zIndex: '2147483647',
        outline: '2px solid #f59e0b', outlineOffset: '2px',
        borderRadius: '2px', transition: 'all 80ms ease',
        boxShadow: '0 0 0 4px rgba(245,158,11,0.15)',
      });
      document.documentElement.appendChild(ringEl);
    }
    if (!labelEl) {
      labelEl = document.createElement('div');
      labelEl.id = '__ot_label__';
      Object.assign(labelEl.style, {
        position: 'fixed', pointerEvents: 'none', zIndex: '2147483647',
        background: '#f59e0b', color: '#000', fontSize: '11px',
        fontFamily: 'monospace', padding: '2px 6px', borderRadius: '3px',
        lineHeight: '16px', whiteSpace: 'nowrap',
      });
      document.documentElement.appendChild(labelEl);
    }
  }

  function posRing(el) {
    ensureRing();
    const r = el.getBoundingClientRect();
    Object.assign(ringEl.style, {
      left: r.left + 'px', top: r.top + 'px',
      width: r.width + 'px', height: r.height + 'px',
      display: 'block',
    });
    const tag = el.tagName.toLowerCase();
    const cls = Array.from(el.classList).slice(0, 2).join('.');
    labelEl.textContent = cls ? `${tag}.${cls}` : tag;
    const lx = Math.min(r.left, window.innerWidth - labelEl.offsetWidth - 8);
    const ly = r.top > 20 ? r.top - 20 : r.bottom + 4;
    Object.assign(labelEl.style, { left: lx + 'px', top: ly + 'px', display: 'block' });
  }

  function hideRing() {
    if (ringEl) ringEl.style.display = 'none';
    if (labelEl) labelEl.style.display = 'none';
  }

  // ── Pick listeners ───────────────────────────────────────────────────────────

  function onHover(e) { posRing(e.target); }

  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    stopPicking();
    const info = getElementInfo(e.target);
    posRing(e.target);  // keep ring on selected element
    chrome.runtime.sendMessage({ type: 'ot:element-selected', info });
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { stopPicking(); hideRing(); }
  }

  function startPicking() {
    picking = true;
    document.documentElement.style.cursor = 'crosshair';
    document.addEventListener('mouseover', onHover, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
  }

  function stopPicking() {
    picking = false;
    document.documentElement.style.cursor = '';
    document.removeEventListener('mouseover', onHover, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
  }

  // ── CSS injection ────────────────────────────────────────────────────────────

  function ensureStyleTag() {
    if (!styleTag || !document.contains(styleTag)) {
      styleTag = document.createElement('style');
      styleTag.id = '__ot_styles__';
      document.head.appendChild(styleTag);
    }
  }

  function rebuildStyles() {
    ensureStyleTag();
    styleTag.textContent = Object.entries(pendingStyles)
      .map(([sel, props]) =>
        `${sel} { ${Object.entries(props).map(([p, v]) => `${p}: ${v} !important`).join('; ')} }`
      ).join('\n');
  }

  function applyStyle(selector, prop, value) {
    if (!pendingStyles[selector]) pendingStyles[selector] = {};
    pendingStyles[selector][prop] = value;
    rebuildStyles();
  }

  function resetStyles(selector) {
    if (selector) delete pendingStyles[selector];
    else pendingStyles = {};
    rebuildStyles();
  }

  // ── Message handler ──────────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.type) {
      case 'ot:start-pick':
        startPicking();
        sendResponse({ ok: true });
        break;

      case 'ot:stop-pick':
        stopPicking();
        hideRing();
        sendResponse({ ok: true });
        break;

      case 'ot:apply-style':
        applyStyle(msg.selector, msg.prop, msg.value);
        sendResponse({ ok: true });
        break;

      case 'ot:reset-styles':
        resetStyles(msg.selector);
        sendResponse({ ok: true });
        break;

      case 'ot:get-tokens':
        sendResponse({ tokens: scanTokens() });
        break;
    }
  });

  // ── Design token scanner ─────────────────────────────────────────────────────

  function scanTokens() {
    const tokens = { colors: [], typography: [], spacing: [], other: [] };
    for (const sheet of Array.from(document.styleSheets)) {
      let rules;
      try { rules = Array.from(sheet.cssRules || []); } catch { continue; }
      for (const rule of rules) {
        if (!(rule instanceof CSSStyleRule)) continue;
        const style = rule.style;
        for (let i = 0; i < style.length; i++) {
          const prop = style[i];
          if (!prop.startsWith('--')) continue;
          const val = style.getPropertyValue(prop).trim();
          const entry = { name: prop, value: val };
          if (/color|background|fill|stroke|border/i.test(prop)) tokens.colors.push(entry);
          else if (/font|text|type|line-height/i.test(prop)) tokens.typography.push(entry);
          else if (/space|gap|padding|margin|size/i.test(prop)) tokens.spacing.push(entry);
          else tokens.other.push(entry);
        }
      }
    }
    return tokens;
  }

})();
