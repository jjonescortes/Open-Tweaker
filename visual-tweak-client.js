/* visual-tweak-client.js — injected WYSIWYG panel for React+CSS/SCSS projects
 * Served by visual-tweak-server.js at GET /visual-tweak.js
 * Self-contained: no external dependencies, no build step.
 */
(function () {
  'use strict';
  if (window.__VT_LOADED__) return;
  window.__VT_LOADED__ = true;

  const SERVER = 'http://localhost:4242';
  const WS_URL = 'ws://localhost:4243';

  // ── WebSocket: live-reload on CSS file changes ──────────────────────────────
  (function connectWS() {
    const ws = new WebSocket(WS_URL);
    ws.onmessage = ({ data }) => {
      const msg = JSON.parse(data);
      if (msg.type !== 'change' && msg.type !== 'add') return;
      const changed = msg.file.replace(/\\/g, '/');
      // Bust cache on matching <link> tags
      document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
        const href = new URL(link.href, location.href).pathname;
        if (href.includes(changed) || changed.includes(href.split('/').pop())) {
          link.href = link.href.split('?')[0] + '?_vt=' + Date.now();
        }
      });
      vtToast(`Reloaded: ${msg.file}`, 1800);
    };
    ws.onclose = () => setTimeout(connectWS, 2500);
    ws.onerror = () => ws.close();
  })();

  // ── Shared state ────────────────────────────────────────────────────────────
  const S = {
    collapsed:        false,
    tab:              'inspector',
    picking:          false,
    targetEl:         null,
    selector:         '',
    pendingProps:     {}, // { cssProperty: value }
    undoDepth:        0,
    tokens:           null,
    tokenEdits:       {}, // name → new value
    components:       null,
    selectedCompIdx:  -1,
    editingRuleKey:   null, // 'compIdx:ruleIdx'
    creatingOverride: false,
    classUsages:      null, // loaded per component
  };

  // ── Styles — shadcn preset b6FSANkTQ ────────────────────────────────────────
  // Dark panel using .dark token values; golden-yellow primary from :root
  // --background dark : oklch(0.145 0 0)   card dark : oklch(0.205 0 0)
  // --primary light   : oklch(0.8868 0.1815 95.265)  ← golden yellow accent
  // --radius          : 0.625rem
  const STYLES = `
#vt {
  /* ── shadcn token map ── */
  --vt-bg:        oklch(0.205 0 0);
  --vt-bg-deep:   oklch(0.145 0 0);
  --vt-bg-raised: oklch(0.269 0 0);
  --vt-bg-active: oklch(0.371 0 0);
  --vt-border:    oklch(0.275 0 0);
  --vt-border-in: oklch(0.325 0 0);
  --vt-fg:        oklch(0.985 0 0);
  --vt-fg-muted:  oklch(0.708 0 0);
  --vt-fg-dim:    oklch(0.556 0 0);
  --vt-accent:    oklch(0.8868 0.1815 95.265);
  --vt-accent-hi: oklch(0.922 0.12 95);
  --vt-accent-lo: oklch(0.60 0.14 95);
  --vt-accent-fg: oklch(0.145 0 0);
  --vt-red:       oklch(0.704 0.191 22.216);
  --vt-r:         0.625rem;
  --vt-r-sm:      calc(0.625rem - 4px);
  --vt-r-md:      calc(0.625rem - 2px);

  position:fixed; top:16px; right:16px;
  width:320px; min-width:270px; max-width:560px;
  background:var(--vt-bg); color:var(--vt-fg);
  border:1px solid var(--vt-border); border-radius:var(--vt-r);
  box-shadow:0 8px 32px oklch(0 0 0/.5), 0 0 0 1px var(--vt-border);
  font:12px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  z-index:2147483647; user-select:none;
  resize:horizontal; overflow:hidden;
}
#vt *{box-sizing:border-box; margin:0; padding:0;}

/* ── Header ── */
#vt-hd{
  background:var(--vt-bg-deep); padding:8px 12px;
  display:flex; align-items:center; gap:6px;
  cursor:move; border-bottom:1px solid var(--vt-border);
}
#vt-title{
  font-size:11px; font-weight:600; letter-spacing:.06em;
  text-transform:uppercase; color:var(--vt-accent); flex:1;
}
#vt-hd button{
  background:none; border:none; color:var(--vt-fg-dim);
  cursor:pointer; font-size:15px; line-height:1;
  padding:0 4px; transition:color .15s; border-radius:var(--vt-r-sm);
}
#vt-hd button:hover{color:var(--vt-fg);}

/* ── Tabs ── */
#vt-tabs{
  display:flex; background:var(--vt-bg-deep);
  border-bottom:1px solid var(--vt-border);
}
.vt-tab{
  flex:1; padding:7px 2px; background:none; border:none;
  border-bottom:2px solid transparent;
  color:var(--vt-fg-dim); cursor:pointer;
  font:600 11px/1 inherit; letter-spacing:.02em;
  transition:color .15s, border-color .15s;
}
.vt-tab:hover{color:var(--vt-fg-muted); background:oklch(1 0 0/.03);}
.vt-tab.on{color:var(--vt-accent); border-bottom-color:var(--vt-accent);}

/* ── Body ── */
#vt-bd{
  max-height:72vh; overflow-y:auto; padding:12px;
  scrollbar-width:thin; scrollbar-color:var(--vt-border) transparent;
}
#vt-bd::-webkit-scrollbar{width:4px;}
#vt-bd::-webkit-scrollbar-thumb{background:var(--vt-border); border-radius:2px;}

/* ── Sections ── */
.vt-sec{margin-bottom:16px;}
.vt-sec-ttl{
  font-size:10px; font-weight:600; text-transform:uppercase;
  letter-spacing:.1em; color:var(--vt-fg-dim);
  padding-bottom:6px; margin-bottom:8px;
  border-bottom:1px solid var(--vt-border);
}

/* ── Form rows ── */
.vt-row{display:flex; align-items:center; gap:6px; margin-bottom:6px;}
.vt-lbl{color:var(--vt-fg-muted); font-size:11px; width:90px; flex-shrink:0; white-space:nowrap;}

/* ── Inputs ── */
.vt-in{
  flex:1; background:var(--vt-bg-deep); border:1px solid var(--vt-border-in);
  border-radius:var(--vt-r-sm); color:var(--vt-fg); padding:4px 8px;
  font:11px/1.4 inherit; transition:border-color .15s;
}
.vt-in:focus{outline:none; border-color:var(--vt-accent);}
input[type=color].vt-clr{
  width:28px; height:24px; padding:2px; border-radius:var(--vt-r-sm);
  border:1px solid var(--vt-border-in); background:var(--vt-bg-deep);
  cursor:pointer; flex-shrink:0;
}
.vt-range{
  flex:1; -webkit-appearance:none; appearance:none;
  height:3px; border-radius:2px; background:var(--vt-border); cursor:pointer;
}
.vt-range::-webkit-slider-thumb{
  -webkit-appearance:none; width:12px; height:12px;
  background:var(--vt-accent); border-radius:50%;
}
.vt-rv{width:40px; text-align:right; color:var(--vt-fg-muted); font-size:10px; flex-shrink:0;}
.vt-sel{
  flex:1; background:var(--vt-bg-deep); border:1px solid var(--vt-border-in);
  border-radius:var(--vt-r-sm); color:var(--vt-fg); padding:4px 7px;
  font:11px/1.4 inherit; cursor:pointer;
}
.vt-sel:focus{outline:none; border-color:var(--vt-accent);}

/* ── Align buttons ── */
.vt-align-grp{display:flex; gap:3px; flex:1;}
.vt-align-btn{
  flex:1; padding:4px 0; background:var(--vt-bg-deep);
  border:1px solid var(--vt-border); border-radius:var(--vt-r-sm);
  color:var(--vt-fg-dim); cursor:pointer; font:10px/1.4 inherit;
  transition:all .12s;
}
.vt-align-btn.on{
  background:oklch(0.8868 0.1815 95.265/.15);
  color:var(--vt-accent); border-color:var(--vt-accent);
}

/* ── Pick button ── */
.vt-pick-btn{
  width:100%; margin-bottom:8px; padding:8px 12px;
  background:var(--vt-accent); color:var(--vt-accent-fg); border:none;
  border-radius:var(--vt-r-md); cursor:pointer; font:600 11px/1 inherit;
  transition:background .15s, box-shadow .15s;
}
.vt-pick-btn:hover{background:var(--vt-accent-hi);}
.vt-pick-btn.picking{
  background:var(--vt-accent-lo); color:var(--vt-fg);
  box-shadow:0 0 0 2px var(--vt-accent);
}

/* ── Selector bar ── */
#vt-sel-bar{
  background:var(--vt-bg-deep); border:1px solid var(--vt-border);
  border-radius:var(--vt-r-sm); padding:5px 9px;
  font-size:10px; color:var(--vt-accent); font-family:ui-monospace,monospace;
  margin-bottom:10px; min-height:24px; word-break:break-all; line-height:1.5;
}

/* ── Action row ── */
.vt-action-row{
  display:flex; gap:6px; padding-top:10px; margin-top:10px;
  border-top:1px solid var(--vt-border);
}

/* ── Buttons ── */
.vt-btn{
  background:var(--vt-accent); color:var(--vt-accent-fg); border:none;
  border-radius:var(--vt-r-sm); padding:6px 13px;
  cursor:pointer; font:600 11px/1.4 inherit;
  transition:background .15s;
}
.vt-btn:hover{background:var(--vt-accent-hi);}
.vt-btn.sec{
  background:var(--vt-bg-raised); color:var(--vt-fg-muted);
  border:1px solid var(--vt-border);
}
.vt-btn.sec:hover{background:var(--vt-bg-active); color:var(--vt-fg);}
.vt-btn.undo{
  background:oklch(0.8868 0.1815 95.265/.1);
  color:var(--vt-accent); border:1px solid oklch(0.8868 0.1815 95.265/.35);
}
.vt-btn.undo:hover{background:oklch(0.8868 0.1815 95.265/.2);}
.vt-btn.undo:disabled{opacity:.3; cursor:not-allowed;}

/* ── Token rows ── */
.vt-tk-row{display:flex; align-items:center; gap:6px; margin-bottom:5px;}
.vt-tk-name{
  font-family:ui-monospace,monospace; font-size:10px; color:var(--vt-fg-dim);
  flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}

/* ── Component list ── */
.vt-comp{
  padding:7px 10px; border-radius:var(--vt-r-sm); cursor:pointer;
  margin-bottom:2px; border-left:2px solid transparent;
  transition:background .1s;
}
.vt-comp:hover{background:var(--vt-bg-raised);}
.vt-comp.on{background:var(--vt-bg-raised); border-left-color:var(--vt-accent);}
.vt-comp-name{font-weight:600; color:var(--vt-fg); font-size:12px; margin-bottom:1px;}
.vt-comp-path{font-size:10px; color:var(--vt-fg-dim); font-family:ui-monospace,monospace;}

/* ── Rule blocks ── */
.vt-rule{
  background:var(--vt-bg-deep); border:1px solid var(--vt-border);
  border-radius:var(--vt-r-sm); padding:7px 9px; margin-bottom:6px;
}
.vt-rule-sel{
  color:var(--vt-accent); font-size:11px;
  font-family:ui-monospace,monospace; margin-bottom:4px;
}
.vt-rule-decl{
  color:var(--vt-fg-muted); font-size:10px;
  font-family:ui-monospace,monospace; padding-left:10px; line-height:1.7;
}
.vt-rule-hd{
  display:flex; align-items:center; gap:6px;
  justify-content:space-between; margin-bottom:3px;
}
.vt-rule-edit-wrap{margin-top:7px;}
.vt-rule-edit-row{display:flex; gap:5px; margin-top:5px;}
.vt-rule-ta{
  width:100%; background:var(--vt-bg-deep); border:1px solid var(--vt-accent);
  border-radius:var(--vt-r-sm); color:var(--vt-fg); padding:7px 9px;
  font:11px/1.6 ui-monospace,monospace; resize:vertical; min-height:72px;
  display:block;
}
.vt-rule-ta:focus{outline:none; border-color:var(--vt-accent-hi);}

/* ── Misc ── */
.vt-empty{color:var(--vt-fg-dim); font-size:11px; text-align:center; padding:24px 0;}
.vt-sub{font-size:10px; color:var(--vt-fg-dim); text-align:right; margin-bottom:5px;}
.vt-badge{
  font-size:9px; padding:2px 6px; border-radius:999px;
  background:oklch(0.8868 0.1815 95.265/.12);
  color:var(--vt-accent); border:1px solid oklch(0.8868 0.1815 95.265/.3);
  white-space:nowrap; font-family:ui-monospace,monospace;
}

/* ── Session / Prompt tab ── */
#vt-rec-btn{
  padding:4px 10px; border-radius:999px; cursor:pointer;
  font:700 10px/1.4 inherit; border:1px solid; transition:all .15s;
  background:none; display:flex; align-items:center; gap:4px;
}
#vt-rec-btn.off{ color:var(--vt-fg-dim); border-color:var(--vt-border); }
#vt-rec-btn.off:hover{ color:var(--vt-fg); border-color:var(--vt-fg-dim); }
#vt-rec-btn.on{
  color:oklch(0.7 0.22 20); border-color:oklch(0.7 0.22 20);
  background:oklch(0.7 0.22 20/.12);
  animation:vt-pulse 1.4s ease-in-out infinite;
}
@keyframes vt-pulse{
  0%,100%{ box-shadow:0 0 0 0 oklch(0.7 0.22 20/.4); }
  50%{     box-shadow:0 0 0 5px oklch(0.7 0.22 20/.0); }
}
#vt-rec-badge{
  display:none; align-items:center; justify-content:center;
  min-width:16px; height:16px; padding:0 4px;
  background:oklch(0.7 0.22 20); color:#fff;
  border-radius:999px; font-size:9px; font-weight:700; margin-left:2px;
}
.vt-session-item{
  background:var(--vt-bg-deep); border:1px solid var(--vt-border);
  border-radius:var(--vt-r-sm); padding:8px 10px; margin-bottom:5px;
}
.vt-session-item-hd{
  display:flex; align-items:baseline; justify-content:space-between;
  gap:6px; margin-bottom:4px;
}
.vt-session-sel{
  font:600 11px/1 ui-monospace,monospace; color:var(--vt-accent); flex:1;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.vt-session-src{ font-size:9px; color:var(--vt-fg-dim); flex-shrink:0; }
.vt-session-prop{
  display:flex; gap:4px; align-items:baseline;
  font-size:10px; font-family:ui-monospace,monospace; margin-top:2px;
}
.vt-session-key{ color:var(--vt-fg-muted); }
.vt-session-val{ color:oklch(0.78 0.14 145); }
.vt-session-del{
  background:none; border:none; cursor:pointer; padding:0 3px;
  color:var(--vt-fg-dim); font-size:13px; line-height:1;
  border-radius:3px; transition:color .12s;
}
.vt-session-del:hover{ color:var(--vt-red); }
.vt-prompt-out{
  width:100%; background:var(--vt-bg-deep); border:1px solid var(--vt-border);
  border-radius:var(--vt-r-sm); color:var(--vt-fg-muted);
  padding:10px 11px; font:11px/1.6 ui-monospace,monospace;
  resize:vertical; min-height:180px; display:block;
  white-space:pre-wrap; overflow-y:auto;
  scrollbar-width:thin; scrollbar-color:var(--vt-border) transparent;
}
.vt-ctx-item{
  display:flex; gap:6px; align-items:center; font-size:10px;
  padding:3px 0; border-bottom:1px solid var(--vt-border); color:var(--vt-fg-muted);
}
.vt-ctx-item:last-child{ border-bottom:none; }
.vt-ctx-dot{
  width:6px; height:6px; border-radius:50%; flex-shrink:0;
  background:oklch(0.8868 0.1815 95.265/.6);
}

/* ── Tailwind class pills ── */
.vt-cls-block{
  background:var(--vt-bg-deep); border:1px solid var(--vt-border);
  border-radius:var(--vt-r-sm); padding:7px 9px; margin-bottom:5px;
}
.vt-cls-tag{
  color:var(--vt-accent); font:600 11px/1.4 ui-monospace,monospace;
  margin-bottom:5px;
}
.vt-cls-pills{display:flex; flex-wrap:wrap; gap:3px;}
.vt-pill{
  font-size:9px; padding:2px 7px; border-radius:999px;
  background:var(--vt-bg-raised); color:var(--vt-fg-muted);
  border:1px solid var(--vt-border);
  cursor:pointer; transition:all .12s; font-family:ui-monospace,monospace;
}
.vt-pill:hover{
  background:oklch(0.8868 0.1815 95.265/.15);
  color:var(--vt-accent); border-color:oklch(0.8868 0.1815 95.265/.4);
}

/* ── Override form ── */
.vt-override-form{
  background:var(--vt-bg-deep); border:1px solid oklch(0.8868 0.1815 95.265/.4);
  border-radius:var(--vt-r-md); padding:10px; margin-top:8px;
}
.vt-override-ttl{
  font-size:10px; font-weight:700; color:var(--vt-accent);
  text-transform:uppercase; letter-spacing:.08em; margin-bottom:8px;
}
.vt-override-hint{font-size:10px; color:var(--vt-fg-dim); margin-bottom:8px; line-height:1.5;}
.vt-in-lbl{font-size:10px; color:var(--vt-fg-muted); margin-bottom:3px; display:block;}

/* ── Highlight overlay ── */
#vt-hl{
  position:fixed; pointer-events:none; z-index:2147483646;
  box-shadow:0 0 0 2px oklch(0.8868 0.1815 95.265),
             inset 0 0 0 1px oklch(0.8868 0.1815 95.265/.25);
  border-radius:2px;
  background:oklch(0.8868 0.1815 95.265/.08);
  transition:all 60ms linear;
}

/* ── Picker cursor ── */
body.vt-picking *{cursor:crosshair !important;}
body.vt-picking #vt,
body.vt-picking #vt *{cursor:default !important;}

/* ── Toast ── */
#vt-toast{
  position:fixed; bottom:20px; left:50%; transform:translateX(-50%);
  background:var(--vt-bg); border:1px solid oklch(0.8868 0.1815 95.265/.5);
  color:var(--vt-fg); padding:8px 18px; border-radius:var(--vt-r-md);
  font:12px/1.4 inherit; z-index:2147483647; opacity:0; pointer-events:none;
  transition:opacity .2s; white-space:nowrap;
  box-shadow:0 4px 16px oklch(0 0 0/.4);
}

/* ══════════════════════════════════════════════
   COMPONENT SIDE DRAWER
   ══════════════════════════════════════════════ */
/* ── Drawer shell ── */
#vt-drawer{
  --d-bg:     oklch(0.205 0 0);
  --d-deep:   oklch(0.145 0 0);
  --d-raised: oklch(0.269 0 0);
  --d-border: oklch(0.275 0 0);
  --d-border2:oklch(0.325 0 0);
  --d-fg:     oklch(0.985 0 0);
  --d-muted:  oklch(0.708 0 0);
  --d-dim:    oklch(0.556 0 0);
  --d-accent: oklch(0.8868 0.1815 95.265);
  --d-acc-hi: oklch(0.922 0.12 95);
  --d-acc-fg: oklch(0.145 0 0);
  --d-r:      0.625rem;
  --d-r-sm:   calc(0.625rem - 4px);
  --d-r-md:   calc(0.625rem - 2px);

  position:fixed; top:0; right:0; bottom:0; width:440px;
  background:var(--d-bg); color:var(--d-fg);
  border-left:1px solid var(--d-border);
  box-shadow:-12px 0 48px oklch(0 0 0/.5);
  display:flex; flex-direction:column; z-index:2147483648;
  font:13px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif;
  transform:translateX(100%);
  transition:transform .28s cubic-bezier(.4,0,.2,1);
}
#vt-drawer.vt-open{ transform:translateX(0); }
#vt-drawer *{ box-sizing:border-box; margin:0; padding:0; }

/* ── Header ── */
.vt-d-hd{
  background:var(--d-deep); border-bottom:1px solid var(--d-border);
  padding:16px 16px 14px; flex-shrink:0;
}
.vt-d-hd-row{ display:flex; align-items:flex-start; gap:10px; margin-bottom:14px; }
.vt-d-name{ font-size:16px; font-weight:700; flex:1; line-height:1.2; }
.vt-d-file{
  font-size:10px; color:var(--d-dim); font-family:ui-monospace,monospace;
  margin-bottom:14px;
}
.vt-d-close{
  background:var(--d-raised); border:1px solid var(--d-border);
  color:var(--d-muted); cursor:pointer; font-size:16px;
  width:30px; height:30px; border-radius:var(--d-r-sm);
  display:flex; align-items:center; justify-content:center; flex-shrink:0;
  transition:all .15s;
}
.vt-d-close:hover{ background:var(--d-border2); color:var(--d-fg); }

/* Selector row */
.vt-d-sel-wrap{ display:flex; gap:8px; align-items:center; }
.vt-d-sel-in{
  flex:1; background:oklch(0.145 0 0/.8);
  border:1px solid oklch(0.8868 0.1815 95.265/.5);
  border-radius:var(--d-r-sm); color:var(--d-accent);
  padding:8px 11px; font:12px/1 ui-monospace,monospace;
  transition:border-color .15s;
}
.vt-d-sel-in:focus{ outline:none; border-color:var(--d-accent); }
.vt-d-match{
  font-size:10px; font-weight:600; padding:4px 10px;
  border-radius:999px; white-space:nowrap; flex-shrink:0;
}
.vt-d-match.ok{
  background:oklch(0.8868 0.1815 95.265/.15);
  color:var(--d-accent);
  border:1px solid oklch(0.8868 0.1815 95.265/.3);
}
.vt-d-match.no{
  background:oklch(0.269 0 0);
  color:var(--d-dim);
  border:1px solid var(--d-border);
}
.vt-d-sugg{ display:flex; flex-wrap:wrap; gap:4px; margin-top:10px; }

/* ── Scrollable body ── */
.vt-d-body{
  flex:1; overflow-y:auto; padding:16px;
  scrollbar-width:thin; scrollbar-color:var(--d-border) transparent;
}
.vt-d-body::-webkit-scrollbar{ width:4px; }
.vt-d-body::-webkit-scrollbar-thumb{ background:var(--d-border); border-radius:2px; }

/* Cards */
.vt-d-card{
  background:var(--d-deep); border:1px solid var(--d-border);
  border-radius:var(--d-r); padding:16px; margin-bottom:12px;
}
.vt-d-card-ttl{
  font-size:10px; font-weight:700; text-transform:uppercase;
  letter-spacing:.1em; color:var(--d-dim);
  margin-bottom:16px;
}

/* Fields — label above control */
.vt-d-field{ margin-bottom:14px; }
.vt-d-field:last-child{ margin-bottom:0; }
.vt-d-fhd{
  display:flex; justify-content:space-between; align-items:baseline;
  margin-bottom:6px;
}
.vt-d-lbl{ font-size:12px; font-weight:500; color:var(--d-muted); }
.vt-d-val{ font-size:11px; color:var(--d-accent); font-family:ui-monospace,monospace; }
.vt-d-ctrl{ display:flex; gap:8px; align-items:center; }
.vt-d-in{
  flex:1; background:oklch(0.145 0 0/.6); border:1px solid var(--d-border2);
  border-radius:var(--d-r-sm); color:var(--d-fg);
  padding:8px 11px; font:13px/1 inherit; transition:border-color .15s;
}
.vt-d-in:focus{ outline:none; border-color:var(--d-accent); }
input[type=color].vt-d-clr{
  width:38px; height:36px; padding:2px 3px;
  border-radius:var(--d-r-sm); border:1px solid var(--d-border2);
  background:oklch(0.145 0 0/.6); cursor:pointer; flex-shrink:0;
}
.vt-d-range{
  flex:1; -webkit-appearance:none; appearance:none;
  height:5px; border-radius:3px; background:var(--d-raised); cursor:pointer;
}
.vt-d-range::-webkit-slider-thumb{
  -webkit-appearance:none; width:16px; height:16px;
  background:var(--d-accent); border-radius:50%;
  box-shadow:0 0 0 3px oklch(0.8868 0.1815 95.265/.2);
}
.vt-d-sel{
  width:100%; background:oklch(0.145 0 0/.6); border:1px solid var(--d-border2);
  border-radius:var(--d-r-sm); color:var(--d-fg);
  padding:8px 11px; font:13px/1 inherit; cursor:pointer;
}
.vt-d-sel:focus{ outline:none; border-color:var(--d-accent); }
.vt-d-align{ display:flex; gap:4px; }
.vt-d-ab{
  flex:1; padding:7px 4px; background:oklch(0.145 0 0/.6);
  border:1px solid var(--d-border); border-radius:var(--d-r-sm);
  color:var(--d-dim); cursor:pointer; font:600 12px/1 inherit;
  transition:all .12s;
}
.vt-d-ab.on{
  background:oklch(0.8868 0.1815 95.265/.15);
  color:var(--d-accent); border-color:oklch(0.8868 0.1815 95.265/.4);
}

/* ── Footer ── */
.vt-d-ft{
  background:var(--d-deep); border-top:1px solid var(--d-border);
  padding:14px 16px; display:flex; align-items:center; gap:8px; flex-shrink:0;
}
.vt-d-status{ flex:1; font-size:11px; color:var(--d-dim); line-height:1.3; }

/* ── Open button in component list ── */
.vt-m-open-btn{
  width:100%; padding:9px; margin-bottom:10px;
  background:oklch(0.8868 0.1815 95.265/.1);
  color:var(--vt-accent); border:1px solid oklch(0.8868 0.1815 95.265/.3);
  border-radius:var(--vt-r-md); cursor:pointer;
  font:600 12px/1.4 ui-sans-serif,sans-serif;
  transition:background .15s;
}
.vt-m-open-btn:hover{ background:oklch(0.8868 0.1815 95.265/.2); }

/* ── Element highlight ring ── */
#vt-el-ring{
  position:fixed; pointer-events:none; z-index:2147483646;
  border:2px solid oklch(0.8868 0.1815 95.265);
  box-shadow:0 0 0 4px oklch(0.8868 0.1815 95.265/.15),
             inset 0 0 0 1px oklch(0.8868 0.1815 95.265/.3);
  border-radius:4px; transition:all .18s ease;
}
/* ── Label on ring ── */
#vt-el-label{
  position:fixed; z-index:2147483647; pointer-events:none;
  background:oklch(0.8868 0.1815 95.265); color:oklch(0.145 0 0);
  font:600 10px/1 ui-sans-serif,sans-serif;
  padding:3px 8px; border-radius:999px;
  white-space:nowrap;
}
`;

  const styleEl = document.createElement('style');
  styleEl.textContent = STYLES;
  document.head.appendChild(styleEl);

  // ── Panel skeleton ──────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.id = 'vt';
  panel.innerHTML = `
<div id="vt-hd">
  <span id="vt-title">⟡ Visual Tweaker</span>
  <button id="vt-rec-btn" class="off" title="Toggle session recording mode">
    ⏺<span id="vt-rec-badge">0</span>
  </button>
  <button id="vt-min" title="Collapse">−</button>
  <button id="vt-x"   title="Close">×</button>
</div>
<div id="vt-tabs">
  <button class="vt-tab on"  data-tab="inspector">Inspector</button>
  <button class="vt-tab"     data-tab="design">Design</button>
  <button class="vt-tab"     data-tab="components">Components</button>
  <button class="vt-tab"     data-tab="prompt">Prompt</button>
</div>
<div id="vt-bd">
  <div id="tab-inspector"></div>
  <div id="tab-design"     style="display:none"></div>
  <div id="tab-components" style="display:none"></div>
  <div id="tab-prompt"     style="display:none"></div>
</div>`;
  document.body.appendChild(panel);

  const toast = document.createElement('div');
  toast.id = 'vt-toast';
  document.body.appendChild(toast);

  // ── Toast ───────────────────────────────────────────────────────────────────
  let toastTm;
  function vtToast(msg, dur = 2200) {
    toast.textContent = msg;
    toast.style.opacity = '1';
    clearTimeout(toastTm);
    toastTm = setTimeout(() => { toast.style.opacity = '0'; }, dur);
  }

  // ── Drag ────────────────────────────────────────────────────────────────────
  let dragging = false, ox = 0, oy = 0;
  document.getElementById('vt-hd').addEventListener('mousedown', e => {
    if (e.target.tagName === 'BUTTON') return;
    dragging = true;
    const r = panel.getBoundingClientRect();
    ox = e.clientX - r.left; oy = e.clientY - r.top;
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const x = Math.max(0, Math.min(e.clientX - ox, innerWidth  - panel.offsetWidth));
    const y = Math.max(0, Math.min(e.clientY - oy, innerHeight - panel.offsetHeight));
    panel.style.cssText += `;left:${x}px;top:${y}px;right:auto;`;
  });
  document.addEventListener('mouseup', () => { dragging = false; });

  // ── Collapse / close ────────────────────────────────────────────────────────
  document.getElementById('vt-min').addEventListener('click', () => {
    S.collapsed = !S.collapsed;
    document.getElementById('vt-bd').style.display    = S.collapsed ? 'none' : '';
    document.getElementById('vt-tabs').style.display  = S.collapsed ? 'none' : '';
    document.getElementById('vt-min').textContent     = S.collapsed ? '+' : '−';
  });
  document.getElementById('vt-x').addEventListener('click', () => {
    cleanPicker();
    panel.remove();
    toast.remove();
    styleEl.remove();
    delete window.__VT_LOADED__;
  });

  // ── Session recording state ─────────────────────────────────────────────────
  // Each entry: { id, selector, property, value, component, file, source }
  const SESSION = { active: false, changes: [] };

  function sessionAdd(entry) {
    entry.id = Date.now() + Math.random();
    SESSION.changes.push(entry);
    updateRecBadge();
  }

  function updateRecBadge() {
    const btn   = document.getElementById('vt-rec-btn');
    const badge = document.getElementById('vt-rec-badge');
    const n     = SESSION.changes.length;
    btn.className   = SESSION.active ? 'on' : 'off';
    btn.title       = SESSION.active
      ? `Recording ON — ${n} change${n !== 1 ? 's' : ''} (click to stop)`
      : 'Start session recording (changes won\'t be saved to files)';
    badge.textContent = n;
    badge.style.display = n > 0 ? 'inline-flex' : 'none';
  }

  document.getElementById('vt-rec-btn').addEventListener('click', () => {
    SESSION.active = !SESSION.active;
    updateRecBadge();
    vtToast(SESSION.active
      ? '⏺ Recording — Apply actions will buffer here, not save to files'
      : '⏹ Recording stopped', 2400);
    if (S.tab === 'prompt') renderPromptTab();
  });

  // ── Tab switching ───────────────────────────────────────────────────────────
  document.getElementById('vt-tabs').addEventListener('click', e => {
    const btn = e.target.closest('.vt-tab');
    if (!btn) return;
    document.querySelectorAll('.vt-tab').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    S.tab = btn.dataset.tab;
    ['inspector', 'design', 'components', 'prompt'].forEach(t =>
      document.getElementById(`tab-${t}`).style.display = t === S.tab ? '' : 'none'
    );
    if (S.tab === 'design'      && !S.tokens)     loadTokens();
    if (S.tab === 'components'  && !S.components) loadComponents();
    if (S.tab === 'prompt')                        renderPromptTab();
  });

  // ════════════════════════════════════════════════════════════════════════════
  // INSPECTOR TAB
  // ════════════════════════════════════════════════════════════════════════════

  const PROPS = [
    // Colors
    { key:'backgroundColor', css:'background-color', lbl:'Background', t:'color',  section:'Color' },
    { key:'color',           css:'color',            lbl:'Text Color', t:'color',  section:'Color' },
    { key:'borderColor',     css:'border-color',     lbl:'Border',     t:'color',  section:'Color' },
    // Typography
    { key:'fontSize',        css:'font-size',        lbl:'Font Size',  t:'range', min:6,   max:96,   step:1,    unit:'px', section:'Typography' },
    { key:'fontWeight',      css:'font-weight',      lbl:'Weight',     t:'select', opts:['100','200','300','400','500','600','700','800','900'], section:'Typography' },
    { key:'lineHeight',      css:'line-height',      lbl:'Line Height',t:'range', min:.8,  max:4,    step:.05,  unit:'',   section:'Typography' },
    { key:'letterSpacing',   css:'letter-spacing',   lbl:'Letter Spc', t:'range', min:-3,  max:16,   step:.1,   unit:'px', section:'Typography' },
    { key:'textAlign',       css:'text-align',       lbl:'Align',      t:'align',  section:'Typography' },
    // Spacing
    { key:'paddingTop',      css:'padding-top',      lbl:'Pad Top',    t:'range', min:0, max:120, step:1, unit:'px', section:'Spacing' },
    { key:'paddingRight',    css:'padding-right',    lbl:'Pad Right',  t:'range', min:0, max:120, step:1, unit:'px', section:'Spacing' },
    { key:'paddingBottom',   css:'padding-bottom',   lbl:'Pad Bottom', t:'range', min:0, max:120, step:1, unit:'px', section:'Spacing' },
    { key:'paddingLeft',     css:'padding-left',     lbl:'Pad Left',   t:'range', min:0, max:120, step:1, unit:'px', section:'Spacing' },
    { key:'marginTop',       css:'margin-top',       lbl:'Margin Top', t:'range', min:-60,max:120, step:1, unit:'px', section:'Spacing' },
    { key:'marginBottom',    css:'margin-bottom',    lbl:'Margin Bot', t:'range', min:-60,max:120, step:1, unit:'px', section:'Spacing' },
    // Layout
    { key:'width',           css:'width',            lbl:'Width',      t:'text',   section:'Layout' },
    { key:'height',          css:'height',           lbl:'Height',     t:'text',   section:'Layout' },
    { key:'display',         css:'display',          lbl:'Display',    t:'select', opts:['block','inline','inline-block','flex','inline-flex','grid','inline-grid','none'], section:'Layout' },
    { key:'borderRadius',    css:'border-radius',    lbl:'Radius',     t:'range', min:0, max:60, step:1, unit:'px', section:'Layout' },
    { key:'opacity',         css:'opacity',          lbl:'Opacity',    t:'range', min:0, max:1,  step:.01, unit:'',  section:'Layout' },
  ];

  function renderInspector() {
    const c = document.getElementById('tab-inspector');
    c.innerHTML = '';

    // Pick button
    const btn = el('button', { className: 'vt-pick-btn' + (S.picking ? ' picking' : '') },
      S.picking ? '⊗  Click an element…  (Esc to cancel)' : '⊕  Pick Element'
    );
    btn.addEventListener('click', togglePicker);
    c.appendChild(btn);

    // Selector bar
    const bar = el('div', { id: 'vt-sel-bar' }, S.selector || 'No element selected');
    c.appendChild(bar);

    if (!S.targetEl) return;

    // Group props by section
    const sections = ['Color', 'Typography', 'Spacing', 'Layout'];
    for (const sec of sections) {
      const secProps = PROPS.filter(p => p.section === sec);
      const wrap = el('div', { className: 'vt-sec' });
      wrap.appendChild(el('div', { className: 'vt-sec-ttl' }, sec));
      secProps.forEach(p => wrap.appendChild(buildPropRow(p)));
      c.appendChild(wrap);
    }

    // Action row
    const row = el('div', { className: 'vt-action-row' });

    const undoBtn = el('button', {
      className: 'vt-btn undo',
      title: `Undo last file write (${S.undoDepth} available)`,
    }, `↩ Undo${S.undoDepth ? ' (' + S.undoDepth + ')' : ''}`);
    if (!S.undoDepth) undoBtn.disabled = true;
    undoBtn.addEventListener('click', doUndo);

    const resetBtn = el('button', { className: 'vt-btn sec', style: 'flex:1' }, 'Reset');
    resetBtn.addEventListener('click', () => {
      PROPS.forEach(p => { if (S.targetEl) S.targetEl.style[p.key] = ''; });
      S.pendingProps = {};
      vtToast('Preview reset');
      renderInspector();
    });
    const applyBtn = el('button', { className: 'vt-btn', style: 'flex:2' }, 'Apply to Source');
    applyBtn.addEventListener('click', applyToSource);

    row.appendChild(undoBtn);
    row.appendChild(resetBtn);
    row.appendChild(applyBtn);
    c.appendChild(row);
  }

  function buildPropRow(prop) {
    const cs = S.targetEl ? getComputedStyle(S.targetEl) : {};
    const cur = S.targetEl ? (cs[prop.key] || '') : '';
    const row = el('div', { className: 'vt-row' });
    row.appendChild(el('span', { className: 'vt-lbl' }, prop.lbl));

    if (prop.t === 'color') {
      const hex = toHex(cur) || '#000000';
      const ci = el('input', { type: 'color', className: 'vt-clr', value: hex });
      const ti = el('input', { type: 'text',  className: 'vt-in', value: cur, placeholder: 'color or var(--x)' });
      ci.addEventListener('input', e => {
        ti.value = e.target.value;
        liveSet(prop, e.target.value);
      });
      ti.addEventListener('input', e => {
        const h = toHex(e.target.value);
        if (h) ci.value = h;
        liveSet(prop, e.target.value);
      });
      row.appendChild(ci);
      row.appendChild(ti);

    } else if (prop.t === 'range') {
      const num = parseFloat(cur) || 0;
      const ri  = el('input', { type: 'range', className: 'vt-range',
        min: prop.min, max: prop.max, step: prop.step, value: num });
      const rv  = el('span', { className: 'vt-rv' }, num + prop.unit);
      ri.addEventListener('input', e => {
        const v = parseFloat(e.target.value);
        const s = prop.unit ? v + prop.unit : String(v);
        rv.textContent = s;
        liveSet(prop, s);
      });
      row.appendChild(ri); row.appendChild(rv);

    } else if (prop.t === 'align') {
      const grp = el('div', { className: 'vt-align-grp' });
      ['left','center','right','justify'].forEach(a => {
        const ab = el('button', { className: 'vt-align-btn' + (cur === a ? ' on' : ''), title: a },
          { left:'L', center:'C', right:'R', justify:'J' }[a]);
        ab.addEventListener('click', () => {
          grp.querySelectorAll('.vt-align-btn').forEach(b => b.classList.remove('on'));
          ab.classList.add('on');
          liveSet(prop, a);
        });
        grp.appendChild(ab);
      });
      row.appendChild(grp);

    } else if (prop.t === 'select') {
      const sel = el('select', { className: 'vt-sel' });
      prop.opts.forEach(o => {
        const opt = el('option', { value: o }, o);
        if (cur === o || cur.startsWith(o)) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', e => liveSet(prop, e.target.value));
      row.appendChild(sel);

    } else { // text
      const ti = el('input', { type: 'text', className: 'vt-in', value: cur });
      ti.addEventListener('input', e => liveSet(prop, e.target.value));
      row.appendChild(ti);
    }

    return row;
  }

  function liveSet(prop, value) {
    if (S.targetEl) S.targetEl.style[prop.key] = value;
    if (value) S.pendingProps[prop.css] = value;
    else delete S.pendingProps[prop.css];
  }

  async function applyToSource() {
    const entries = Object.entries(S.pendingProps);
    if (!S.selector || entries.length === 0) return vtToast('Nothing to apply');

    // ── Session recording mode ──
    if (SESSION.active) {
      for (const [css, value] of entries) {
        sessionAdd({ selector: S.selector, property: css, value,
          component: null, file: null, source: 'inspector' });
      }
      S.pendingProps = {};
      vtToast(`⏺ Added ${entries.length} change${entries.length > 1 ? 's' : ''} to session`);
      renderInspector();
      return;
    }

    let last;
    for (const [css, value] of entries) {
      try {
        const r = await fetch(`${SERVER}/apply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selector: S.selector, property: css, value }),
        });
        last = await r.json();
      } catch { vtToast('Server error — is it running?', 3000); return; }
    }
    if (last?.success) {
      vtToast(`Saved ${entries.length} prop${entries.length > 1 ? 's' : ''} → ${last.file}`);
      S.pendingProps = {};
      refreshUndoDepth();
    } else {
      vtToast('Error: ' + (last?.error || 'unknown'), 3500);
    }
  }

  async function doUndo() {
    try {
      const r    = await fetch(`${SERVER}/undo`, { method: 'POST' });
      const data = await r.json();
      if (data.success) {
        S.undoDepth = data.remaining;
        vtToast(`↩ Undone → ${data.file}`);
        renderInspector();
      } else {
        vtToast(data.error || 'Nothing to undo');
      }
    } catch { vtToast('Server error', 3000); }
  }

  /** Refresh undo depth from server (called after each successful apply). */
  async function refreshUndoDepth() {
    try {
      const r    = await fetch(`${SERVER}/undo-stack`);
      const data = await r.json();
      S.undoDepth = data.depth;
      renderInspector();
    } catch {}
  }

  // ── Picker ──────────────────────────────────────────────────────────────────
  let hlDiv = null;

  function togglePicker() {
    S.picking ? cleanPicker() : startPicker();
  }

  function startPicker() {
    S.picking = true;
    document.body.classList.add('vt-picking');
    hlDiv = el('div', { id: 'vt-hl' });
    document.body.appendChild(hlDiv);
    document.addEventListener('mouseover', onHover, true);
    document.addEventListener('click',     onPick,  true);
    document.addEventListener('keydown',   onEsc,   true);
    renderInspector();
  }

  function cleanPicker() {
    S.picking = false;
    document.body.classList.remove('vt-picking');
    if (hlDiv) { hlDiv.remove(); hlDiv = null; }
    document.removeEventListener('mouseover', onHover, true);
    document.removeEventListener('click',     onPick,  true);
    document.removeEventListener('keydown',   onEsc,   true);
    renderInspector();
  }

  function onHover(e) {
    if (panel.contains(e.target)) return;
    if (!hlDiv) return;
    const r = e.target.getBoundingClientRect();
    hlDiv.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;`;
  }

  function onPick(e) {
    if (panel.contains(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    S.targetEl  = e.target;
    S.selector  = bestSelector(e.target);
    S.pendingProps = {};
    cleanPicker();
  }

  function onEsc(e) { if (e.key === 'Escape') cleanPicker(); }

  function bestSelector(el) {
    if (el.id && !/^vt/.test(el.id)) return '#' + el.id;
    const cls = Array.from(el.classList)
      .filter(c => !/^(vt-|active$|hover$|focus$|open$|closed$|show$|hide$|is-|has-)/.test(c));
    if (cls.length) return el.tagName.toLowerCase() + '.' + cls.slice(0, 3).join('.');
    const par = el.parentElement;
    if (par && par !== document.body && par !== document.documentElement) {
      return bestSelector(par) + ' > ' + el.tagName.toLowerCase();
    }
    return el.tagName.toLowerCase();
  }

  // ════════════════════════════════════════════════════════════════════════════
  // DESIGN SYSTEM TAB
  // ════════════════════════════════════════════════════════════════════════════

  async function loadTokens() {
    const c = document.getElementById('tab-design');
    c.innerHTML = '<div class="vt-empty">Scanning tokens…</div>';
    try {
      const r = await fetch(`${SERVER}/scan-tokens`);
      S.tokens     = await r.json();
      S.tokenEdits = {};
      renderDesign();
    } catch {
      c.innerHTML = '<div class="vt-empty">Could not reach server at ' + SERVER + '</div>';
    }
  }

  function renderDesign() {
    const c = document.getElementById('tab-design');
    c.innerHTML = '';

    const cats = ['colors','typography','spacing','shadows','radius','motion','z-index','other'];
    const total = cats.reduce((n, k) => n + (S.tokens[k]?.length || 0), 0);
    if (total === 0) {
      c.innerHTML = '<div class="vt-empty">No CSS custom properties or SCSS variables found.</div>';
    }

    for (const cat of cats) {
      const tokens = S.tokens[cat] || [];
      if (!tokens.length) continue;

      const grp = el('div', { className: 'vt-sec' });
      grp.appendChild(el('div', { className: 'vt-sec-ttl' },
        cat[0].toUpperCase() + cat.slice(1) + ` (${tokens.length})`));

      tokens.forEach(tok => {
        const row = el('div', { className: 'vt-tk-row' });
        const nm  = el('span', { className: 'vt-tk-name', title: `${tok.name} — ${tok.file}` }, tok.name);
        row.appendChild(nm);

        const onChange = v => { S.tokenEdits[tok.name] = v; };

        if (cat === 'colors') {
          const hex = toHex(tok.value) || '#000000';
          const ci = el('input', { type:'color', className:'vt-clr', value: hex });
          const ti = el('input', { type:'text',  className:'vt-in', value: tok.value, style:'width:90px' });
          ci.addEventListener('input', e => { ti.value = e.target.value; onChange(e.target.value); });
          ti.addEventListener('input', e => {
            const h = toHex(e.target.value);
            if (h) ci.value = h;
            onChange(e.target.value);
          });
          row.appendChild(ci); row.appendChild(ti);
        } else {
          const ti = el('input', { type:'text', className:'vt-in', value: tok.value, style:'width:130px' });
          ti.addEventListener('input', e => onChange(e.target.value));
          row.appendChild(ti);
        }

        grp.appendChild(row);
      });
      c.appendChild(grp);
    }

    const bar = el('div', { className: 'vt-action-row' });
    const rel = el('button', { className:'vt-btn sec', style:'flex:1' }, 'Rescan');
    rel.addEventListener('click', () => { S.tokens = null; loadTokens(); });
    const sav = el('button', { className:'vt-btn', style:'flex:2' }, 'Save design-tokens.css');
    sav.addEventListener('click', saveTokens);
    bar.appendChild(rel); bar.appendChild(sav);
    c.appendChild(bar);
  }

  async function saveTokens() {
    const all = Object.values(S.tokens).flat().map(t =>
      S.tokenEdits[t.name] !== undefined
        ? { ...t, value: S.tokenEdits[t.name] }
        : t
    );
    try {
      const r    = await fetch(`${SERVER}/save-tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokens: all }),
      });
      const data = await r.json();
      vtToast(data.success ? `Saved → ${data.files?.join(', ')}` : 'Save failed');
    } catch { vtToast('Server error', 3000); }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // COMPONENTS TAB
  // ════════════════════════════════════════════════════════════════════════════

  async function loadComponents() {
    const c = document.getElementById('tab-components');
    c.innerHTML = '<div class="vt-empty">Scanning components…</div>';
    try {
      const r    = await fetch(`${SERVER}/components`);
      S.components = await r.json();
      S.selectedCompIdx = -1;
      renderComponents();
    } catch {
      c.innerHTML = '<div class="vt-empty">Could not reach server at ' + SERVER + '</div>';
    }
  }

  function renderComponents() {
    const c = document.getElementById('tab-components');
    c.innerHTML = '';

    if (!S.components?.length) {
      c.innerHTML = '<div class="vt-empty">No React components found.</div>';
      return;
    }

    c.appendChild(el('div', { className: 'vt-sub' }, `${S.components.length} components`));

    S.components.forEach((comp, i) => {
      const item = el('div', { className: 'vt-comp' + (i === S.selectedCompIdx ? ' on' : '') });
      item.appendChild(el('div', { className: 'vt-comp-name' }, comp.name));
      item.appendChild(el('div', { className: 'vt-comp-path' }, comp.file));
      item.addEventListener('click', () => {
        S.selectedCompIdx = i === S.selectedCompIdx ? -1 : i;
        S.classUsages     = null;
        S.creatingOverride = false;
        S.editingRuleKey  = null;
        renderComponents();
      });
      c.appendChild(item);
    });

    if (S.selectedCompIdx >= 0) {
      const comp = S.components[S.selectedCompIdx];
      const det  = el('div', { style: 'margin-top:10px' });

      det.appendChild(el('div', { className: 'vt-sec-ttl' }, comp.name));

      // ── Full editor launch button ──
      const fullBtn = el('button', { className: 'vt-m-open-btn' },
        '⊞  Open Full Editor — Edit & Apply to All Instances');
      fullBtn.addEventListener('click', () => openComponentEditor(comp, S.classUsages));
      det.appendChild(fullBtn);

      // ── CSS Rules (only for non-Tailwind components) ──
      if (comp.rules.length > 0) {
        det.appendChild(el('div', { className: 'vt-sec-ttl', style:'margin-top:8px' }, 'CSS Rules'));
        comp.rules.slice(0, 40).forEach((rule, ri) => {
          const ruleKey   = `${S.selectedCompIdx}:${ri}`;
          const isEditing = S.editingRuleKey === ruleKey;
          const blk = el('div', { className: 'vt-rule' });

          const hd = el('div', { className: 'vt-rule-hd' });
          hd.appendChild(el('div', { className: 'vt-rule-sel' }, rule.selector));
          const badge = el('span', { className: 'vt-badge' }, rule.file.split('/').pop());
          const editBtn = el('button', {
            className: 'vt-btn sec',
            style: 'padding:2px 8px;font-size:10px;flex-shrink:0',
          }, isEditing ? 'Cancel' : 'Edit');
          editBtn.addEventListener('click', () => {
            S.editingRuleKey = isEditing ? null : ruleKey;
            renderComponents();
          });
          hd.appendChild(badge); hd.appendChild(editBtn);
          blk.appendChild(hd);

          if (isEditing) {
            const wrap = el('div', { className: 'vt-rule-edit-wrap' });
            const ta = el('textarea', { className: 'vt-rule-ta' });
            ta.value = rule.declarations.split(';').map(d => d.trim()).filter(Boolean).map(d => d + ';').join('\n');
            wrap.appendChild(ta);
            const saveBtn = el('button', { className: 'vt-btn', style: 'width:100%;margin-top:5px' }, 'Save to File');
            saveBtn.addEventListener('click', () => saveRule(rule.file, rule.selector, ta.value));
            wrap.appendChild(saveBtn);
            blk.appendChild(wrap);
          } else {
            rule.declarations.split(';').filter(d => d.trim()).forEach(d =>
              blk.appendChild(el('div', { className: 'vt-rule-decl' }, d.trim() + ';'))
            );
          }
          det.appendChild(blk);
        });
        if (comp.rules.length > 40)
          det.appendChild(el('div', { className: 'vt-sub' }, `+${comp.rules.length - 40} more…`));
      }

      // ── Tailwind/className viewer ──
      if (S.classUsages && S.classUsages._forFile === comp.file) {
        renderClassUsages(det, S.classUsages);
      } else {
        S.classUsages = null;
        loadClassUsages(comp.file).then(data => {
          if (S.selectedCompIdx >= 0 && S.components[S.selectedCompIdx].file === comp.file) {
            S.classUsages = data;
            renderComponents();
          }
        });
        det.appendChild(el('div', { className: 'vt-empty', style:'padding:8px 0;font-size:10px' }, 'Loading…'));
      }

      // ── Create CSS Override ──
      const overrideToggle = el('button', {
        className: 'vt-btn sec',
        style: 'width:100%;margin-top:10px',
      }, S.creatingOverride ? '✕ Cancel' : '+ Create CSS Override Rule');
      overrideToggle.addEventListener('click', () => {
        S.creatingOverride = !S.creatingOverride;
        renderComponents();
      });
      det.appendChild(overrideToggle);

      if (S.creatingOverride) det.appendChild(buildOverrideForm(comp));

      c.appendChild(det);
    }

    const btn = el('button', { className: 'vt-btn sec', style: 'width:100%;margin-top:8px' }, 'Rescan');
    btn.addEventListener('click', () => { S.components = null; S.classUsages = null; loadComponents(); });
    c.appendChild(btn);
  }

  // ── Class usages loader ──────────────────────────────────────────────────────
  async function loadClassUsages(file) {
    try {
      const r = await fetch(`${SERVER}/component-classes?file=${encodeURIComponent(file)}`);
      const d = await r.json();
      d._forFile = file;
      return d;
    } catch { return { _forFile: file, classUsages: [] }; }
  }

  function renderClassUsages(container, data) {
    const usages = data.classUsages || [];
    if (!usages.length) return;

    const sec = el('div', { className: 'vt-sec-ttl', style: 'margin-top:10px' },
      'Tailwind Classes  (click to copy)');
    container.appendChild(sec);

    // Group by tag, deduplicate
    const byTag = new Map();
    usages.forEach(u => {
      const key = u.tag;
      if (!byTag.has(key)) byTag.set(key, new Set());
      u.classes.forEach(c => byTag.get(key).add(c));
    });

    byTag.forEach((classes, tag) => {
      const blk = el('div', { className: 'vt-cls-block' });
      blk.appendChild(el('div', { className: 'vt-cls-tag' }, '<' + tag + '>'));
      const pills = el('div', { className: 'vt-cls-pills' });
      classes.forEach(cls => {
        const pill = el('span', { className: 'vt-pill', title: 'Click to copy' }, cls);
        pill.addEventListener('click', () => {
          navigator.clipboard?.writeText(cls).catch(() => {});
          vtToast(`Copied: ${cls}`, 1200);
        });
        pills.appendChild(pill);
      });
      blk.appendChild(pills);
      container.appendChild(blk);
    });
  }

  // ── Override form builder ────────────────────────────────────────────────────
  function buildOverrideForm(comp) {
    const form = el('div', { className: 'vt-override-form' });
    form.appendChild(el('div', { className: 'vt-override-ttl' }, 'New CSS Override'));
    form.appendChild(el('div', { className: 'vt-override-hint' },
      'Rule will be written to src/styles/visual-tweaks.css'));

    form.appendChild(el('label', { className: 'vt-in-lbl' }, 'CSS Selector'));
    const selIn = el('input', {
      type: 'text', className: 'vt-in',
      style: 'width:100%;margin-bottom:8px',
      placeholder: '.my-class, #id, table tr td',
    });
    // Pre-fill with a sensible guess from the component name
    selIn.value = '.' + comp.name.replace(/([A-Z])/g, m => '-' + m.toLowerCase()).replace(/^-/, '');
    form.appendChild(selIn);

    form.appendChild(el('label', { className: 'vt-in-lbl' }, 'Declarations'));
    const ta = el('textarea', {
      className: 'vt-rule-ta',
      placeholder: 'color: red;\nfont-size: 14px;\nborder-radius: 6px;',
    });
    ta.style.marginBottom = '8px';
    form.appendChild(ta);

    const saveBtn = el('button', { className: 'vt-btn', style: 'width:100%' }, 'Write Override to File');
    saveBtn.addEventListener('click', async () => {
      const selector = selIn.value.trim();
      const decls    = ta.value.trim();
      if (!selector || !decls) return vtToast('Fill in selector and declarations');
      await saveRule(null, selector, decls);
      S.creatingOverride = false;
      renderComponents();
    });
    form.appendChild(saveBtn);
    return form;
  }

  // ── Shared rule save helper ──────────────────────────────────────────────────
  async function saveRule(file, selector, declarations) {
    try {
      const r = await fetch(`${SERVER}/apply-rule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file, selector, declarations }),
      });
      const data = await r.json();
      if (data.success) {
        vtToast(`Saved → ${data.file}`);
        S.editingRuleKey = null;
        S.components = null;
        refreshUndoDepth();
        renderComponents();
      } else {
        vtToast('Error: ' + (data.error || 'unknown'), 3000);
      }
    } catch { vtToast('Server error', 3000); }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // COMPONENT FULL EDITOR MODAL
  // ════════════════════════════════════════════════════════════════════════════

  // ── Drawer state ────────────────────────────────────────────────────────────
  let _drawer   = null;   // #vt-drawer element
  let _dProps   = {};     // { cssProperty: value }
  let _dSel     = '';     // active CSS selector
  let _dPreview = null;   // <style> live preview
  let _dBody    = null;   // scrollable body container
  let _ringEl   = null;   // highlight ring div
  let _labelEl  = null;   // ring label div
  let _pushStyle= null;   // <style> that pushes body

  function openComponentEditor(comp, classUsages) {
    closeDrawer();
    _dProps = {};
    _dSel   = guessSel(comp, classUsages);

    // Live-preview style tag
    _dPreview = document.createElement('style');
    _dPreview.id = 'vt-drawer-preview';
    document.head.appendChild(_dPreview);

    // Push page body left
    _pushStyle = document.createElement('style');
    _pushStyle.id = 'vt-push';
    _pushStyle.textContent = `body{margin-right:440px!important;transition:margin-right .28s cubic-bezier(.4,0,.2,1);}`;
    document.head.appendChild(_pushStyle);

    // ── Build drawer ────────────────────────────────────────────────────────
    const drawer = el('div', { id: 'vt-drawer' });

    // Header
    const hd = el('div', { className: 'vt-d-hd' });
    const hdRow = el('div', { className: 'vt-d-hd-row' });
    hdRow.appendChild(el('div', { className: 'vt-d-name' }, comp.name));
    const xBtn = el('button', { className: 'vt-d-close', title: 'Close (Esc)' }, '×');
    xBtn.addEventListener('click', closeDrawer);
    hdRow.appendChild(xBtn);
    hd.appendChild(hdRow);
    hd.appendChild(el('div', { className: 'vt-d-file' }, comp.file));

    // Selector row
    const selRow = el('div', { className: 'vt-d-sel-wrap' });
    const selIn  = el('input', {
      type: 'text', className: 'vt-d-sel-in',
      value: _dSel, placeholder: '.my-class, [role="alert"]',
    });
    const matchBadge = el('span', { className: 'vt-d-match no' }, '—');

    const onSelChange = () => {
      _dSel = selIn.value.trim();
      refreshHighlight();
      rebuildDrawerBody();
      updateDrawerPreview();
    };
    selIn.addEventListener('input', onSelChange);
    selRow.appendChild(selIn);
    selRow.appendChild(matchBadge);
    hd.appendChild(selRow);

    // Selector suggestions
    const suggs = buildSelectorSuggestions(comp, classUsages);
    if (suggs.length) {
      const suggRow = el('div', { className: 'vt-d-sugg' });
      suggs.forEach(s => {
        const p = el('span', { className: 'vt-pill' }, s);
        p.addEventListener('click', () => {
          selIn.value = s; _dSel = s;
          refreshHighlight(); rebuildDrawerBody(); updateDrawerPreview();
        });
        suggRow.appendChild(p);
      });
      hd.appendChild(suggRow);
    }
    drawer.appendChild(hd);

    // Scrollable body
    _dBody = el('div', { className: 'vt-d-body' });
    buildDrawerBody(_dBody, comp, classUsages);
    drawer.appendChild(_dBody);

    // Footer
    const ft     = el('div', { className: 'vt-d-ft' });
    const status = el('div', { className: 'vt-d-status', id: 'vt-d-status' },
      'Edits preview live on the page. Nothing is saved until you Apply.');
    const cancelBtn = el('button', { className: 'vt-btn sec' }, 'Cancel');
    cancelBtn.addEventListener('click', closeDrawer);
    const applyBtn  = el('button', { className: 'vt-btn', style: 'white-space:nowrap' },
      'Apply to All Instances');
    applyBtn.addEventListener('click', () => applyDrawer());
    ft.appendChild(status); ft.appendChild(cancelBtn); ft.appendChild(applyBtn);
    drawer.appendChild(ft);

    document.body.appendChild(drawer);
    _drawer = drawer;

    // Animate open
    requestAnimationFrame(() => drawer.classList.add('vt-open'));
    document.addEventListener('keydown', _onDrawerEsc);

    // Initial highlight
    refreshHighlight();
    updateMatchBadge(matchBadge);
    // Keep badge in sync when selector changes
    selIn.addEventListener('input', () => updateMatchBadge(matchBadge));
  }

  function updateMatchBadge(badge) {
    const hit = _dSel ? (() => { try { return document.querySelector(_dSel); } catch { return null; } })() : null;
    if (hit) {
      badge.textContent = `✓ ${hit.tagName.toLowerCase()}`;
      badge.className = 'vt-d-match ok';
    } else {
      badge.textContent = _dSel ? 'no match' : '—';
      badge.className = 'vt-d-match no';
    }
  }

  function rebuildDrawerBody() {
    if (!_dBody) return;
    // Keep only the property cards (remove from second child onwards)
    // First child is the Tailwind classes card, rest are property cards
    // Easier: clear and rebuild
    _dBody.innerHTML = '';
    const comp       = S.components?.[S.selectedCompIdx];
    const classUsages = S.classUsages;
    if (comp) buildDrawerBody(_dBody, comp, classUsages);
  }

  function buildDrawerBody(container, comp, classUsages) {
    const targetEl = _dSel ? (() => { try { return document.querySelector(_dSel); } catch { return null; } })() : null;

    // ── Tailwind classes card ──
    if (classUsages?.classUsages?.length) {
      const card = el('div', { className: 'vt-d-card' });
      card.appendChild(el('div', { className: 'vt-d-card-ttl' }, 'Tailwind Classes  ·  click to copy'));
      const byTag = new Map();
      classUsages.classUsages.forEach(u => {
        if (!byTag.has(u.tag)) byTag.set(u.tag, new Set());
        u.classes.forEach(c => byTag.get(u.tag).add(c));
      });
      byTag.forEach((classes, tag) => {
        card.appendChild(el('div', {
          style: 'font:600 10px/1.4 ui-monospace,monospace;color:var(--d-accent);margin-bottom:5px;margin-top:8px;',
        }, '<' + tag + '>'));
        const pills = el('div', { className: 'vt-cls-pills' });
        classes.forEach(cls => {
          const p = el('span', { className: 'vt-pill' }, cls);
          p.addEventListener('click', () => {
            navigator.clipboard?.writeText(cls).catch(() => {});
            vtToast('Copied: ' + cls, 1200);
          });
          pills.appendChild(p);
        });
        card.appendChild(pills);
      });
      container.appendChild(card);
    }

    // ── Property cards ──
    const sections = [
      { title: 'Color',      keys: ['backgroundColor','color','borderColor'] },
      { title: 'Typography', keys: ['fontSize','fontWeight','lineHeight','letterSpacing','textAlign'] },
      { title: 'Spacing',    keys: ['paddingTop','paddingRight','paddingBottom','paddingLeft','marginTop','marginBottom'] },
      { title: 'Layout',     keys: ['width','height','display','borderRadius','opacity'] },
    ];
    for (const sec of sections) {
      const card = el('div', { className: 'vt-d-card' });
      card.appendChild(el('div', { className: 'vt-d-card-ttl' }, sec.title));
      sec.keys.forEach(key => {
        const prop = PROPS.find(p => p.key === key);
        if (prop) card.appendChild(buildDrawerField(prop, targetEl));
      });
      container.appendChild(card);
    }
  }

  // ── Drawer property field (label above, full-width) ─────────────────────────
  function buildDrawerField(prop, targetEl) {
    const cs  = targetEl ? getComputedStyle(targetEl) : {};
    const cur = _dProps[prop.css] || (targetEl ? (cs[prop.key] || '') : '');

    const field = el('div', { className: 'vt-d-field' });
    const fhd   = el('div', { className: 'vt-d-fhd' });
    fhd.appendChild(el('label', { className: 'vt-d-lbl' }, prop.lbl));

    const setVal = v => {
      if (v) _dProps[prop.css] = v; else delete _dProps[prop.css];
      updateDrawerPreview();
    };

    if (prop.t === 'color') {
      const hex = toHex(cur) || '#000000';
      field.appendChild(fhd);
      const ctrl = el('div', { className: 'vt-d-ctrl' });
      const ci = el('input', { type: 'color', className: 'vt-d-clr', value: hex });
      const ti = el('input', { type: 'text', className: 'vt-d-in', value: cur, placeholder: 'oklch(…) or #hex' });
      ci.addEventListener('input', e => { ti.value = e.target.value; setVal(e.target.value); });
      ti.addEventListener('input', e => { const h = toHex(e.target.value); if (h) ci.value = h; setVal(e.target.value); });
      ctrl.appendChild(ci); ctrl.appendChild(ti);
      field.appendChild(ctrl);

    } else if (prop.t === 'range') {
      const num = parseFloat(cur) || 0;
      const valSpan = el('span', { className: 'vt-d-val' }, (num || 0) + (prop.unit || ''));
      fhd.appendChild(valSpan);
      field.appendChild(fhd);
      const ri = el('input', { type: 'range', className: 'vt-d-range',
        min: prop.min, max: prop.max, step: prop.step, value: num });
      ri.addEventListener('input', e => {
        const v = parseFloat(e.target.value);
        const s = prop.unit ? v + prop.unit : String(v);
        valSpan.textContent = s; setVal(s);
      });
      field.appendChild(ri);

    } else if (prop.t === 'align') {
      field.appendChild(fhd);
      const grp = el('div', { className: 'vt-d-align' });
      ['left','center','right','justify'].forEach(a => {
        const ab = el('button', { className: 'vt-d-ab' + (cur === a ? ' on' : ''), title: a },
          { left:'Left', center:'Center', right:'Right', justify:'Justify' }[a]);
        ab.addEventListener('click', () => {
          grp.querySelectorAll('.vt-d-ab').forEach(b => b.classList.remove('on'));
          ab.classList.add('on'); setVal(a);
        });
        grp.appendChild(ab);
      });
      field.appendChild(grp);

    } else if (prop.t === 'select') {
      field.appendChild(fhd);
      const sel = el('select', { className: 'vt-d-sel' });
      prop.opts.forEach(o => {
        const opt = el('option', { value: o }, o);
        if (cur === o || cur.startsWith(o)) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', e => setVal(e.target.value));
      field.appendChild(sel);

    } else {
      field.appendChild(fhd);
      const ti = el('input', { type: 'text', className: 'vt-d-in', value: cur });
      ti.addEventListener('input', e => setVal(e.target.value));
      field.appendChild(ti);
    }

    return field;
  }

  // ── Live preview ─────────────────────────────────────────────────────────────
  function updateDrawerPreview() {
    if (!_dPreview) return;
    const decls = Object.entries(_dProps)
      .map(([k, v]) => `  ${k}: ${v} !important;`).join('\n');
    _dPreview.textContent = (_dSel && decls) ? `${_dSel} {\n${decls}\n}` : '';

    const status = document.getElementById('vt-d-status');
    if (status) {
      const n = Object.keys(_dProps).length;
      status.textContent = n
        ? `${n} propert${n > 1 ? 'ies' : 'y'} changed — previewing live`
        : 'Edits preview live on the page. Nothing is saved until you Apply.';
      status.style.color = n ? 'var(--d-accent)' : '';
    }
  }

  // ── Element highlight ring ────────────────────────────────────────────────────
  function refreshHighlight() {
    clearHighlight();
    if (!_dSel) return;
    let target;
    try { target = document.querySelector(_dSel); } catch { return; }
    if (!target) return;

    target.scrollIntoView({ behavior: 'smooth', block: 'center' });

    _ringEl  = document.createElement('div'); _ringEl.id  = 'vt-el-ring';
    _labelEl = document.createElement('div'); _labelEl.id = 'vt-el-label';
    document.body.appendChild(_ringEl);
    document.body.appendChild(_labelEl);
    positionRing(target);

    // Reposition on scroll/resize
    const reposition = () => positionRing(target);
    window.addEventListener('scroll', reposition, { passive: true });
    window.addEventListener('resize', reposition, { passive: true });
    _ringEl._cleanup = () => {
      window.removeEventListener('scroll', reposition);
      window.removeEventListener('resize', reposition);
    };
  }

  function positionRing(target) {
    if (!_ringEl || !target) return;
    const r = target.getBoundingClientRect();
    const pad = 4;
    _ringEl.style.cssText  = `left:${r.left-pad}px;top:${r.top-pad}px;width:${r.width+pad*2}px;height:${r.height+pad*2}px;`;
    _labelEl.style.cssText = `left:${r.left-pad}px;top:${Math.max(0,r.top-pad-22)}px;`;
    _labelEl.textContent   = `${target.tagName.toLowerCase()} · ${Math.round(r.width)}×${Math.round(r.height)}`;
  }

  function clearHighlight() {
    if (_ringEl)  { _ringEl._cleanup?.(); _ringEl.remove();  _ringEl  = null; }
    if (_labelEl) { _labelEl.remove(); _labelEl = null; }
  }

  // ── Selector suggestions ──────────────────────────────────────────────────────
  function guessSel(comp, classUsages) {
    const kebab = comp.name.replace(/([A-Z])/g, m => '-' + m.toLowerCase()).replace(/^-/, '');
    const candidates = [`.${kebab}`,`[role="${kebab}"]`,`[data-slot="${kebab}"]`];
    if (classUsages?.classUsages) {
      const util = /^(relative|absolute|fixed|flex|grid|block|inline|hidden|w-|h-|p-|m-|text-|font-|bg-|border|rounded|overflow|z-|gap-|sr-)/;
      classUsages.classUsages.forEach(u => u.classes.forEach(c => {
        if (!util.test(c) && c.length < 24 && !c.includes(':') && !c.includes('['))
          candidates.push('.' + c);
      }));
    }
    for (const s of candidates) { try { if (document.querySelector(s)) return s; } catch {} }
    return `.${kebab}`;
  }

  function buildSelectorSuggestions(comp, classUsages) {
    const kebab = comp.name.replace(/([A-Z])/g, m => '-' + m.toLowerCase()).replace(/^-/,'');
    const pool  = [`.${kebab}`,`[role="${kebab}"]`,`[data-slot="${kebab}"]`,`[data-${kebab}]`];
    if (classUsages?.classUsages) {
      const util = /^(relative|absolute|fixed|flex|grid|block|inline|hidden|w-|h-|p-|m-|text-|font-|bg-|border|rounded|overflow|z-|gap-|sr-)/;
      classUsages.classUsages.forEach(u => u.classes.forEach(c => {
        if (!util.test(c) && c.length < 24 && !c.includes(':') && !c.includes('['))
          pool.push('.' + c);
      }));
    }
    const live = [...new Set(pool)].filter(s => { try { return !!document.querySelector(s); } catch { return false; } });
    return live.slice(0, 6);
  }

  // ── Apply ────────────────────────────────────────────────────────────────────
  async function applyDrawer() {
    const entries = Object.entries(_dProps);
    if (!_dSel)          return vtToast('Enter a CSS selector first');
    if (!entries.length) return vtToast('No changes to apply');

    // ── Session recording mode ──
    if (SESSION.active) {
      const comp = S.components?.[S.selectedCompIdx];
      for (const [css, value] of entries) {
        sessionAdd({
          selector:  _dSel,
          property:  css,
          value,
          component: comp?.name  || null,
          file:      comp?.file  || null,
          source:    'drawer',
        });
      }
      vtToast(`⏺ Added ${entries.length} change${entries.length > 1 ? 's' : ''} to session`);
      closeDrawer();
      return;
    }

    const declarations = entries.map(([k, v]) => `${k}: ${v};`).join('\n');
    try {
      const r    = await fetch(`${SERVER}/apply-rule`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: null, selector: _dSel, declarations }),
      });
      const data = await r.json();
      if (data.success) {
        vtToast(`✓ Saved ${entries.length} rule(s) → ${data.file}`);
        refreshUndoDepth();
        closeDrawer();
        S.components = null;
      } else { vtToast('Error: ' + (data.error || 'unknown'), 3500); }
    } catch { vtToast('Server error — is it running?', 3000); }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PROMPT TAB — session recorder + Claude Code brief generator
  // ════════════════════════════════════════════════════════════════════════════

  function renderPromptTab() {
    const c = document.getElementById('tab-prompt');
    c.innerHTML = '';

    // ── Recording control row ──
    const recRow = el('div', { className: 'vt-row', style: 'margin-bottom:10px;align-items:center;gap:8px;' });
    const recLabel = el('span', { className: 'vt-lbl', style: 'width:auto;font-size:11px;flex:1;' },
      SESSION.active ? '🔴  Recording changes…' : '⚫  Session recording off');
    recLabel.style.color = SESSION.active ? 'oklch(0.7 0.22 20)' : 'var(--vt-fg-dim)';
    const recToggle = el('button', { className: 'vt-btn ' + (SESSION.active ? 'sec' : '') },
      SESSION.active ? 'Stop' : 'Start Recording');
    recToggle.style.cssText = SESSION.active
      ? 'border-color:oklch(0.7 0.22 20);color:oklch(0.7 0.22 20);'
      : '';
    recToggle.addEventListener('click', () => {
      SESSION.active = !SESSION.active;
      updateRecBadge();
      vtToast(SESSION.active
        ? '⏺ Recording — Apply actions buffer here, not files'
        : '⏹ Recording stopped', 2200);
      renderPromptTab();
    });
    recRow.appendChild(recLabel);
    recRow.appendChild(recToggle);
    c.appendChild(recRow);

    // ── Hint ──
    c.appendChild(el('div', { className: 'vt-sub', style: 'text-align:left;margin-bottom:10px;line-height:1.6;' },
      'While recording, "Apply" actions add to this session instead of writing to files. ' +
      'When done, generate a ready-to-paste prompt for Claude Code.'));

    // ── Recorded changes list ──
    if (SESSION.changes.length === 0) {
      c.appendChild(el('div', { className: 'vt-empty' }, 'No changes recorded yet.'));
    } else {
      c.appendChild(el('div', { className: 'vt-sec-ttl' },
        `Recorded Changes  (${SESSION.changes.length})`));

      // Group by selector
      const bySel = new Map();
      SESSION.changes.forEach(ch => {
        if (!bySel.has(ch.selector)) bySel.set(ch.selector, []);
        bySel.get(ch.selector).push(ch);
      });

      bySel.forEach((changes, selector) => {
        const item = el('div', { className: 'vt-session-item' });
        const hd   = el('div', { className: 'vt-session-item-hd' });
        hd.appendChild(el('span', { className: 'vt-session-sel', title: selector }, selector));
        const comp = changes.find(c => c.component)?.component;
        if (comp) hd.appendChild(el('span', { className: 'vt-session-src' }, comp));
        item.appendChild(hd);
        changes.forEach(ch => {
          const row = el('div', { className: 'vt-session-prop' });
          row.appendChild(el('span', { className: 'vt-session-key' }, ch.property + ':'));
          row.appendChild(el('span', { className: 'vt-session-val' }, ch.value));
          const del = el('button', { className: 'vt-session-del', title: 'Remove' }, '×');
          del.addEventListener('click', () => {
            SESSION.changes = SESSION.changes.filter(x => x.id !== ch.id);
            updateRecBadge();
            renderPromptTab();
          });
          row.appendChild(del);
          item.appendChild(row);
        });
        c.appendChild(item);
      });

      const clearBtn = el('button', {
        className: 'vt-btn sec', style: 'width:100%;margin-bottom:12px;',
      }, '× Clear All');
      clearBtn.addEventListener('click', () => {
        SESSION.changes = [];
        updateRecBadge();
        renderPromptTab();
      });
      c.appendChild(clearBtn);
    }

    // ── Generate Prompt button ──
    const genSec = el('div', { className: 'vt-sec', style: 'margin-top:4px;' });
    genSec.appendChild(el('div', { className: 'vt-sec-ttl' }, 'Claude Code Brief'));

    if (SESSION.changes.length === 0) {
      genSec.appendChild(el('div', { className: 'vt-empty', style: 'padding:12px 0;' },
        'Record some changes first, then generate the prompt.'));
    } else {
      const genBtn = el('button', { className: 'vt-btn', style: 'width:100%;margin-bottom:10px;' },
        '⚡ Generate & Copy Prompt for Claude Code');
      const outArea = el('div', { className: 'vt-prompt-out' }, 'Click Generate to build the prompt…');

      genBtn.addEventListener('click', async () => {
        genBtn.textContent = 'Scanning design system…';
        genBtn.disabled    = true;
        try {
          const ctx  = await fetch(`${SERVER}/design-context`).then(r => r.json());
          const text = buildPrompt(SESSION.changes, ctx);
          outArea.textContent = text;
          await navigator.clipboard.writeText(text).catch(() => {});
          vtToast('✓ Prompt copied to clipboard!', 2400);
          genBtn.textContent = '✓ Copied! Generate Again';
        } catch (e) {
          outArea.textContent = 'Error: ' + e.message;
          vtToast('Server error — is it running?', 3000);
          genBtn.textContent = '⚡ Generate & Copy Prompt for Claude Code';
        }
        genBtn.disabled = false;
      });

      genSec.appendChild(genBtn);
      genSec.appendChild(outArea);
    }
    c.appendChild(genSec);
  }

  // ── Prompt builder ────────────────────────────────────────────────────────────
  function buildPrompt(changes, ctx) {
    const lines = [];

    lines.push('# Visual Design Changes — Claude Code Implementation Brief');
    lines.push('');
    lines.push('I used a WYSIWYG visual editor on the live dev server to capture these design');
    lines.push('changes. Each change was visually verified — the selector matched a real DOM');
    lines.push('element and the preview looked correct. Please implement them in the cleanest');
    lines.push('way for this codebase.');
    lines.push('');

    // ── Design system context ──
    lines.push('## 🎨 Design System Context');
    lines.push('');

    if (ctx.libraries?.length) {
      lines.push('**Detected libraries:**');
      ctx.libraries.forEach(l => lines.push(`  - ${l}`));
      lines.push('');
    }

    if (ctx.shadcn) {
      const style   = ctx.shadcn.style   || 'unknown';
      const baseClr = ctx.shadcn.cssVariables !== false ? 'CSS variables' : 'hardcoded';
      lines.push(`**shadcn/ui config:** style = ${style}, colors via ${baseClr}`);
      if (ctx.shadcn.tailwind?.config) lines.push(`  Tailwind config: ${ctx.shadcn.tailwind.config}`);
      lines.push('');
    }

    if (ctx.tailwind?.colors && Object.keys(ctx.tailwind.colors).length) {
      lines.push(`**Tailwind config** (${ctx.tailwind.file}):`);
      const cols = ctx.tailwind.colors;
      Object.entries(cols).slice(0, 12).forEach(([k, v]) => lines.push(`  ${k}: ${v}`));
      if (Object.keys(cols).length > 12) lines.push(`  … and ${Object.keys(cols).length - 12} more`);
      lines.push('');
    }

    if (Object.keys(ctx.tokens || {}).length) {
      lines.push('**Token / theme files found:**');
      Object.keys(ctx.tokens).forEach(f => lines.push(`  - ${f}`));
      lines.push('');
    }

    if (ctx.docs?.length) {
      lines.push('**Design documentation found:**');
      ctx.docs.forEach(d => lines.push(`  - ${d.file}`));
      lines.push('');
    }

    // ── Component variant context ──
    const cvaComps = (ctx.components || []).filter(c => c.type === 'cva');
    if (cvaComps.length) {
      lines.push('## 🧩 Component Variant System (cva)');
      lines.push('');
      cvaComps.slice(0, 8).forEach(comp => {
        lines.push(`**${comp.name}** (${comp.file})`);
        comp.variants.forEach(v => {
          lines.push(`  Variant \`${v.name}\`: ${v.options.join(' | ')}`);
        });
        lines.push('');
      });
    }

    const storyComps = (ctx.components || []).filter(c => c.type === 'stories');
    if (storyComps.length) {
      lines.push('## 📖 Storybook Stories (component states)');
      lines.push('');
      storyComps.slice(0, 6).forEach(comp => {
        lines.push(`**${comp.name}:** ${comp.stories.join(', ')}`);
      });
      lines.push('');
    }

    // ── Recorded changes ──
    lines.push('## 📝 Recorded Visual Changes');
    lines.push('');

    // Group by selector
    const bySel = new Map();
    changes.forEach(ch => {
      if (!bySel.has(ch.selector)) bySel.set(ch.selector, []);
      bySel.get(ch.selector).push(ch);
    });

    let idx = 1;
    bySel.forEach((chs, selector) => {
      const comp = chs.find(c => c.component)?.component;
      const file = chs.find(c => c.file)?.file;
      lines.push(`### ${idx++}. Selector: \`${selector}\``);
      if (comp) lines.push(`**Component:** ${comp}${file ? `  (${file})` : ''}`);
      lines.push('**CSS changes to apply:**');
      chs.forEach(ch => lines.push(`  ${ch.property}: ${ch.value};`));
      lines.push('');
    });

    // ── Implementation instructions ──
    lines.push('## 🎯 Implementation Instructions');
    lines.push('');

    const hasCVA      = cvaComps.length > 0;
    const hasTailwind = ctx.libraries?.some(l => /tailwind/i.test(l));
    const hasShadcn   = ctx.libraries?.some(l => /shadcn/i.test(l));

    lines.push('Apply each change in the most appropriate way for this codebase:');
    lines.push('');

    if (hasShadcn || hasCVA) {
      lines.push('- **CVA/shadcn components:** Update the `cva()` base classes or the matching');
      lines.push('  variant entry rather than adding raw CSS. Preserve all existing variants.');
    }
    if (hasTailwind) {
      lines.push('- **Tailwind classes:** Prefer updating `className` strings or `cn()` calls.');
      lines.push('  If a value matches a Tailwind token (e.g. `rounded-lg`, `font-semibold`),');
      lines.push('  use the utility class instead of a raw CSS value.');
    }
    if (Object.keys(ctx.tokens || {}).length || ctx.tailwind?.colors) {
      lines.push('- **Design tokens:** If a color/size matches an existing token or Tailwind');
      lines.push('  config value, reference the token rather than hardcoding the value.');
    }
    lines.push('- **CSS files:** If editing a CSS/SCSS file directly, update the existing rule');
    lines.push('  in place rather than appending a duplicate selector at the bottom.');
    lines.push('- **Scope:** Only modify the selectors listed above. Do not change other');
    lines.push('  variants, components, or visual properties not listed here.');
    lines.push('- **Verify:** After applying, check that no TypeScript errors are introduced');
    lines.push('  and that the visual result matches the intent of the change.');
    lines.push('');
    lines.push('These changes were captured live from the running dev server.');

    return lines.join('\n');
  }

  // ── Close ────────────────────────────────────────────────────────────────────
  function _onDrawerEsc(e) { if (e.key === 'Escape') closeDrawer(); }

  function closeDrawer() {
    if (_drawer) {
      _drawer.classList.remove('vt-open');
      setTimeout(() => { _drawer?.remove(); _drawer = null; }, 300);
    }
    if (_dPreview) { _dPreview.remove(); _dPreview = null; }
    if (_pushStyle) { _pushStyle.remove(); _pushStyle = null; }
    document.removeEventListener('keydown', _onDrawerEsc);
    clearHighlight();
    _dProps = {}; _dSel = ''; _dBody = null;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** Mini createElement helper: el(tag, attrs, ...children) */
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'className') node.className = v;
      else if (k === 'style' && typeof v === 'string') node.style.cssText = v;
      else node[k] = v;
    }
    for (const c of children) {
      if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else if (c) node.appendChild(c);
    }
    return node;
  }

  /** Convert any CSS color string to #rrggbb hex for <input type="color"> */
  function toHex(color) {
    if (!color || typeof color !== 'string') return null;
    const s = color.trim();
    // Already hex
    if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
    if (/^#[0-9a-fA-F]{3}$/.test(s))
      return '#' + [...s.slice(1)].map(c => c + c).join('');
    if (/^#[0-9a-fA-F]{8}$/.test(s)) return s.slice(0, 7);
    // rgb / rgba
    const rgb = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rgb)
      return '#' + [rgb[1], rgb[2], rgb[3]]
        .map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
    // Named → canvas trick
    const tmp = document.createElement('canvas');
    tmp.width = tmp.height = 1;
    const ctx = tmp.getContext('2d');
    ctx.fillStyle = s;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    if (a === 0) return null;
    return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
  }

  // ── Initial render ───────────────────────────────────────────────────────────
  renderInspector();

})();
