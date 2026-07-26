# Sentiment Latent Space

A fully client-side Chrome extension that analyzes Reddit posts in 3D semantic space. No backend, no data collection, no API keys.

## Key features

- **Runs entirely in your browser** — embeddings, UMAP, clustering, and 3D rendering all happen locally.
- **Continues in the background** — start an analysis, then navigate to another page or tab. You’ll get a notification when it’s ready.
- **Cached results** — reopen a post you already analyzed and click “View 3D analysis” to see the overlay again.
- **Progressive feedback** — a small floating pill shows live progress (model loading, embedding, projection, clustering).
- **Parallel ONNX Runtime** — uses multi-threaded WASM for faster inference.

## How it works

```
Reddit post
    ↓
Content script reads the post + comments via Reddit's public .json endpoint
    ↓
Background service worker owns a hidden Offscreen document
    ↓
Offscreen document runs the ML pipeline:
   - all-MiniLM-L6-v2 embeddings (Transformers.js)
   - UMAP 3D projection
   - DBSCAN clustering
    ↓
Result is stored in chrome.storage.local
    ↓
Overlay opens on the post page (or a notification if you navigated away)
```

## Build

```bash
npm install
npm run build
```

This produces a ready-to-publish `extension/` folder.

## Load locally

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `extension/` folder

## Publish to Chrome Web Store

1. Run `npm run build`
2. Zip the `extension/` folder:
   ```bash
   cd extension && zip -r ../extension.zip .
   ```
3. Upload `extension.zip` to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/)
4. Use the assets in `store/` for the listing and host `PRIVACY.md` as your privacy policy URL.

## Project structure

```
.
├── src/
│   ├── content.js          # Injected button + progress pill + overlay
│   ├── background.js       # Service worker + offscreen document management
│   ├── offscreen.js        # ML pipeline (embed → UMAP → cluster)
│   ├── offscreen.html      # Hidden ML document
│   ├── overlay.js          # Three.js 3D visualization
│   ├── overlay.html        # Overlay page
│   ├── overlay.css         # Overlay styles
│   ├── manifest.json       # Extension manifest
│   └── icons/              # 16/48/128 PNG icons
├── extension/              # Built extension (load this folder)
├── build.js                # Rollup-based build script
├── package.json            # Dependencies
├── generate_icons.py       # Icon generator
├── PRIVACY.md              # Privacy policy
├── store/                  # Store listing assets
└── README.md               # This file
```

## Tech stack

- Transformers.js (`all-MiniLM-L6-v2`) — local embeddings
- umap-js — 3D projection
- density-clustering — DBSCAN clustering
- Three.js — 3D visualization
- Rollup — bundling
- Chrome Offscreen API — background ML processing

## Permissions

- `activeTab` — to confirm the current page is a Reddit post
- `offscreen` — to run the ML pipeline in a background document
- `storage` — to cache completed analyses
- `notifications` — to notify you when a background analysis is ready
- `host_permissions` for `huggingface.co` — to download the embedding model on first run (cached locally)

All processing happens in your browser. No Reddit data, comments, or analytics are sent anywhere.
