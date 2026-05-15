#!/usr/bin/env node
/**
 * OpenTweaker — Custom Next.js server
 * Runs everything on port 4242:
 *   - Express handles API routes + root proxy
 *   - Next.js handles /editor (React page)
 *   - WebSocket runs on port 4243
 */

'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const chokidar = require('chokidar');
const { execSync } = require('child_process');
const { WebSocketServer } = require('ws');
const { parse } = require('url');
const next = require('next');

const PORT = 4242;
const WS_PORT = 4243;
const ROOT = process.cwd();

// ── Version + update check ────────────────────────────────────────────────────

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const CURRENT_VERSION = pkg.version;
const REPO_URL = (pkg.repository?.url || '').replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');

let latestVersion = null;  // null = unknown, string = fetched

function semverGt(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

async function fetchLatestVersion() {
  if (!REPO_URL || REPO_URL.includes('CHANGE_ME')) return;
  try {
    const raw = await fetch(
      `https://raw.githubusercontent.com/${REPO_URL}/main/package.json`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!raw.ok) return;
    const remote = await raw.json();
    latestVersion = remote.version || null;
    if (latestVersion && semverGt(latestVersion, CURRENT_VERSION)) {
      console.log(`\n  ⬆  Update available: v${CURRENT_VERSION} → v${latestVersion}`);
      console.log(`     Click "Update" in the editor, or run: git pull && node server.cjs\n`);
    }
  } catch { /* network unavailable, ignore */ }
}
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', '.cache']);
const dev = process.env.NODE_ENV !== 'production';

// ── File utilities ────────────────────────────────────────────────────────────

function walkFiles(dir, exts, results = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return results; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(full, exts, results);
    else if (exts.some(x => e.name.endsWith(x))) results.push(full);
  }
  return results;
}

function escapeRx(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── CSS rule-block parser ─────────────────────────────────────────────────────

function findRuleBlock(content, selector) {
  const selectorRx = new RegExp(escapeRx(selector) + '\\s*\\{', 'g');
  let m;
  while ((m = selectorRx.exec(content)) !== null) {
    const openIdx = m.index + m[0].length - 1;
    const bodyStart = openIdx + 1;
    let depth = 1;
    let i = bodyStart;
    while (i < content.length && depth > 0) {
      const ch = content[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      i++;
    }
    if (depth === 0) {
      return { start: m.index, bodyStart, end: i };
    }
  }
  return null;
}

function patchBody(body, property, value) {
  const propRx = new RegExp(
    `([ \\t]*)(${escapeRx(property)})(\\s*:\\s*)([^;\\n]+)(;?)`,
    'i'
  );
  if (propRx.test(body)) {
    return body.replace(propRx, (_, indent, prop, colon, _val, semi) =>
      `${indent}${prop}${colon}${value}${semi || ';'}`
    );
  }
  const trimmed = body.replace(/[ \t]+$/, '');
  const nl = trimmed.endsWith('\n') ? '' : '\n';
  return trimmed + nl + `  ${property}: ${value};\n`;
}

function applyToContent(content, selector, property, value) {
  const block = findRuleBlock(content, selector);
  if (!block) return { content, found: false };
  const body = content.slice(block.bodyStart, block.end - 1);
  const newBody = patchBody(body, property, value);
  const newContent =
    content.slice(0, block.bodyStart) +
    newBody +
    content.slice(block.end - 1);
  return { content: newContent, found: true };
}

// ── Undo stack ────────────────────────────────────────────────────────────────

const undoStack = [];
const MAX_UNDO = 50;

function pushUndo(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    undoStack.push({ filePath, content });
    if (undoStack.length > MAX_UNDO) undoStack.shift();
  } catch { /* file may not exist yet */ }
}

// ── Proxy engine ──────────────────────────────────────────────────────────────

let PROXY_TARGET = null;

function proxyHtml(startUrl, res) {
  function errorPage(msg) {
    return `<!DOCTYPE html><html><body style="font:14px ui-sans-serif,sans-serif;background:#0a0a0a;color:#888;padding:48px;text-align:center;">
      <div style="font-size:32px;margin-bottom:16px;">⟡</div>
      <h2 style="color:#e87;margin-bottom:8px;">Could not load ${startUrl}</h2>
      <p style="margin-bottom:24px;">${msg}</p>
      <p style="font-size:12px;color:#555;">Make sure your dev server is running, then click <strong style="color:#e8b">Load →</strong> again.</p>
    </body></html>`;
  }

  function doFetch(targetUrl, hops) {
    if (hops > 5) return res.status(502).send(errorPage('Too many redirects.'));
    let tParsed;
    try { tParsed = new URL(targetUrl); } catch { return res.status(400).send(errorPage('Bad redirect URL.')); }

    const lib = tParsed.protocol === 'https:' ? https : http;
    const opts = {
      hostname: tParsed.hostname,
      port: tParsed.port || (tParsed.protocol === 'https:' ? 443 : 80),
      path: tParsed.pathname + (tParsed.search || ''),
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Encoding': 'gzip, deflate',
        'User-Agent': 'VisualTweaker/1.0',
        'Connection': 'close',
      },
    };

    const proxyReq = lib.request(opts, proxyRes => {
      if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
        proxyRes.resume();
        const nextUrl = new URL(proxyRes.headers.location, targetUrl).toString();
        return doFetch(nextUrl, hops + 1);
      }

      const enc = proxyRes.headers['content-encoding'] || '';
      let stream = proxyRes;
      if (enc.includes('gzip')) stream = proxyRes.pipe(zlib.createGunzip());
      else if (enc.includes('deflate')) stream = proxyRes.pipe(zlib.createInflate());
      else if (enc.includes('br')) stream = proxyRes.pipe(zlib.createBrotliDecompress());

      const chunks = [];
      stream.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      stream.on('error', e => res.status(502).send(errorPage(e.message)));
      stream.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');

        // Point base href at OUR proxy, not the target.
        // This keeps all asset + fetch() requests same-origin (localhost:PORT)
        // so they route through our asset proxy — avoiding CORS issues with
        // targets like Python http.server that have no CORS headers.
        const base = `<base href="http://localhost:${PORT}/">`;
        const bridge = `<script src="http://localhost:${PORT}/vt-bridge.js?_=${Date.now()}"></script>`;
        const viteShim = `<script>
(function(){
  try{Location.prototype.reload=function(){console.log('[VT] Blocked Vite HMR reload');};}catch(e){}
  document.addEventListener('DOMContentLoaded',function(){
    var mo=new MutationObserver(function(){
      var ov=document.querySelector('vite-error-overlay');
      if(ov){ov.style.cssText='pointer-events:none!important;opacity:0.3!important;';}
    });
    mo.observe(document.documentElement,{childList:true,subtree:true});
  });
})();
</script>`;

        let html = body;
        if (/<head/i.test(html)) html = html.replace(/(<head[^>]*>)/i, `$1${base}${viteShim}`);
        else html = base + viteShim + html;
        html = html.includes('</body>') ? html.replace('</body>', `${bridge}</body>`) : html + bridge;

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        ['content-security-policy', 'x-frame-options', 'x-content-type-options'].forEach(h => res.removeHeader(h));
        res.send(html);
      });
    });

    proxyReq.on('error', e => res.status(502).send(errorPage(e.message)));
    proxyReq.end();
  }

  doFetch(startUrl, 0);
}

// ── Bootstrap Next.js + Express ───────────────────────────────────────────────

const nextApp = next({ dev, port: PORT });
const handle = nextApp.getRequestHandler();

nextApp.prepare().then(() => {
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });

  // ── POST /undo ─────────────────────────────────────────────────────────────
  app.post('/undo', (req, res) => {
    if (!undoStack.length) return res.json({ success: false, error: 'Nothing to undo' });
    const { filePath, content } = undoStack.pop();
    try {
      fs.writeFileSync(filePath, content, 'utf8');
      return res.json({ success: true, file: path.relative(ROOT, filePath), remaining: undoStack.length });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  app.get('/undo-stack', (req, res) => {
    res.json({
      depth: undoStack.length,
      entries: undoStack.slice(-10).reverse().map(e => path.relative(ROOT, e.filePath)),
    });
  });

  // ── POST /apply ────────────────────────────────────────────────────────────
  app.post('/apply', (req, res) => {
    const { selector, property, value } = req.body || {};
    if (!selector || !property || value === undefined) {
      return res.status(400).json({ error: 'selector, property, and value are required' });
    }

    const cssFiles = walkFiles(ROOT, ['.css', '.scss']);

    for (const filePath of cssFiles) {
      let raw;
      try { raw = fs.readFileSync(filePath, 'utf8'); }
      catch { continue; }

      const { content, found } = applyToContent(raw, selector, property, value);
      if (found) {
        pushUndo(filePath);
        fs.writeFileSync(filePath, content, 'utf8');
        return res.json({ success: true, file: path.relative(ROOT, filePath) });
      }
    }

    const overrideDir = path.join(ROOT, 'src', 'styles');
    const overridePath = path.join(overrideDir, 'visual-tweaks.css');
    if (!fs.existsSync(overrideDir)) fs.mkdirSync(overrideDir, { recursive: true });

    const existing = fs.existsSync(overridePath)
      ? fs.readFileSync(overridePath, 'utf8')
      : '/* Visual Tweaks — auto-generated overrides */\n';

    const block = findRuleBlock(existing, selector);
    let updated;
    if (block) {
      const body = existing.slice(block.bodyStart, block.end - 1);
      const newBody = patchBody(body, property, value);
      updated = existing.slice(0, block.bodyStart) + newBody + existing.slice(block.end - 1);
    } else {
      updated = existing + `\n${selector} {\n  ${property}: ${value};\n}\n`;
    }

    pushUndo(overridePath);
    fs.writeFileSync(overridePath, updated, 'utf8');
    return res.json({
      success: true,
      file: 'src/styles/visual-tweaks.css',
      note: 'selector not found in project files; appended to override file',
    });
  });

  // ── GET /scan-tokens ───────────────────────────────────────────────────────
  const TOKEN_CATS = {
    colors:     /^(color|col|clr|bg|background|fore|foreground|surface|fill|text-color|border-color|primary|secondary|accent|neutral|brand|palette|tint|shade|hue|on-)|-(color|bg|background|fill|stroke|tint|shade)$/,
    typography: /^(font|text|heading|body|caption|letter|line-height|type|typo)|-(font|size|weight|family|leading|tracking)$/,
    spacing:    /^(space|spacing|gap|pad|margin|indent)/,
    shadows:    /shadow/,
    radius:     /radius|rounded/,
    motion:     /transition|duration|ease|animation|motion|delay/,
    'z-index':  /^z-|z-index/,
  };

  function categorize(rawName) {
    const n = rawName.toLowerCase().replace(/^--|^\$/, '');
    for (const [cat, rx] of Object.entries(TOKEN_CATS)) {
      if (rx.test(n)) return cat;
    }
    return 'other';
  }

  app.get('/scan-tokens', (req, res) => {
    const cssFiles = walkFiles(ROOT, ['.css', '.scss']);
    const groups = { colors: [], typography: [], spacing: [], shadows: [], radius: [], motion: [], 'z-index': [], other: [] };
    const seen = new Set();

    for (const filePath of cssFiles) {
      let raw;
      try { raw = fs.readFileSync(filePath, 'utf8'); }
      catch { continue; }

      const relPath = path.relative(ROOT, filePath);
      const cssPropRx = /--([a-zA-Z0-9_-]+)\s*:\s*([^;}{]+);/g;
      let m;
      while ((m = cssPropRx.exec(raw)) !== null) {
        const name = '--' + m[1];
        if (seen.has(name)) continue;
        seen.add(name);
        const cat = categorize(name);
        groups[cat].push({ name, value: m[2].trim(), type: 'css', file: relPath });
      }

      const scssPropRx = /\$([a-zA-Z0-9_-]+)\s*:\s*([^;}{!]+)(?:!default)?\s*;/g;
      while ((m = scssPropRx.exec(raw)) !== null) {
        const name = '$' + m[1];
        if (seen.has(name)) continue;
        seen.add(name);
        const cat = categorize(name);
        groups[cat].push({ name, value: m[2].trim(), type: 'scss', file: relPath });
      }
    }

    res.json(groups);
  });

  // ── POST /save-tokens ──────────────────────────────────────────────────────
  app.post('/save-tokens', (req, res) => {
    const { tokens } = req.body || {};
    if (!Array.isArray(tokens)) return res.status(400).json({ error: 'tokens array required' });

    const stylesDir = path.join(ROOT, 'src', 'styles');
    if (!fs.existsSync(stylesDir)) fs.mkdirSync(stylesDir, { recursive: true });

    const cssTokens = tokens.filter(t => t.type === 'css');
    const scssTokens = tokens.filter(t => t.type === 'scss');

    const cssOut = path.join(stylesDir, 'design-tokens.css');
    let cssContent = '/* Design Tokens — generated by Visual Tweaker */\n/* Edit via the Design System panel, not manually */\n\n';
    if (cssTokens.length > 0) {
      cssContent += ':root {\n';
      for (const t of cssTokens) cssContent += `  ${t.name}: ${t.value};\n`;
      cssContent += '}\n';
    }
    pushUndo(cssOut);
    fs.writeFileSync(cssOut, cssContent, 'utf8');

    const files = ['src/styles/design-tokens.css'];
    if (scssTokens.length > 0) {
      const scssOut = path.join(stylesDir, 'design-tokens.scss');
      let scssContent = '// Design Tokens (SCSS) — generated by Visual Tweaker\n\n';
      for (const t of scssTokens) scssContent += `${t.name}: ${t.value};\n`;
      fs.writeFileSync(scssOut, scssContent, 'utf8');
      files.push('src/styles/design-tokens.scss');
    }

    res.json({ success: true, files });
  });

  // ── POST /apply-rule ───────────────────────────────────────────────────────
  app.post('/apply-rule', (req, res) => {
    const { file, selector, declarations } = req.body || {};
    if (!selector || declarations === undefined) {
      return res.status(400).json({ error: 'selector and declarations are required' });
    }

    const targets = file ? [path.join(ROOT, file)] : walkFiles(ROOT, ['.css', '.scss']);

    for (const filePath of targets) {
      let raw;
      try { raw = fs.readFileSync(filePath, 'utf8'); }
      catch { continue; }

      const block = findRuleBlock(raw, selector);
      if (block) {
        const cleanDecls = declarations.trim()
          .split('\n')
          .map(l => '  ' + l.trim())
          .filter(l => l.trim())
          .join('\n');
        const newContent =
          raw.slice(0, block.bodyStart) +
          '\n' + cleanDecls + '\n' +
          raw.slice(block.end - 1);
        pushUndo(filePath);
        fs.writeFileSync(filePath, newContent, 'utf8');
        return res.json({ success: true, file: path.relative(ROOT, filePath) });
      }
    }

    const dest = file
      ? path.join(ROOT, file)
      : path.join(ROOT, 'src', 'styles', 'visual-tweaks.css');

    const dir = path.dirname(dest);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const existing = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : '';
    const cleanDecls = declarations.trim()
      .split('\n').map(l => '  ' + l.trim()).filter(l => l.trim()).join('\n');
    const appended = existing + `\n${selector} {\n${cleanDecls}\n}\n`;
    pushUndo(dest);
    fs.writeFileSync(dest, appended, 'utf8');
    return res.json({ success: true, file: path.relative(ROOT, dest), note: 'appended new rule' });
  });

  // ── GET /components ────────────────────────────────────────────────────────
  app.get('/components', (req, res) => {
    const componentFiles = walkFiles(ROOT, ['.tsx', '.jsx']);
    const cssFiles = walkFiles(ROOT, ['.css', '.scss']);

    const styleByBase = new Map();
    for (const f of cssFiles) {
      const base = path.basename(f, path.extname(f)).toLowerCase();
      const arr = styleByBase.get(base) || [];
      arr.push(f);
      styleByBase.set(base, arr);
    }

    const components = [];

    for (const filePath of componentFiles) {
      let raw;
      try { raw = fs.readFileSync(filePath, 'utf8'); }
      catch { continue; }

      const baseName = path.basename(filePath, path.extname(filePath));
      const relPath = path.relative(ROOT, filePath);

      if (/\.(test|spec|stories)\.[tj]sx?$/.test(filePath)) continue;
      if (/\.d\.ts$/.test(filePath)) continue;
      if (!/<[A-Z][a-zA-Z]*/.test(raw) && !/return\s*\(?\s*</m.test(raw)) continue;

      const importRx = /import\s+['"]([^'"]+\.(css|scss))['"]/g;
      const importedStyles = [];
      let im;
      while ((im = importRx.exec(raw)) !== null) {
        const abs = path.resolve(path.dirname(filePath), im[1]);
        importedStyles.push(path.relative(ROOT, abs));
      }

      const sibling = (styleByBase.get(baseName.toLowerCase()) || [])
        .map(f => path.relative(ROOT, f));

      const styleFiles = [...new Set([...importedStyles, ...sibling])];

      const rules = [];
      for (const sf of styleFiles) {
        const sfAbs = path.join(ROOT, sf);
        let sfRaw;
        try { sfRaw = fs.readFileSync(sfAbs, 'utf8'); }
        catch { continue; }
        const ruleRx = /([.#:[\w][^{@]*?)\{([^{}]+)\}/g;
        let rm;
        while ((rm = ruleRx.exec(sfRaw)) !== null) {
          const selector = rm[1].trim();
          if (!selector || selector.includes('@')) continue;
          rules.push({ selector, declarations: rm[2].trim(), file: sf });
        }
      }

      components.push({ name: baseName, file: relPath, styleFiles, rules });
    }

    components.sort((a, b) => a.name.localeCompare(b.name));
    res.json(components);
  });

  // ── GET /component-classes ─────────────────────────────────────────────────
  app.get('/component-classes', (req, res) => {
    const { file } = req.query;
    if (!file) return res.status(400).json({ error: 'file param required' });

    const absPath = path.join(ROOT, file);
    let raw;
    try { raw = fs.readFileSync(absPath, 'utf8'); }
    catch { return res.status(404).json({ error: 'file not found' }); }

    const results = [];
    const tagRx = /<([A-Za-z][A-Za-z0-9.]*)[^>]*?className(?:=\{cn\(|=\{`|=")([^"}`>]{1,400})/g;
    let m;
    while ((m = tagRx.exec(raw)) !== null) {
      const tag = m[1];
      const raw_cls = m[2]
        .replace(/[`"]/g, '')
        .replace(/,.*$/s, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!raw_cls) continue;
      const classes = raw_cls.split(' ').filter(c => c && !/^[${]/.test(c));
      if (classes.length === 0) continue;
      results.push({ tag, classes, raw: raw_cls });
    }

    const subNames = [];
    const subRx = /const\s+([A-Z][A-Za-z0-9]+)\s*=/g;
    while ((m = subRx.exec(raw)) !== null) subNames.push(m[1]);

    res.json({ file, subComponents: subNames, classUsages: results });
  });

  // ── GET /design-context ────────────────────────────────────────────────────
  app.get('/design-context', (req, res) => {
    const ctx = {
      libraries: [],
      shadcn: null,
      tailwind: null,
      tokens: {},
      components: [],
      docs: [],
    };

    const pkgPath = path.join(ROOT, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        const KNOWN = [
          ['class-variance-authority', 'CVA (shadcn/ui pattern)'],
          ['tailwind-variants', 'Tailwind Variants / tv() (NextUI pattern)'],
          ['tailwindcss', 'Tailwind CSS'],
          ['@radix-ui/react-dialog', 'Radix UI primitives'],
          ['@nextui-org/react', 'NextUI'],
          ['@nextui-org/button', 'NextUI'],
          ['@chakra-ui/react', 'Chakra UI'],
          ['@mui/material', 'Material UI (MUI)'],
          ['@mui/joy', 'MUI Joy UI'],
          ['antd', 'Ant Design'],
          ['@mantine/core', 'Mantine'],
          ['@headlessui/react', 'Headless UI'],
          ['@ark-ui/react', 'Ark UI'],
          ['styled-components', 'Styled Components'],
          ['@emotion/react', 'Emotion CSS'],
          ['framer-motion', 'Framer Motion'],
          ['lucide-react', 'Lucide Icons'],
          ['@heroicons/react', 'Heroicons'],
          ['react', `React ${deps['react'] || ''}`],
        ];
        for (const [k, label] of KNOWN) {
          if (deps[k]) ctx.libraries.push(label);
        }
        if (deps['class-variance-authority'] && deps['@radix-ui/react-dialog']) {
          if (!ctx.libraries.includes('shadcn/ui')) ctx.libraries.unshift('shadcn/ui');
        }
      } catch {}
    }

    const cjPath = path.join(ROOT, 'components.json');
    if (fs.existsSync(cjPath)) {
      try { ctx.shadcn = JSON.parse(fs.readFileSync(cjPath, 'utf8')); } catch {}
    }

    const twNames = ['tailwind.config.ts', 'tailwind.config.js', 'tailwind.config.cjs', 'tailwind.config.mjs'];
    for (const tn of twNames) {
      const tp = path.join(ROOT, tn);
      if (!fs.existsSync(tp)) continue;
      try {
        const raw = fs.readFileSync(tp, 'utf8');
        const colors = {};
        const colorBlock = raw.match(/colors\s*:\s*\{([\s\S]*?)\}(?:\s*[,}])/);
        if (colorBlock) {
          const pairRx = /(\w[\w-]*)\s*:\s*['"`]([^'"`]+)['"`]/g;
          let m;
          while ((m = pairRx.exec(colorBlock[1])) !== null) colors[m[1]] = m[2];
        }
        const extBlock = raw.match(/extend\s*:\s*\{[\s\S]*?colors\s*:\s*\{([\s\S]*?)\}/);
        if (extBlock) {
          const pairRx = /(\w[\w-]*)\s*:\s*['"`]([^'"`]+)['"`]/g;
          let m;
          while ((m = pairRx.exec(extBlock[1])) !== null) colors[m[1]] = m[2];
        }
        ctx.tailwind = { file: tn, colors, raw: raw.slice(0, 2400) };
      } catch {}
      break;
    }

    const SKIP_TOKEN = /node_modules|\.config\.|package|tsconfig|jest|vite|eslint|prettier|babel|rollup|webpack/;
    const TOKEN_MATCH = /token|theme|design.system|palette|colors?\b|typography|spacing|variables/i;

    const tokenFiles = [
      ...walkFiles(ROOT, ['.json']),
      ...walkFiles(ROOT, ['.ts', '.js']),
    ].filter(f => {
      const rel = path.relative(ROOT, f);
      const b = path.basename(f).toLowerCase();
      return TOKEN_MATCH.test(b) && !SKIP_TOKEN.test(rel);
    }).slice(0, 12);

    for (const tf of tokenFiles) {
      try {
        const raw = fs.readFileSync(tf, 'utf8');
        const rel = path.relative(ROOT, tf);
        if (tf.endsWith('.json')) {
          try { ctx.tokens[rel] = { type: 'json', data: JSON.parse(raw) }; } catch {}
        } else {
          ctx.tokens[rel] = { type: 'js', raw: raw.slice(0, 1600) };
        }
      } catch {}
    }

    const compFiles = walkFiles(ROOT, ['.tsx', '.ts', '.jsx', '.js']).filter(f => {
      const rel = path.relative(ROOT, f);
      return !rel.includes('node_modules') && !rel.includes('.stories.');
    }).slice(0, 80);

    const seenComp = new Set();
    for (const cf of compFiles) {
      let raw;
      try { raw = fs.readFileSync(cf, 'utf8'); } catch { continue; }
      const rel = path.relative(ROOT, cf);
      const compName = path.basename(cf, path.extname(cf));

      const cvaFullRx = /(?:cva|tv)\s*\([\s\S]*?variants\s*:\s*\{([\s\S]*?)\}\s*(?:,\s*(?:defaultVariants|compoundVariants|slots)|\})/g;
      let cm;
      while ((cm = cvaFullRx.exec(raw)) !== null) {
        const variantKeys = [];
        const keyRx = /(\w+)\s*:\s*\{([^}]+)\}/g;
        let km;
        while ((km = keyRx.exec(cm[1])) !== null) {
          const opts = [...km[2].matchAll(/(\w+)\s*:/g)].map(x => x[1]);
          variantKeys.push({ name: km[1], options: opts });
        }
        if (variantKeys.length) {
          const key = rel + ':cva';
          if (!seenComp.has(key)) {
            seenComp.add(key);
            const system = raw.includes('tailwind-variants') ? 'tv' : 'cva';
            ctx.components.push({ file: rel, name: compName, type: 'cva', system, variants: variantKeys });
          }
        }
      }

      const slotsRx = /slots\s*:\s*\{([^}]+)\}/g;
      let slm;
      while ((slm = slotsRx.exec(raw)) !== null) {
        const slots = [...slm[1].matchAll(/(\w+)\s*:/g)].map(x => x[1]);
        if (slots.length) {
          const key = rel + ':slots';
          if (!seenComp.has(key)) {
            seenComp.add(key);
            ctx.components.push({ file: rel, name: compName, type: 'slots', slots });
          }
        }
      }

      const ifaceRx = /(?:interface|type)\s+\w*[Pp]rops\w*\s*(?:extends[^{]*)?\s*=?\s*\{([^}]+)\}/g;
      let im;
      while ((im = ifaceRx.exec(raw)) !== null) {
        const body = im[1];
        if (/variant|size|color|theme|intent|kind/.test(body)) {
          const key = rel + ':props';
          if (!seenComp.has(key)) {
            seenComp.add(key);
            ctx.components.push({ file: rel, name: compName, type: 'props', propsInterface: body.slice(0, 600).trim() });
          }
        }
      }
    }

    const storyFiles = walkFiles(ROOT, ['.tsx', '.ts', '.jsx', '.js']).filter(f =>
      f.includes('.stories.') && !f.includes('node_modules')
    ).slice(0, 20);

    for (const sf of storyFiles) {
      try {
        const raw = fs.readFileSync(sf, 'utf8');
        const compName = path.basename(sf).replace(/\.stories\.[tj]sx?$/, '');
        const rel = path.relative(ROOT, sf);
        const stories = [...raw.matchAll(/export\s+const\s+([A-Z]\w+)\s*:/g)]
          .map(m => m[1]).filter(n => n !== 'default');
        if (stories.length) {
          ctx.components.push({ file: rel, name: compName, type: 'stories', stories });
        }
      } catch {}
    }

    const DOC_MATCH = /design|style|component|token|brand|color|typography|spacing|contributing|readme/i;
    const mdFiles = walkFiles(ROOT, ['.md', '.mdx']).filter(f =>
      DOC_MATCH.test(path.basename(f)) && !f.includes('node_modules')
    ).slice(0, 6);

    for (const mf of mdFiles) {
      try {
        ctx.docs.push({
          file: path.relative(ROOT, mf),
          excerpt: fs.readFileSync(mf, 'utf8').slice(0, 1200),
        });
      } catch {}
    }

    res.json(ctx);
  });

  // ── GET /vt-bridge.js ──────────────────────────────────────────────────────
  app.get('/vt-bridge.js', (req, res) => {
    const bridgePath = path.join(__dirname, '..', '..', 'visual-tweak-bridge.js');
    const fallback = path.join(__dirname, 'public', 'vt-bridge.js');
    const tryPaths = [bridgePath, fallback];
    for (const p of tryPaths) {
      if (fs.existsSync(p)) {
        res.setHeader('Content-Type', 'application/javascript');
        res.setHeader('Cache-Control', 'no-cache');
        return res.sendFile(p);
      }
    }
    res.setHeader('Content-Type', 'application/javascript');
    res.send('// vt-bridge.js not found');
  });

  // ── GET /visual-tweak.js ───────────────────────────────────────────────────
  app.get('/visual-tweak.js', (req, res) => {
    const clientPath = path.join(__dirname, '..', '..', 'visual-tweak-client.js');
    if (!fs.existsSync(clientPath)) {
      return res.status(404).type('js').send('// visual-tweak-client.js not found');
    }
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(clientPath);
  });

  // ── GET /file-tree ─────────────────────────────────────────────────────────
  app.get('/file-tree', (req, res) => {
    function buildTree(dir, depth = 0) {
      if (depth > 4) return [];
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch { return []; }

      const result = [];
      for (const e of entries) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        const full = path.join(dir, e.name);
        const rel = path.relative(ROOT, full);
        if (e.isDirectory()) {
          const children = buildTree(full, depth + 1);
          if (children.length) result.push({ name: e.name, path: rel, type: 'dir', children });
        } else if (/\.(tsx|jsx|ts|js|css|scss|json)$/.test(e.name)) {
          result.push({ name: e.name, path: rel, type: 'file' });
        }
      }
      return result;
    }

    res.json(buildTree(ROOT));
  });

  // ── POST /set-proxy ────────────────────────────────────────────────────────
  app.post('/set-proxy', (req, res) => {
    const url = (req.body?.url || '').trim().replace(/\/$/, '');
    if (!url) return res.status(400).json({ error: 'url required' });
    try { new URL(url); } catch { return res.status(400).json({ error: 'invalid url' }); }
    PROXY_TARGET = url;
    res.json({ ok: true, target: PROXY_TARGET });
  });

  // ── GET /version ──────────────────────────────────────────────────────────
  app.get('/version', (req, res) => {
    res.json({
      current: CURRENT_VERSION,
      latest: latestVersion,
      behind: latestVersion ? semverGt(latestVersion, CURRENT_VERSION) : false,
      repo: REPO_URL || null,
    });
  });

  // ── POST /update ──────────────────────────────────────────────────────────
  app.post('/update', (req, res) => {
    try {
      execSync('git pull', { cwd: ROOT, stdio: 'pipe' });
      execSync('npm install', { cwd: ROOT, stdio: 'pipe' });
      res.json({ ok: true });
      // Restart: spawn a new process then exit
      setTimeout(() => {
        const { spawn } = require('child_process');
        const child = spawn(process.argv[0], process.argv.slice(1), {
          detached: true, stdio: 'inherit', cwd: ROOT,
        });
        child.unref();
        process.exit(0);
      }, 400);
    } catch (e) {
      res.status(500).json({ error: e.stderr?.toString() || e.message });
    }
  });

  // ── GET /proxy (legacy) ────────────────────────────────────────────────────
  app.get('/proxy', (req, res) => {
    const appUrl = (req.query.url || 'http://localhost:5173').trim();
    try { new URL(appUrl); } catch (e) { return res.status(400).send('Invalid URL: ' + e.message); }
    proxyHtml(appUrl, res);
  });

  // ── Root catchall — proxy OR bookmarklet page ──────────────────────────────
  // Must come before Next.js handler but after all explicit routes.
  const API_PREFIX = /^\/(editor|proxy|version|update|file-tree|design-context|components|component-classes|apply|scan-tokens|set-proxy|undo|vt-bridge\.js|visual-tweak|_next|favicon)/;

  // General-purpose asset proxy — pipes non-HTML resources (JSON, JS, CSS, fonts…)
  // straight through from the target without modification.
  function proxyAsset(targetUrl, req, res) {
    let tParsed;
    try { tParsed = new URL(targetUrl); } catch { return res.status(400).end('Bad URL'); }
    const lib = tParsed.protocol === 'https:' ? https : http;
    const opts = {
      hostname: tParsed.hostname,
      port: tParsed.port || (tParsed.protocol === 'https:' ? 443 : 80),
      path: tParsed.pathname + (tParsed.search || ''),
      method: req.method,
      headers: {
        'Accept': req.headers['accept'] || '*/*',
        'Accept-Encoding': 'identity', // avoid compressed streams we'd need to decompress
        'User-Agent': 'OpenTweaker/1.0',
        'Connection': 'close',
      },
    };
    const proxyReq = lib.request(opts, proxyRes => {
      // Remove CORS/frame-blocking headers
      const safeHeaders = {};
      for (const [k, v] of Object.entries(proxyRes.headers)) {
        if (['access-control-allow-origin','content-security-policy','x-frame-options'].includes(k)) continue;
        safeHeaders[k] = v;
      }
      safeHeaders['access-control-allow-origin'] = '*';
      res.writeHead(proxyRes.statusCode, safeHeaders);
      proxyRes.pipe(res, { end: true });
    });
    proxyReq.on('error', () => res.status(502).end('Proxy error'));
    proxyReq.end();
  }

  app.use((req, res, next) => {
    // Let Next.js handle /editor and internal Next routes
    if (API_PREFIX.test(req.path)) return next();

    // Root / with no proxy target → Next.js handles it (home page)
    if (req.path === '/' && !PROXY_TARGET) return next();

    if (PROXY_TARGET && req.method === 'GET') {
      const accept = req.headers['accept'] || '';
      const targetUrl = `${PROXY_TARGET}${req.path === '/' ? '/' : req.path}${req.search || ''}`;

      // HTML navigation requests → inject bridge + base tag
      if (accept.includes('text/html') || req.path === '/') {
        return proxyHtml(targetUrl, res);
      }

      // Everything else (JS fetch, JSON, CSS, fonts, images…) → pipe as-is
      return proxyAsset(targetUrl, req, res);
    }

    next();
  });

  // ── Hand off everything else to Next.js ───────────────────────────────────
  app.all(/(.*)/, (req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  app.listen(PORT, '127.0.0.1', () => {
    console.log('\n  ⟡ OpenTweaker  v' + CURRENT_VERSION);
    console.log(`  Editor  →  http://localhost:${PORT}/editor`);
    console.log(`  HTTP    →  http://localhost:${PORT}`);
    console.log(`  WS      →  ws://localhost:${WS_PORT}`);
    console.log(`  Root    →  ${ROOT}\n`);
    // Check for updates in the background (non-blocking)
    fetchLatestVersion();
  });

  // ── WebSocket ──────────────────────────────────────────────────────────────
  const wss = new WebSocketServer({ port: WS_PORT });
  const clients = new Set();

  wss.on('connection', ws => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  function broadcast(data) {
    const msg = JSON.stringify(data);
    for (const c of clients) {
      if (c.readyState === 1) c.send(msg);
    }
  }

  // ── File watcher ───────────────────────────────────────────────────────────
  chokidar
    .watch(['**/*.css', '**/*.scss'], {
      cwd: ROOT,
      ignored: [/node_modules/, /\.git/, /dist\//, /build\//, /\.next\//],
      persistent: true,
      ignoreInitial: true,
    })
    .on('change', rel => broadcast({ type: 'change', file: rel }))
    .on('add', rel => broadcast({ type: 'add', file: rel }));
});
