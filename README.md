# OpenTweaker

**A live visual editor for your web app — tweak colors, fonts, spacing, and more without touching code.**

OpenTweaker lets designers and developers point-and-click on any element in their running app and edit its styles in real time. When you're happy with the result, one click writes the changes back to your source files.

---

## What it does

| Without OpenTweaker | With OpenTweaker |
|---|---|
| Edit a CSS value → save → wait for browser to reload → check → repeat | Click the element → drag a slider → see it change instantly |
| Guess at hex color codes | Use a color picker and see the result live |
| Context-switch between code editor and browser constantly | Stay in one place, tweak visually, then export the change |

---

## The two pieces

OpenTweaker has two parts that work together:

### 1. The Editor (web app)
A browser-based panel that opens alongside your app. It has:
- **A live preview** of your running app inside it
- **An inspector panel** on the right with sliders and color pickers for every style property
- **A component tree** on the left to navigate your page structure

You run this once on your computer and it stays open while you work.

### 2. The Chrome Extension *(optional)*
If you prefer to work directly in Chrome without opening the editor app, the extension adds a side panel to Chrome DevTools. Click the paintbrush icon in your toolbar, pick any element on the page, and edit it right there.

---

## Quick start

### What you need first
- [Node.js](https://nodejs.org) installed (v18 or newer — the LTS version is fine)
- [Google Chrome](https://www.google.com/chrome/) (for the extension)
- Your own web app running locally (e.g. `localhost:3000`, `localhost:8000`, etc.)

---

### Step 1 — Install and start the editor

Open your Terminal, navigate to the `apps/tweaker-editor` folder, and run:

```bash
npm install
npm run dev
```

You'll see something like:

```
OpenTweaker server running on http://localhost:4242
Next.js ready on http://localhost:3000
```

Now open **http://localhost:3000/editor** in Chrome.

---

### Step 2 — Load your app into the editor

In the URL bar at the top of the editor, type the address of your running app (for example `http://localhost:8000`) and press Enter. Your app will appear in the center preview window.

---

### Step 3 — Pick an element and edit it

1. Click the **⊕ Pick** button in the top bar
2. Hover over your app — elements will highlight as you move your mouse
3. Click on the element you want to edit
4. The right panel fills in with all the style controls for that element
5. Drag sliders, change colors, pick a font size — the preview updates instantly

---

### Step 4 — Save changes to your source files

When you're happy with how it looks:

1. Make sure the editor server is running (the status indicator in the top bar will be green)
2. Click **Apply to Source**
3. OpenTweaker writes the CSS changes back to your actual project files

> **Note:** The "Apply to Source" button requires the local server to be running (which it is when you use `npm run dev`). If the button is grey, check that the server is still running in your terminal.

---

## Installing the Chrome Extension *(optional)*

1. Open Chrome and go to `chrome://extensions`
2. Turn on **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `apps/extension` folder from this project
5. The OpenTweaker icon will appear in your Chrome toolbar

To use it: open any webpage, click the OpenTweaker icon, then use the **Pick** button in the side panel.

---

## Keeping OpenTweaker up to date

The editor checks for updates automatically. When a new version is available you'll see an **⬆ Update available** badge in the top bar. Click it and OpenTweaker will pull the latest version and restart itself — no manual steps needed.

---

## Folder structure

```
/
├── apps/
│   ├── tweaker-editor/     ← The main editor (Next.js app + local server)
│   │   ├── server.cjs      ← Local server that proxies your app and writes files
│   │   ├── app/            ← The editor UI
│   │   └── package.json
│   │
│   └── extension/          ← The Chrome extension
│       ├── manifest.json
│       ├── panel.html      ← The extension side panel UI
│       ├── panel.js        ← Extension logic
│       ├── content-script.js ← Runs on the inspected page
│       └── background.js   ← Extension service worker
```

---

## FAQ

**Do I need to modify my app to use OpenTweaker?**
No. OpenTweaker works with any web app running locally — React, Vue, plain HTML, anything. You just point it at your `localhost` address.

**Will it break my code?**
OpenTweaker only writes CSS changes. It doesn't touch your JavaScript, HTML structure, or component logic.

**Does it work with Tailwind CSS?**
Live preview works with everything. The "Apply to Source" file-writing for Tailwind class names is coming in a future update — for now it writes plain CSS.

**Can I use it without the local server?**
Yes — the Chrome extension works completely independently. You just won't have the "Apply to Source" feature (you'd copy the values manually).

**My app uses `fetch()` for data and it stopped working inside the editor.**
This is expected — the editor proxies your app through `localhost:4242`. Most apps work fine. If you see data loading errors, make sure your app's API calls use relative URLs (like `fetch('/api/data')`) rather than hardcoded ports.

---

## License

MIT — free to use, modify, and distribute.
