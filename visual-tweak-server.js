#!/usr/bin/env node
/*
 * ================================================================
 * VISUAL TWEAK SERVER — WYSIWYG CSS editor for React + CSS/SCSS
 * ================================================================
 *
 * SETUP (one-time)
 * ----------------
 *   npm install --save-dev express chokidar ws
 *
 * START (run from your project root every dev session)
 * ----------------
 *   node /path/to/visual-tweak-server.js
 *
 * INJECT THE CLIENT (choose one method)
 * ----------------
 *   Option A — index.html (Vite / CRA / any HTML entry):
 *     Add just before </body>:
 *       <script src="http://localhost:4242/visual-tweak.js"></script>
 *
 *   Option B — React entry point (src/main.jsx or src/index.jsx):
 *     if (process.env.NODE_ENV === 'development') {
 *       const s = document.createElement('script');
 *       s.src = 'http://localhost:4242/visual-tweak.js';
 *       document.head.appendChild(s);
 *     }
 *
 *   Option C — Vite config proxy (vite.config.js):
 *     server: { proxy: { '/visual-tweak.js': 'http://localhost:4242' } }
 *     Then add <script src="/visual-tweak.js"></script> to index.html
 *
 * PORTS
 * ----------------
 *   HTTP  → http://localhost:4242
 *   WS    → ws://localhost:4243  (file-change broadcasts → auto-refresh)
 *
 * ================================================================
 */

'use strict';

const express   = require('express');
const fs        = require('fs');
const path      = require('path');
const http      = require('http');
const https     = require('https');
const zlib      = require('zlib');
const chokidar  = require('chokidar');
const { WebSocketServer } = require('ws');

const PORT       = 4242;
const WS_PORT    = 4243;
const ROOT       = process.cwd();
const SKIP_DIRS  = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', '.cache']);

// ── Express setup ────────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: '4mb' }));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── File utilities ───────────────────────────────────────────────────────────

/** Recursively collect files with given extensions, skipping ignored dirs. */
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

// ── CSS rule-block parser (brace-counting, handles nested SCSS) ───────────────

/**
 * Find the first occurrence of `selector { ... }` in content,
 * returning { start, bodyStart, end } indices.  Handles nested braces.
 */
function findRuleBlock(content, selector) {
  const selectorRx = new RegExp(escapeRx(selector) + '\\s*\\{', 'g');
  let m;
  while ((m = selectorRx.exec(content)) !== null) {
    const openIdx  = m.index + m[0].length - 1; // index of '{'
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
      return { start: m.index, bodyStart, end: i /* exclusive, points after '}' */ };
    }
  }
  return null;
}

/**
 * Given a CSS rule body string and a property name, return the body with
 * that property updated (or appended if not present).
 */
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
  // Append before closing brace
  const trimmed = body.replace(/[ \t]+$/, '');
  const nl = trimmed.endsWith('\n') ? '' : '\n';
  return trimmed + nl + `  ${property}: ${value};\n`;
}

/**
 * Apply a CSS property change to file content.
 * Returns { content, found }.
 */
function applyToContent(content, selector, property, value) {
  const block = findRuleBlock(content, selector);
  if (!block) return { content, found: false };

  const body    = content.slice(block.bodyStart, block.end - 1);
  const newBody = patchBody(body, property, value);
  const newContent =
    content.slice(0, block.bodyStart) +
    newBody +
    content.slice(block.end - 1);
  return { content: newContent, found: true };
}

// ── Undo stack ───────────────────────────────────────────────────────────────

const undoStack = []; // [ { filePath, content } ]
const MAX_UNDO  = 50;

/** Save current file content to undo stack before overwriting. */
function pushUndo(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    undoStack.push({ filePath, content });
    if (undoStack.length > MAX_UNDO) undoStack.shift();
  } catch { /* file may not exist yet */ }
}

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

// ── POST /apply ──────────────────────────────────────────────────────────────

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
      return res.json({
        success: true,
        file: path.relative(ROOT, filePath),
      });
    }
  }

  // Selector not found in any file — append to an override file
  const overrideDir  = path.join(ROOT, 'src', 'styles');
  const overridePath = path.join(overrideDir, 'visual-tweaks.css');
  if (!fs.existsSync(overrideDir)) fs.mkdirSync(overrideDir, { recursive: true });

  const existing = fs.existsSync(overridePath)
    ? fs.readFileSync(overridePath, 'utf8')
    : '/* Visual Tweaks — auto-generated overrides */\n';

  const block = findRuleBlock(existing, selector);
  let updated;
  if (block) {
    const body    = existing.slice(block.bodyStart, block.end - 1);
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

// ── GET /scan-tokens ─────────────────────────────────────────────────────────

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
  const groups   = { colors: [], typography: [], spacing: [], shadows: [], radius: [], motion: [], 'z-index': [], other: [] };
  const seen     = new Set();

  for (const filePath of cssFiles) {
    let raw;
    try { raw = fs.readFileSync(filePath, 'utf8'); }
    catch { continue; }

    const relPath = path.relative(ROOT, filePath);

    // CSS custom properties:  --token-name: value;
    const cssPropRx = /--([a-zA-Z0-9_-]+)\s*:\s*([^;}{]+);/g;
    let m;
    while ((m = cssPropRx.exec(raw)) !== null) {
      const name = '--' + m[1];
      if (seen.has(name)) continue;
      seen.add(name);
      const cat = categorize(name);
      groups[cat].push({ name, value: m[2].trim(), type: 'css', file: relPath });
    }

    // SCSS variables:  $token-name: value;
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

// ── POST /save-tokens ────────────────────────────────────────────────────────

app.post('/save-tokens', (req, res) => {
  const { tokens } = req.body || {};
  if (!Array.isArray(tokens)) {
    return res.status(400).json({ error: 'tokens array required' });
  }

  const stylesDir = path.join(ROOT, 'src', 'styles');
  if (!fs.existsSync(stylesDir)) fs.mkdirSync(stylesDir, { recursive: true });

  const cssTokens  = tokens.filter(t => t.type === 'css');
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

// ── POST /apply-rule ─────────────────────────────────────────────────────────
// Direct rule editor: replace (or create) an entire rule block's declarations.
// Body: { file, selector, declarations }
//   file         — relative path from project root  (optional; searches all if omitted)
//   selector     — CSS selector string
//   declarations — full declarations text, e.g. "color: red;\n  font-size: 14px;"

app.post('/apply-rule', (req, res) => {
  const { file, selector, declarations } = req.body || {};
  if (!selector || declarations === undefined) {
    return res.status(400).json({ error: 'selector and declarations are required' });
  }

  const targets = file
    ? [path.join(ROOT, file)]
    : walkFiles(ROOT, ['.css', '.scss']);

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

  // Selector not found — append to first target file or override file
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

// ── GET /components ──────────────────────────────────────────────────────────

app.get('/components', (req, res) => {
  const componentFiles = walkFiles(ROOT, ['.tsx', '.jsx']);
  const cssFiles       = walkFiles(ROOT, ['.css', '.scss']);

  // Build name→paths map for quick lookup
  const styleByBase = new Map();
  for (const f of cssFiles) {
    const base = path.basename(f, path.extname(f)).toLowerCase();
    const arr  = styleByBase.get(base) || [];
    arr.push(f);
    styleByBase.set(base, arr);
  }

  const components = [];

  for (const filePath of componentFiles) {
    let raw;
    try { raw = fs.readFileSync(filePath, 'utf8'); }
    catch { continue; }

    const baseName = path.basename(filePath, path.extname(filePath));
    const relPath  = path.relative(ROOT, filePath);

    // Skip test/story files and obvious non-components
    if (/\.(test|spec|stories)\.[tj]sx?$/.test(filePath)) continue;
    if (/\.d\.ts$/.test(filePath)) continue;
    // Must look like a React component: has JSX
    if (!/<[A-Z][a-zA-Z]*/.test(raw) && !/return\s*\(?\s*</m.test(raw)) continue;

    // Find CSS/SCSS imports
    const importRx = /import\s+['"]([^'"]+\.(css|scss))['"]/g;
    const importedStyles = [];
    let im;
    while ((im = importRx.exec(raw)) !== null) {
      const abs = path.resolve(path.dirname(filePath), im[1]);
      importedStyles.push(path.relative(ROOT, abs));
    }

    // Sibling style files with matching name
    const sibling = (styleByBase.get(baseName.toLowerCase()) || [])
      .map(f => path.relative(ROOT, f));

    const styleFiles = [...new Set([...importedStyles, ...sibling])];

    // Extract flat CSS rules from associated style files
    const rules = [];
    for (const sf of styleFiles) {
      const sfAbs = path.join(ROOT, sf);
      let sfRaw;
      try { sfRaw = fs.readFileSync(sfAbs, 'utf8'); }
      catch { continue; }
      // Match simple selector blocks (no @-rules, no deeply nested)
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

  // Sort alphabetically
  components.sort((a, b) => a.name.localeCompare(b.name));

  res.json(components);
});

// ── GET /component-classes ───────────────────────────────────────────────────
// Extract className values from a TSX/JSX file.
// Returns an array of { element, subComponent, classes } objects.

app.get('/component-classes', (req, res) => {
  const { file } = req.query;
  if (!file) return res.status(400).json({ error: 'file param required' });

  const absPath = path.join(ROOT, file);
  let raw;
  try { raw = fs.readFileSync(absPath, 'utf8'); }
  catch { return res.status(404).json({ error: 'file not found' }); }

  const results = [];

  // Match:  <TagName ... className="..." or className={cn("...", ...)}
  // We capture:  tag name  +  the className string content
  const tagRx = /<([A-Za-z][A-Za-z0-9.]*)[^>]*?className(?:=\{cn\(|=\{`|=")([^"}`>]{1,400})/g;
  let m;
  while ((m = tagRx.exec(raw)) !== null) {
    const tag = m[1];
    const raw_cls = m[2]
      .replace(/[`"]/g, '')          // strip quotes/backticks
      .replace(/,.*$/s, '')          // drop cn() extra args
      .replace(/\s+/g, ' ')
      .trim();
    if (!raw_cls) continue;
    // Split into individual class tokens (skip interpolations)
    const classes = raw_cls
      .split(' ')
      .filter(c => c && !/^[${]/.test(c));
    if (classes.length === 0) continue;
    results.push({ tag, classes, raw: raw_cls });
  }

  // Also extract const/function sub-component names in scope
  const subNames = [];
  const subRx = /const\s+([A-Z][A-Za-z0-9]+)\s*=/g;
  while ((m = subRx.exec(raw)) !== null) subNames.push(m[1]);

  res.json({ file, subComponents: subNames, classUsages: results });
});

// ── GET /design-context ──────────────────────────────────────────────────────
// Scans the entire project for design system documentation across all file
// types and languages: package.json, Tailwind config, shadcn components.json,
// JS/TS theme files, token JSON, Storybook stories, cva() variants,
// TypeScript Props interfaces, and design-related markdown docs.

app.get('/design-context', (req, res) => {
  const ctx = {
    libraries:  [],   // detected UI/styling libraries
    shadcn:     null, // components.json
    tailwind:   null, // tailwind config excerpt
    tokens:     {},   // token files keyed by relative path
    components: [],   // cva variants + TS props + storybook stories
    docs:       [],   // design doc excerpts
  };

  // ── 1. package.json — library detection ────────────────────────────────────
  const pkgPath = path.join(ROOT, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg  = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      const KNOWN = [
        ['class-variance-authority', 'CVA (shadcn/ui pattern)'],
        ['tailwind-variants',        'Tailwind Variants / tv() (NextUI pattern)'],
        ['tailwindcss',              'Tailwind CSS'],
        ['@radix-ui/react-dialog',   'Radix UI primitives'],
        ['@nextui-org/react',        'NextUI'],
        ['@nextui-org/button',       'NextUI'],
        ['@chakra-ui/react',         'Chakra UI'],
        ['@mui/material',            'Material UI (MUI)'],
        ['@mui/joy',                 'MUI Joy UI'],
        ['antd',                     'Ant Design'],
        ['@mantine/core',            'Mantine'],
        ['@headlessui/react',        'Headless UI'],
        ['@ark-ui/react',            'Ark UI'],
        ['styled-components',        'Styled Components'],
        ['@emotion/react',           'Emotion CSS'],
        ['framer-motion',            'Framer Motion'],
        ['lucide-react',             'Lucide Icons'],
        ['@heroicons/react',         'Heroicons'],
        ['react',                    `React ${deps['react'] || ''}`],
      ];
      for (const [k, label] of KNOWN) {
        if (deps[k]) ctx.libraries.push(label);
      }
      // Detect shadcn heuristically: radix + cva together
      if (deps['class-variance-authority'] && deps['@radix-ui/react-dialog']) {
        if (!ctx.libraries.includes('shadcn/ui')) ctx.libraries.unshift('shadcn/ui');
      }
    } catch {}
  }

  // ── 2. shadcn components.json ───────────────────────────────────────────────
  const cjPath = path.join(ROOT, 'components.json');
  if (fs.existsSync(cjPath)) {
    try { ctx.shadcn = JSON.parse(fs.readFileSync(cjPath, 'utf8')); } catch {}
  }

  // ── 3. Tailwind config (regex-based; no eval) ───────────────────────────────
  const twNames = ['tailwind.config.ts','tailwind.config.js','tailwind.config.cjs','tailwind.config.mjs'];
  for (const tn of twNames) {
    const tp = path.join(ROOT, tn);
    if (!fs.existsSync(tp)) continue;
    try {
      const raw    = fs.readFileSync(tp, 'utf8');
      const colors = {};
      // Pull name:value pairs from inside the colors block (best-effort)
      const colorBlock = raw.match(/colors\s*:\s*\{([\s\S]*?)\}(?:\s*[,}])/);
      if (colorBlock) {
        const pairRx = /(\w[\w-]*)\s*:\s*['"`]([^'"`]+)['"`]/g;
        let m;
        while ((m = pairRx.exec(colorBlock[1])) !== null) colors[m[1]] = m[2];
      }
      // Also grab extend.colors
      const extBlock = raw.match(/extend\s*:\s*\{[\s\S]*?colors\s*:\s*\{([\s\S]*?)\}/);
      if (extBlock) {
        const pairRx = /(\w[\w-]*)\s*:\s*['"`]([^'"`]+)['"`]/g;
        let m;
        while ((m = pairRx.exec(extBlock[1])) !== null) colors[m[1]] = m[2];
      }
      ctx.tailwind = { file: tn, colors, raw: raw.slice(0, 2400) };
    } catch {}
    break; // first found wins
  }

  // ── 4. Token / theme files (JSON + JS/TS) ──────────────────────────────────
  const SKIP_TOKEN = /node_modules|\.config\.|package|tsconfig|jest|vite|eslint|prettier|babel|rollup|webpack/;
  const TOKEN_MATCH = /token|theme|design.system|palette|colors?\b|typography|spacing|variables/i;

  const tokenFiles = [
    ...walkFiles(ROOT, ['.json']),
    ...walkFiles(ROOT, ['.ts', '.js']),
  ].filter(f => {
    const rel = path.relative(ROOT, f);
    const b   = path.basename(f).toLowerCase();
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

  // ── 5. Component variant extraction ────────────────────────────────────────
  // Reads .tsx/.ts/.jsx/.js (not stories, not node_modules)
  const compFiles = walkFiles(ROOT, ['.tsx', '.ts', '.jsx', '.js']).filter(f => {
    const rel = path.relative(ROOT, f);
    return !rel.includes('node_modules') && !rel.includes('.stories.');
  }).slice(0, 80);

  const seenComp = new Set();
  for (const cf of compFiles) {
    let raw;
    try { raw = fs.readFileSync(cf, 'utf8'); } catch { continue; }
    const rel      = path.relative(ROOT, cf);
    const compName = path.basename(cf, path.extname(cf));

    // cva() [shadcn] and tv() [NextUI / tailwind-variants] — extract variants block
    // Both share the same { variants: { size: {...}, variant: {...} } } shape
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
          // detect which system is in use
          const system = raw.includes('tailwind-variants') ? 'tv' : 'cva';
          ctx.components.push({ file: rel, name: compName, type: 'cva', system, variants: variantKeys });
        }
      }
    }

    // NextUI slots (tv() can also define "slots" object) — record slot names
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

    // TypeScript Props interface — look for variant/size/intent fields
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

  // ── 6. Storybook stories ───────────────────────────────────────────────────
  const storyFiles = walkFiles(ROOT, ['.tsx', '.ts', '.jsx', '.js']).filter(f =>
    f.includes('.stories.') && !f.includes('node_modules')
  ).slice(0, 20);

  for (const sf of storyFiles) {
    try {
      const raw      = fs.readFileSync(sf, 'utf8');
      const compName = path.basename(sf).replace(/\.stories\.[tj]sx?$/, '');
      const rel      = path.relative(ROOT, sf);
      const stories  = [...raw.matchAll(/export\s+const\s+([A-Z]\w+)\s*:/g)]
        .map(m => m[1]).filter(n => n !== 'default');
      if (stories.length) {
        ctx.components.push({ file: rel, name: compName, type: 'stories', stories });
      }
    } catch {}
  }

  // ── 7. Design-related markdown docs ───────────────────────────────────────
  const DOC_MATCH = /design|style|component|token|brand|color|typography|spacing|contributing|readme/i;
  const mdFiles = walkFiles(ROOT, ['.md', '.mdx']).filter(f =>
    DOC_MATCH.test(path.basename(f)) && !f.includes('node_modules')
  ).slice(0, 6);

  for (const mf of mdFiles) {
    try {
      ctx.docs.push({
        file:    path.relative(ROOT, mf),
        excerpt: fs.readFileSync(mf, 'utf8').slice(0, 1200),
      });
    } catch {}
  }

  res.json(ctx);
});

// ── GET /editor — full Onlook-style editor ───────────────────────────────────

app.get('/editor', (req, res) => {
  const editorPath = path.join(__dirname, 'visual-tweak-editor.html');
  if (!fs.existsSync(editorPath)) {
    return res.status(404).send('visual-tweak-editor.html not found next to server');
  }
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(editorPath);
});

// ── GET /vt-bridge.js — bridge injected into proxied iframe ─────────────────

app.get('/vt-bridge.js', (req, res) => {
  const bridgePath = path.join(__dirname, 'visual-tweak-bridge.js');
  if (!fs.existsSync(bridgePath)) {
    return res.status(404).type('js').send('// visual-tweak-bridge.js not found');
  }
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(bridgePath);
});

// ── Proxy engine (shared by /proxy route and root catchall) ──────────────────

// Current proxy target — set via POST /set-proxy from the editor
let PROXY_TARGET = null;

/**
 * Fetch `startUrl`, follow redirects, decompress, inject bridge + base tag,
 * then send the modified HTML to `res`.
 */
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
      port:     tParsed.port || (tParsed.protocol === 'https:' ? 443 : 80),
      path:     tParsed.pathname + (tParsed.search || ''),
      method:   'GET',
      headers:  {
        'Accept':          'text/html,application/xhtml+xml',
        'Accept-Encoding': 'gzip, deflate',
        'User-Agent':      'VisualTweaker/1.0',
        'Connection':      'close',
      },
    };

    const proxyReq = lib.request(opts, proxyRes => {
      if ([301,302,303,307,308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
        proxyRes.resume();
        const next = new URL(proxyRes.headers.location, targetUrl).toString();
        return doFetch(next, hops + 1);
      }

      const enc = proxyRes.headers['content-encoding'] || '';
      let stream = proxyRes;
      if (enc.includes('gzip'))    stream = proxyRes.pipe(zlib.createGunzip());
      else if (enc.includes('deflate')) stream = proxyRes.pipe(zlib.createInflate());
      else if (enc.includes('br'))  stream = proxyRes.pipe(zlib.createBrotliDecompress());

      const chunks = [];
      stream.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      stream.on('error', e => res.status(502).send(errorPage(e.message)));
      stream.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');

        // <base href> makes relative asset URLs resolve to the app origin
        const base   = `<base href="${tParsed.origin}/">`;
        const bridge = `<script src="http://localhost:${PORT}/vt-bridge.js?_=${Date.now()}"></script>`;
        // Vite HMR sends "full-reload" which calls location.reload() and destroys pick state.
        // Block it — the editor re-proxies on demand. Also suppress the Vite error overlay
        // so it never covers the canvas and blocks element clicks.
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
        ['content-security-policy','x-frame-options','x-content-type-options'].forEach(h => res.removeHeader(h));
        res.send(html);
      });
    });

    proxyReq.on('error', e => res.status(502).send(errorPage(e.message)));
    proxyReq.end();
  }

  doFetch(startUrl, 0);
}

// ── POST /set-proxy — store target URL, then editor loads iframe at "/" ───────
// This makes React Router see pathname "/" instead of "/proxy", so apps that
// use <BrowserRouter> won't hit their catch-all 404 route.

app.post('/set-proxy', express.json(), (req, res) => {
  const url = (req.body?.url || '').trim().replace(/\/$/, '');
  if (!url) return res.status(400).json({ error: 'url required' });
  try { new URL(url); } catch { return res.status(400).json({ error: 'invalid url' }); }
  PROXY_TARGET = url;
  res.json({ ok: true, target: PROXY_TARGET });
});

// ── GET /proxy — legacy query-param proxy (kept for backward compat) ──────────

app.get('/proxy', (req, res) => {
  const appUrl = (req.query.url || 'http://localhost:5173').trim();
  try { new URL(appUrl); } catch (e) { return res.status(400).send('Invalid URL: ' + e.message); }
  proxyHtml(appUrl, res);
});

// ── GET /file-tree — project file tree ───────────────────────────────────────

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
      const rel  = path.relative(ROOT, full);
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

// ── GET / — bookmarklet installer page ──────────────────────────────────────

app.get('/', (req, res, next) => {
  // When an app is loaded in the editor, proxy it here so React Router sees "/"
  if (PROXY_TARGET) return proxyHtml(`${PROXY_TARGET}/`, res);

  // Otherwise show the bookmarklet installer
  // The bookmarklet: tiny loader that pulls the full client from this server.
  // Cache-busted so every click gets the latest version.
  const bookmarklet = `javascript:(function(){if(window.__VT_LOADED__)return;var s=document.createElement('script');s.src='http://localhost:${PORT}/visual-tweak.js?_='+Date.now();s.onerror=function(){alert('Visual Tweaker: server not running.\\nStart it with:\\n  node visual-tweak-server.js')};document.head.appendChild(s);})();`;

  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Visual Tweaker — Bookmarklet Installer</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{
    background:oklch(0.145 0 0); color:oklch(0.985 0 0);
    font:14px/1.6 ui-sans-serif,system-ui,-apple-system,sans-serif;
    min-height:100vh; display:flex; align-items:center; justify-content:center;
    padding:32px 16px;
  }
  .card{
    background:oklch(0.205 0 0); border:1px solid oklch(0.275 0 0);
    border-radius:0.625rem; padding:40px; max-width:540px; width:100%;
    box-shadow:0 8px 48px oklch(0 0 0/.5);
  }
  .logo{
    font-size:22px; font-weight:800; letter-spacing:-.02em;
    color:oklch(0.8868 0.1815 95.265); margin-bottom:6px;
  }
  .sub{ color:oklch(0.556 0 0); font-size:13px; margin-bottom:32px; }
  .step{
    display:flex; gap:14px; align-items:flex-start; margin-bottom:22px;
  }
  .step-num{
    width:26px; height:26px; border-radius:50%; flex-shrink:0;
    background:oklch(0.8868 0.1815 95.265/.15);
    border:1px solid oklch(0.8868 0.1815 95.265/.4);
    color:oklch(0.8868 0.1815 95.265);
    display:flex; align-items:center; justify-content:center;
    font:700 11px/1 inherit;
  }
  .step-body{ flex:1; }
  .step-ttl{ font-weight:600; font-size:13px; margin-bottom:4px; }
  .step-txt{ font-size:12px; color:oklch(0.708 0 0); line-height:1.6; }

  /* ── The bookmarklet drag target ── */
  .bm-wrap{
    background:oklch(0.145 0 0); border:1px solid oklch(0.275 0 0);
    border-radius:0.5rem; padding:16px; margin-top:6px; text-align:center;
  }
  .bm-link{
    display:inline-flex; align-items:center; gap:8px;
    background:oklch(0.8868 0.1815 95.265); color:oklch(0.145 0 0);
    font:700 13px/1 ui-sans-serif,sans-serif;
    padding:11px 20px; border-radius:0.5rem; text-decoration:none;
    cursor:grab; user-select:none;
    box-shadow:0 2px 12px oklch(0.8868 0.1815 95.265/.35);
    transition:background .15s, box-shadow .15s;
  }
  .bm-link:hover{
    background:oklch(0.922 0.12 95);
    box-shadow:0 4px 20px oklch(0.8868 0.1815 95.265/.5);
  }
  .bm-link:active{ cursor:grabbing; }
  .bm-hint{ font-size:11px; color:oklch(0.556 0 0); margin-top:10px; }

  .divider{
    border:none; border-top:1px solid oklch(0.275 0 0);
    margin:28px 0;
  }
  .status{
    display:flex; align-items:center; gap:8px;
    font-size:12px; color:oklch(0.708 0 0);
  }
  .dot{
    width:8px; height:8px; border-radius:50%; flex-shrink:0;
    background:oklch(0.7 0.18 145);
    box-shadow:0 0 6px oklch(0.7 0.18 145/.7);
  }
  code{
    font-family:ui-monospace,monospace; font-size:11px;
    background:oklch(0.269 0 0); color:oklch(0.8868 0.1815 95.265);
    padding:2px 6px; border-radius:4px;
  }
  .note{
    background:oklch(0.8868 0.1815 95.265/.08);
    border:1px solid oklch(0.8868 0.1815 95.265/.25);
    border-radius:0.5rem; padding:12px 14px; margin-top:24px;
    font-size:12px; color:oklch(0.708 0 0); line-height:1.6;
  }
  .note strong{ color:oklch(0.8868 0.1815 95.265); }
</style>
</head>
<body>
<div class="card">
  <div class="logo">⟡ Visual Tweaker</div>
  <div class="sub">Local WYSIWYG CSS editor · Record sessions · Generate Claude Code prompts</div>

  <div class="step">
    <div class="step-num">1</div>
    <div class="step-body">
      <div class="step-ttl">Drag this button to your bookmarks bar</div>
      <div class="bm-wrap">
        <a class="bm-link" href="${bookmarklet.replace(/"/g, '&quot;')}">
          ⟡ Visual Tweaker
        </a>
        <div class="bm-hint">Drag the button above to your bookmarks bar ↑</div>
      </div>
      <div class="step-txt" style="margin-top:8px;">
        If your bookmarks bar isn't visible: <strong>Cmd+Shift+B</strong> (Mac) or <strong>Ctrl+Shift+B</strong> (Windows)
      </div>
    </div>
  </div>

  <div class="step">
    <div class="step-num">2</div>
    <div class="step-body">
      <div class="step-ttl">Open your dev server in the browser</div>
      <div class="step-txt">
        Navigate to your React app — e.g. <code>http://localhost:5173</code>
      </div>
    </div>
  </div>

  <div class="step">
    <div class="step-num">3</div>
    <div class="step-body">
      <div class="step-ttl">Click the bookmark</div>
      <div class="step-txt">
        The <strong>⟡ Visual Tweaker</strong> panel appears instantly on any page.
        Click again to reload with the latest version. Works on any dev server tab.
      </div>
    </div>
  </div>

  <hr class="divider">

  <div class="status">
    <div class="dot"></div>
    Server running on <code>localhost:${PORT}</code> · Root: <code>${ROOT}</code>
  </div>

  <div class="note">
    <strong>No more main.tsx edits needed.</strong> Remove the script injection
    from your entry file if you added it previously — the bookmarklet replaces it.
    The panel only appears when you click the bookmark.
  </div>
</div>
</body>
</html>`);
});

// ── GET /visual-tweak.js — serve client ──────────────────────────────────────

app.get('/visual-tweak.js', (req, res) => {
  const clientPath = path.join(__dirname, 'visual-tweak-client.js');
  if (!fs.existsSync(clientPath)) {
    return res.status(404).type('js').send('// visual-tweak-client.js not found next to visual-tweak-server.js');
  }
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(clientPath);
});

// ── WebSocket broadcast ───────────────────────────────────────────────────────

const wss     = new WebSocketServer({ port: WS_PORT });
const clients = new Set();

wss.on('connection', ws => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const c of clients) {
    if (c.readyState === 1 /* OPEN */) c.send(msg);
  }
}

// ── Chokidar watcher ──────────────────────────────────────────────────────────

chokidar
  .watch(['**/*.css', '**/*.scss'], {
    cwd: ROOT,
    ignored: [/node_modules/, /\.git/, /dist\//, /build\//, /\.next\//],
    persistent: true,
    ignoreInitial: true,
  })
  .on('change', rel => broadcast({ type: 'change', file: rel }))
  .on('add',    rel => broadcast({ type: 'add',    file: rel }));

// ── Root catchall — serves the proxied app at "/" so React Router works ───────
// Must be last. When PROXY_TARGET is set and the browser GETs an HTML page
// (initial load or SPA sub-route reload), proxy it to the target app.
// The iframe is loaded at http://localhost:4242/ so window.location.pathname
// is "/" — BrowserRouter matches the root route natively, no hacks needed.

const API_PREFIX = /^\/(editor|proxy|file-tree|design-context|components|component-classes|apply|scan-tokens|set-proxy|vt-bridge\.js|visual-tweak)/;

app.use((req, res, next) => {
  if (!PROXY_TARGET) return next();
  if (req.method !== 'GET') return next();
  if (API_PREFIX.test(req.path)) return next();
  // Only intercept navigation requests (text/html), not assets
  const accept = req.headers['accept'] || '';
  if (!accept.includes('text/html') && !accept.includes('*/*')) return next();
  // Proxy to target, forwarding the path (handles SPA sub-routes on full reload)
  const targetUrl = `${PROXY_TARGET}${req.path === '/' ? '/' : req.path}`;
  proxyHtml(targetUrl, res);
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Visual Tweak Server`);
  console.log(`  HTTP  →  http://localhost:${PORT}`);
  console.log(`  WS    →  ws://localhost:${WS_PORT}`);
  console.log(`  Root  →  ${ROOT}\n`);
});
