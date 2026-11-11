# Custom GPS Navigator (NavApp)

Mobile-first Progressive Web App (PWA) for drawing custom bypass routes snapped to real drivable roads, searching places/stores/POIs, modifying routes with intermediate stops, and navigating with live GPS turn-by-turn progress.

## Features

- **Custom Bypass Route Drawing & Live Tooling**: Draw freehand multi-vertex polylines directly on the map (`@mapbox/mapbox-gl-draw`) with live distance/point feedback, **Drop Last** vertex correction while drawing, **Undo / Redo** edit history, and a **Snapped Route Preview** banner (**Use Snapped Route**, **Edit Vertices**, **Discard**) before committing.
- **Partial & Failed Match Highlighting**: Identifies unmatchable stretches (`NoSegment` / null `tracepoints`) and multi-sub-matching gaps visually in dashed red on the map instead of silently leaving a stale route active.
- **Place Search, Category POIs & Corridor Search**:
  - Search stores, restaurants, groceries, cafes, fuel, medical clinics, ATMs, hotels, and addresses via the Mapbox Search Box API v1 (`/suggest`, `/retrieve`, `/forward`, `/category`).
  - Toggle **Along Route** search (`<= 800 m` corridor along active route), **Open Now** status filter when returned by the API, and **Nearest / Relevance** distance sorting.
- **Saved Places, Route Library & Offline Access (IndexedDB)**:
  - Save **Home**, **Work**, **Favorites**, and **Recent Searches** locally using IndexedDB (`idb`).
  - Save, reload, rename, and delete named custom bypass or navigated routes (plus automatic route history) with offline turn-step viewing.
  - **Mapbox Web ToS Notice**: App shell (Workbox service worker) and IndexedDB route geometry/steps operate offline; per Mapbox GL JS web Terms of Service, bulk tile scraping/offline tile region caching is intentionally omitted.
- **GPX / GeoJSON Import & Export + QR Share Links**: Export active routes to GPX 1.1 XML or GeoJSON, import `.gpx`/`.geojson` tracks and waypoints, or share compact `#route=...` URLs with locally generated SVG QR codes (`qrcode`, zero external services).
- **Multi-Stop Planner & Round Trip**: Drag-and-drop or tap Up/Down buttons to reorder stops, remove stops, view per-leg distance & ETA breakdowns, and toggle **Round Trip** return to origin.
- **Alternatives, Live Traffic & Road Avoidances**: Switch between **Live Traffic** (`driving-traffic`), **Drive**, **Cycle**, and **Walk**; inspect and select up to 2 alternative routes with time/distance deltas (tap on the map or HUD pills); avoid tolls, highways, and ferries.
- **Live Turn-by-Turn GPS, Auto-Reroute, Compass & Speed Limits**:
  - Rejects poor-precision fixes (`accuracy > 50 m`), smooths GPS jitter/headings, and throttles HUD updates to ~1 Hz.
  - Monotonic maneuver step progression with street name, distance, and a live **"Then"** next-step preview.
  - **Auto-Reroute**: When off-route (`> 45 m` for `4 s`), debounces and fetches an abortable reroute from current position preserving remaining stops while displaying a cancelable **Rerouting...** banner.
  - **Voice Guidance, Compass & Speed Limits**: Web Speech API turn announcements (`500 m`, `200 m`, `now`, reroute, arrival), live compass rose with **Reset North**, speed-limit sign badge (`maxspeed` annotations on `driving` / `driving-traffic`), and configurable overspeed alert.
  - **Trip Summary, Settings & i18n**: Consolidated Settings & Privacy modal covering map styles (**Standard Satellite**, **Navigation Night**, **Navigation Day**), `km`/`mi`, `12h`/`24h`, English/Hindi UI scaffolding, voice/speed alert toggles, local data clearing, and token management.

## Tech Stack

- React 19 + Vite 8 + Tailwind CSS v4
- Mapbox GL JS v3 (`react-map-gl` v8) + `@mapbox/mapbox-gl-draw`
- `idb` (IndexedDB persistence) + `qrcode` (in-browser SVG QR code generation)
- `vite-plugin-pwa` (Workbox service worker & web app manifest)
- Vitest (unit testing) & ESLint (React Hooks v7 rules)

## Setup

### 1. Install Dependencies

```bash
cd custom-gps-map
npm install
```

### 2. Configure Your Mapbox Token

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Add your **public** (`pk.*`) Mapbox access token:

```env
VITE_MAPBOX_TOKEN=pk.your_scoped_public_token_here
```

> **Note**: Tokens pasted directly into the in-app Token modal are saved in `localStorage` under `takeurroute_mapbox_token` and take priority over `.env.local` until cleared via **Reset Saved**.

### Required Token Scopes & URL Restrictions

Create a dedicated **public (`pk.*`)** token in your Mapbox account dashboard (never commit secrets or `sk.*` secret tokens):

- **Required Public Scopes**:
  - `styles:tiles` (vector & satellite raster tiles `/v4/`)
  - `styles:read` (style JSON `/styles/v1/` and Standard `basemap` imports)
  - `fonts:read` (map glyphs `/fonts/v1/`)
  - `datasets:read` (POI / custom style datasets if enabled)
- **URL Restrictions (Strongly Recommended)**:
  - Restrict the token by HTTP Referer / URL in the Mapbox dashboard to your exact origins:
    - Local Vite dev/preview: `http://localhost:5173/*`, `http://127.0.0.1:5173/*`, `http://localhost:4173/*`
    - Production origin: `https://your-domain.example/*`
  - **Troubleshooting `401` / `403` / `429` Map Tile Errors**:
    - Always check whether a browser-saved token (`takeurroute_mapbox_token` in `localStorage`) is overriding `VITE_MAPBOX_TOKEN`; use **Update Token -> Reset Saved** in Settings if you edited `.env.local`.
    - `403` on `/styles/` indicates missing `styles:read` or a blocked HTTP Referer; `403` on `/v4/` indicates missing `styles:tiles`; `403` on `/fonts/` indicates missing `fonts:read`.
    - During heavy tile bursts or rate limits (`429`), the app automatically caps pitch (`<= 45°`), throttles GPS follow camera updates (`> 10 m` or `>= 2 s`), pauses camera-driven requests with exponential backoff (`10s -> 20s -> 40s`), falls back from `standard-satellite` to `satellite-streets-v12` if Standard Satellite fails repeatedly, and restricts navigation tile bounds in **Lite Mode** (`~15 km` around your position, recomputed after `> 3 km`).
    - The Workbox PWA Service Worker strictly precaches the local app shell and excludes `api.mapbox.com`, `*.tiles.mapbox.com`, and `events.mapbox.com` from caching or interception (in compliance with Mapbox web ToS).

### 3. Run Locally

```bash
npm run dev
```

Open `http://localhost:5173`.

## Testing & Verification

Run automated unit tests, ESLint, and the production build:

```bash
npm test
npm run lint
npm run build
```

## Deployment & HTTPS Requirement

Browsers restrict key navigation APIs (**Geolocation `watchPosition`**, **Screen Wake Lock**, and **Service Worker PWA installation**) to **Secure Contexts (`https://` or `http://localhost`)**:

- Plain `http://192.168.x.x` over LAN will fail geolocation/wake-lock/service-worker registration on mobile browsers.
- Deploy behind TLS (`https://`) on Vercel, Netlify, Cloudflare Pages, or an HTTPS tunnel for physical phone field testing.
- Generate/verify production bundle with `npm run build` and audit PWA installability in Chrome DevTools Lighthouse (`icon-192x192.png`, `icon-512x512.png`, `icon-maskable-512x512.png`).

## Manual GPS QA Checklist

Use **Chrome DevTools -> More Tools -> Sensors -> Location** (or field walk/drive with a GPX playback app) on a mobile viewport (`360x640` and `390x844`):

1. **Permission Denied & Retry**: Deny location permission, verify the clear GPS recovery banner appears, re-enable permission in site settings, tap **Retry**, and verify live tracking starts without reloading.
2. **Poor GPS Accuracy Gate (`> 50 m`)**: Simulate an accuracy value of `120 m`; confirm the HUD shows `Weak GPS (±120 m · need <=50 m)` and does not jump the map or trigger false arrival. Switch accuracy back to `10 m` and verify the puck locks smoothly.
3. **Draw -> Snap -> Partial/NoSegment Recovery**:
   - Draw a line across a river/field far from roads -> verify `NoSegment` highlights the off-road stretch in dashed rose and clears any stale prior route. Drag vertex onto a street -> verify snap succeeds.
   - Draw a path with >100 sampled vertices -> verify smooth snapping without API errors.
4. **Search -> Modify Route (`> 25` waypoints)**: Search for a place, tap **Route to This Location**, then test **Extend Here**, **New End**, and **Add Stop**. On a >25-vertex line, verify the warning banner confirms selected stops were retained.
5. **Turn-by-Turn & Short-Route Arrival (`<= 50 m`)**:
   - Start Navigation on a ~35 m path, step DevTools sensor coordinates along the line toward the end, and confirm step cues advance monotonically and trigger **Arrived** near the endpoint.
   - Lock/switch browser tabs briefly and return -> verify Wake Lock re-acquires cleanly.
6. **Offline / API Failures**: Toggle DevTools **Network -> Offline**, confirm search/routing shows an offline banner with **Retry**, and test the **Last Route** restore action in the bottom bar.
7. **Auto-Reroute & Stop Preservation**: Start navigation on a route with an added intermediate stop, move simulated coordinates > 50 m off route for 5+ seconds, confirm **Rerouting...** fires after the 4 s debounce and preserves the remaining upcoming stop.
8. **Alternatives, Avoids, Voice & Units**:
   - Switch profile to **Traffic**, request a point-to-point route, verify alternative route lines appear with time/distance delta chips, and toggle **Tolls/Highways** in **Settings**.
   - Verify maneuver card shows street name + **Then** preview, toggle **km/mi** and **12h/24h**, and confirm voice mute/language settings update spoken output and arrive triggers **Destination Reached** trip summary.
9. **Saved Places, Routes, Share/Import & Multi-Stop Planner**:
   - Search an address, set **Home** / **Favorite**, reload page, open search or **Saved**, and verify persistence from IndexedDB.
   - Save a named route, export to `.gpx` / `.geojson`, copy the `#route=...` share link or scan the generated QR code, clear the route, and re-import via file picker or opening the share URL.
   - Add multiple stops, open **Stops** planner, drag/reorder stops, verify leg distances update, and toggle **Round Trip**.
   - Test **Along Route** POI chip for fuel/food and verify compass **Reset North**, speed limit badge, and **English / हिन्दी** switch in **Settings**.
