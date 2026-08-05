# AGENTS.md

## Cursor Cloud specific instructions

This repo is a single React + Vite + Tailwind SPA (`pill-guide-app`) — a Korean AI
pill-recognition app for low-vision elderly users. There is no backend service in this
repo; the app calls Korea's public data portal (`data.go.kr`) directly from the browser
(or via a Netlify function proxy when deployed).

- **Package manager / node**: npm (see `package-lock.json`). Node 22 works.
- **Run (dev)**: `npm run dev` → serves at `http://localhost:5173/`. Standard Vite dev
  server; edits hot-reload.
- **Build**: `npm run build` (outputs `dist/`). `npm run preview` serves the built app.
- **Lint / tests**: none configured (no lint or test scripts, no test files).

### Non-obvious gotchas

- **Pill search / drug-info requires an external API key.** The search and pill-detail
  features call `data.go.kr`. Without a key, `dataGoFetchJson` in `src/App.jsx` throws
  ("공공데이터 API 서비스 키가 설정되어 있지 않습니다"), so text/symptom searches return no
  results even though the UI renders fine. To exercise the full lookup flow, set
  `VITE_API_KEY` (data.go.kr service key) — e.g. `cp .env.example .env` and fill it in.
  Despite the README, there is currently no offline demo/sample-data fallback.
- **Camera scan won't work headless.** The pill-photo feature uses `getUserMedia`, which
  needs a real camera + https/localhost. In the cloud VM the scan screen correctly shows a
  "카메라 권한을 허용해주세요" permission-request state instead of crashing.
- The active source lives in `src/` (`src/App.jsx`, `src/vision/`). `index.html` loads
  `/src/main.jsx`. Duplicate top-level `App.jsx`/`main.jsx` files exist but are not the
  entrypoint used by Vite.
