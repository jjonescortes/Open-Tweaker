/* visual-tweak-bridge.js
 * Injected into the proxied app iframe by the Visual Tweaker editor.
 * Talks to the parent editor page via postMessage (origin '*' — local dev only).
 */
(function () {
  'use strict';
  if (window.__VTB__) return;
  window.__VTB__ = true;

  const P = window.parent;

  // ── Ring + label ────────────────────────────────────────────────────────────
  const S = document.createElement('style');
  S.textContent = `
    #vtb-ring {
      position:fixed;pointer-events:none;z-index:2147483646;
      border:2px solid oklch(0.8868 0.1815 95.265);
      box-shadow:0 0 0 5px oklch(0.8868 0.1815 95.265/.12),
                 inset 0 0 0 1px oklch(0.8868 0.1815 95.265/.2);
      border-radius:4px;transition:left .06s,top .06s,width .06s,height .06s;
      display:none;
    }
    #vtb-label {
      position:fixed;z-index:2147483647;pointer-events:none;
      background:oklch(0.8868 0.1815 95.265);color:oklch(0.145 0 0);
      font:700 10px/1 ui-sans-serif,sans-serif;
      padding:3px 8px;border-radius:999px;white-space:nowrap;display:none;
    }
    body.vtb-picking * { cursor:crosshair !important; }
  `;
  document.head.appendChild(S);

  const ring  = document.createElement('div'); ring.id  = 'vtb-ring';
  const label = document.createElement('div'); label.id = 'vtb-label';
  document.body.appendChild(ring);
  document.body.appendChild(label);

  function positionRing(el) {
    if (!el) { ring.style.display = label.style.display = 'none'; return; }
    const r = el.getBoundingClientRect(), p = 4;
    ring.style.cssText  = `left:${r.left-p}px;top:${r.top-p}px;width:${r.width+p*2}px;height:${r.height+p*2}px;display:block;`;
    label.style.cssText = `left:${r.left-p}px;top:${Math.max(0,r.top-p-22)}px;display:block;`;
    const cls = [...el.classList].filter(c=>/^[a-z]/.test(c)&&!/^vtb/.test(c)).slice(0,2).join('.');
    label.textContent = `${el.tagName.toLowerCase()}${cls?'.'+cls:''} · ${Math.round(r.width)}×${Math.round(r.height)}`;
  }

  // ── Selector builder ────────────────────────────────────────────────────────
  function bestSel(el) {
    if (el.id && !/^vtb/.test(el.id)) return '#' + el.id;
    const cls = [...el.classList].filter(c => !/^(vtb|vt-)/.test(c));
    if (cls.length) return el.tagName.toLowerCase() + '.' + cls.slice(0, 3).join('.');
    if (el.parentElement && el.parentElement !== document.body)
      return bestSel(el.parentElement) + '>' + el.tagName.toLowerCase();
    return el.tagName.toLowerCase();
  }

  // ── Element info payload ─────────────────────────────────────────────────────
  function elInfo(el) {
    const cs = getComputedStyle(el);
    const r  = el.getBoundingClientRect();
    return {
      selector: bestSel(el),
      tag:      el.tagName.toLowerCase(),
      id:       el.id || null,
      classes:  [...el.classList].filter(c => !/^vtb/.test(c)),
      rect:     { left: r.left, top: r.top, width: r.width, height: r.height },
      styles: {
        backgroundColor:cs.backgroundColor, color:cs.color, borderColor:cs.borderColor,
        fontSize:cs.fontSize, fontWeight:cs.fontWeight, lineHeight:cs.lineHeight,
        letterSpacing:cs.letterSpacing, textAlign:cs.textAlign,
        paddingTop:cs.paddingTop, paddingRight:cs.paddingRight,
        paddingBottom:cs.paddingBottom, paddingLeft:cs.paddingLeft,
        marginTop:cs.marginTop, marginBottom:cs.marginBottom,
        width:cs.width, height:cs.height,
        display:cs.display, borderRadius:cs.borderRadius, opacity:cs.opacity,
      },
    };
  }

  // ── DOM tree (shallow, max depth 5) ─────────────────────────────────────────
  const SKIP_TAGS = /^(script|style|noscript|meta|link|head|svg|path|g)$/i;
  function domTree(el, depth = 0) {
    if (!el || depth > 5 || SKIP_TAGS.test(el.tagName)) return null;
    const cls = [...(el.classList||[])].filter(c=>/^[a-z]/.test(c)&&!/^vtb/.test(c));
    const sel  = el.id ? '#'+el.id : (cls.length ? el.tagName.toLowerCase()+'.'+cls[0] : el.tagName.toLowerCase());
    const kids = [...el.children].map(c=>domTree(c,depth+1)).filter(Boolean).slice(0,10);
    const txt  = el.childNodes.length === 1 && el.firstChild?.nodeType === 3
      ? el.firstChild.textContent.trim().slice(0, 40) : null;
    return { tag:el.tagName.toLowerCase(), sel, id:el.id||null, cls:cls.slice(0,3), kids, txt };
  }

  // ── Pick mode ────────────────────────────────────────────────────────────────
  let picking = false;

  function isVtb(el) { return el.id?.startsWith('vtb') || el.closest?.('#vtb-ring,#vtb-label'); }

  document.addEventListener('mouseover', e => {
    if (!picking || isVtb(e.target)) return;
    positionRing(e.target);
  }, true);

  document.addEventListener('click', e => {
    if (!picking || isVtb(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    picking = false;
    document.body.classList.remove('vtb-picking');
    positionRing(e.target);
    P.postMessage({ type:'vtb:selected', el: elInfo(e.target) }, '*');
  }, true);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && picking) {
      picking = false;
      document.body.classList.remove('vtb-picking');
      positionRing(null);
      P.postMessage({ type:'vtb:pick-cancel' }, '*');
    }
  }, true);

  // ── Live preview ─────────────────────────────────────────────────────────────
  let pvStyle = null;
  function setPreview(selector, props) {
    if (!pvStyle) { pvStyle = document.createElement('style'); pvStyle.id='vtb-preview'; document.head.appendChild(pvStyle); }
    const d = Object.entries(props||{}).map(([k,v])=>`  ${k}:${v}!important;`).join('\n');
    pvStyle.textContent = selector&&d ? `${selector}{\n${d}\n}` : '';
  }

  // ── Message handler ──────────────────────────────────────────────────────────
  window.addEventListener('message', ({ data: m }) => {
    if (!m?.type?.startsWith('vtb:')) return;
    switch (m.type) {

      case 'vtb:pick-mode':
        picking = !!m.on;
        document.body.classList.toggle('vtb-picking', picking);
        if (!picking) positionRing(null);
        break;

      case 'vtb:preview':
        setPreview(m.selector, m.props);
        break;

      case 'vtb:clear-preview':
        if (pvStyle) pvStyle.textContent = '';
        break;

      case 'vtb:highlight':
        try {
          const el = document.querySelector(m.selector);
          if (el) { positionRing(el); el.scrollIntoView({ behavior:'smooth', block:'center' }); }
        } catch {}
        break;

      case 'vtb:select-by-selector':
        try {
          const el = document.querySelector(m.selector);
          if (el) { positionRing(el); el.scrollIntoView({ behavior:'smooth', block:'center' }); P.postMessage({ type:'vtb:selected', el: elInfo(el) }, '*'); }
        } catch {}
        break;

      case 'vtb:dom-tree':
        P.postMessage({ type:'vtb:dom-tree-result', tree: domTree(document.body) }, '*');
        break;

      case 'vtb:ping':
        P.postMessage({ type:'vtb:pong' }, '*');
        break;
    }
  });

  // ── Ready ────────────────────────────────────────────────────────────────────
  P.postMessage({ type:'vtb:ready' }, '*');
  console.log('[VT Bridge] ready');
})();
