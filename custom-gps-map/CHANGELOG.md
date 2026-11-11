# Changelog

## Phase 3 — Power Features, Persistence & Settings

### Persistence, Import/Export & Sharing
- Added IndexedDB storage service `src/services/storageDb.js` (`idb`) and React binding `src/hooks/useSavedData.js` for **Home**, **Work**, **Favorites**, deduplicated **Recent Searches**, saved routes, and route history.
- Added `src/utils/routeIO.js` (`exportRouteToGpx`, `importRouteFromGpx`, `exportRouteToGeoJson`, `importRouteFromGeoJson`, `encodePolyline5`/`decodePolyline5`, `encodeRouteToHash`, `decodeRouteFromHash`) with automatic coordinate simplification to keep shared URL hashes within QR size budgets.
- Added lazy-loaded modals: `src/components/SavedHubModal.jsx` and `src/components/ShareImportModal.jsx` (100% client-side SVG QR rendering via `qrcode`).

### Draw Tooling, Multi-Stop Planner & Search Upgrades
- Upgraded `src/components/DrawControl.jsx` and `src/hooks/useRoute.js` with live drawn polyline distance feedback, **Drop Last** vertex while drawing, post-draw **Undo / Redo**, and **Snapped Route Preview** before committing.
- Created `src/utils/routePlanner.js` and lazy-loaded `src/components/RoutePlannerSheet.jsx` for drag-and-drop & accessible button waypoint reordering, stop removal, per-leg distance/duration readouts, and **Round Trip** toggling.
- Enhanced `src/services/mapboxGeocoding.js`, `src/hooks/usePoiDiscovery.js`, and `src/components/LocationSearch.jsx` with **Along Route** corridor search (`searchAlongRoutePOIs` within `800 m`), **Open Now** status filtering when provided by Mapbox metadata, distance sorting, and Home/Work/Favorite quick actions.

### Compass, Speed Limits, Settings, Offline Policy & i18n
- Requested `annotations=maxspeed` on `driving` / `driving-traffic` directions routes and exposed segment speed limits & overspeed alerts in `src/utils/geo.js`, `src/hooks/useNavigation.js`, `src/utils/voice.js`, and `src/hooks/useVoiceGuidance.js`.
- Added live compass **Reset North** button and speed limit road badge in `src/components/NavigationHUD.jsx`.
- Created lazy-loaded `src/components/SettingsModal.jsx` (replacing `PreferencesPanel.jsx`) and `src/utils/i18n.js` (**English / हिन्दी** scaffolding), including Mapbox GL JS web offline ToS transparency, local data management, and token configuration.
- Added Vitest suites in `src/utils/__tests__/routeIO.test.js`, `src/utils/__tests__/routePlanner.test.js`, and `src/utils/__tests__/phase3GeoAndI18n.test.js`.

---

## Phase 2 — Navigation Quality

### Auto-Rerouting & Stop Preservation
- Added `src/utils/reroute.js` (`shouldTriggerReroute`, `buildRemainingWaypointsForReroute`) with >45 m / 4 s off-route confirmation hysteresis and 12 s cooldown debouncing.
- Wired abortable auto-reroute inside `src/hooks/useNavigation.js` and `src/hooks/useRoute.js`, rendering a cancelable **Rerouting...** status banner while preserving unvisited intermediate stops.

### Voice Guidance & Next-Maneuver UX
- Created `src/utils/voice.js` and `src/hooks/useVoiceGuidance.js` using the browser Web Speech API (`SpeechSynthesis`) for `500 m`, `200 m`, `now`, reroute, and arrival prompts with mute toggle and 7 selectable language presets (`en-US`, `en-IN`, `en-GB`, `hi-IN`, `es-ES`, `fr-FR`, `de-DE`).
- Upgraded the turn banner in `src/components/NavigationHUD.jsx` to display street name, formatted distance, and a live **Then** preview for the following maneuver step.

### Alternative Routes, Traffic Profile, Avoidances, Preferences & Trip Summary
- Updated `src/services/mapboxDirections.js` with `alternatives=true` (for 2-point routes, returning primary + up to 2 alternatives), profile-safe `exclude` (`toll`, `motorway`, `ferry`), and `driving-traffic` support with live vs typical ETA metadata (`durationTypical`).
- Rendered interactive tappable alternative route geometry on the map and comparison delta chips (`+X min · +/-X km`) in `NavigationHUD.jsx`.
- Created `src/components/PreferencesPanel.jsx` and persisted user preferences (`takeurroute_preferences`) for `km`/`mi` units, `12h`/`24h` arrival clock, avoid checkboxes, and voice settings.
- Created `src/components/TripSummaryModal.jsx` triggered automatically upon destination arrival with total distance, elapsed trip time, average speed, and arrival timestamp.
- Added unit tests in `src/utils/__tests__/reroute.test.js`, `src/utils/__tests__/voice.test.js`, `src/utils/__tests__/geo.test.js`, and `src/services/__tests__/mapboxDirections.test.js`.

---

## Phase 1 — Flow & Robustness Hardening

### Architecture & State Management
- Extracted business logic from `src/App.jsx` into focused hooks:
  - `src/hooks/useGeolocation.js`: `accuracy <= 50 m` gating, exponential coordinate/circular-heading smoothing, ~1 Hz HUD state throttling, `POSITION_UNAVAILABLE`/`TIMEOUT`/`PERMISSION_DENIED` recovery + Permissions API observer.
  - `src/hooks/useWakeLock.js`: Screen Wake Lock acquisition/release with automatic `visibilitychange` re-acquisition and non-fatal denial telemetry.
  - `src/hooks/useMapStyle.js`: Base style management, Standard Satellite config sync, normalized `401`/`403`/`429`/`5xx`/offline tile errors with retry.
  - `src/hooks/usePoiDiscovery.js`: Category POI discovery with isolated error/retry state and clean request cancellation.
  - `src/hooks/useRoute.js`: Road matching, Directions multi-stop editing, stale route clearing on failure, retry memory, and offline last-route snapshot persistence.
  - `src/hooks/useNavigation.js`: Locality-biased route projection, monotonic step clamping, short-route arrival detection, and `prefers-reduced-motion`-aware camera updates.
  - `src/hooks/usePrefersReducedMotion.js`: Media query watcher for OS reduced-motion preference.
- Added centralized reducer + Context store in `src/store/navigationStore.jsx` and `src/store/navigationContext.js`, unifying token storage (`takeurroute_mapbox_token`) and offline route storage (`takeurroute_last_route`).

### Routing, Matching & Error Handling
- Created `src/services/apiClient.js` (`MapboxServiceError`, `fetchMapboxJson`, `normalizeMapboxError`) safely parsing non-JSON gateway responses, classifying `401`/`403`/`429`/`5xx`/offline failures, and propagating cancellations cleanly.
- Updated `src/services/mapboxMatching.js` to extract unmatched `tracepoints === null` segments and multi-sub-matching gaps (`> 20 m`), rendering highlighted dashed red lines on the map and descriptive warnings.
- Updated `src/services/mapboxDirections.js` and `src/utils/geo.js` (`selectImportantWaypoints`) to keep user-chosen stops and Ramer-Douglas-Peucker corners when simplifying `> 25`-point routes and emit user warnings instead of silently dropping stops.
- Fixed short-route (`<= 50 m`) arrival detection via `computeArrivalStatus`.
- Stopped masking Search Box auth/rate-limit/offline failures behind Geocoding v6 fallback in `src/services/mapboxGeocoding.js`.

### Security, Accessibility, Mobile Layout & PWA
- Removed the hardcoded default Mapbox `pk.*` fallback token from `src/App.jsx`, added `.env.example`, updated `.gitignore`, and created `src/components/TokenModal.jsx`.
- Removed `maximum-scale=1.0, user-scalable=no` from `index.html`; added `.hud-surface` pinch-zoom containment, `44px` minimum touch targets (including `.mapboxgl-ctrl-group button`), safe-area padding, keyboard focus outlines, and `prefers-reduced-motion` support in `src/index.css`, `NavigationHUD.jsx`, and `LocationSearch.jsx`.
- Generated PWA icon assets (`public/icon-192x192.png`, `public/icon-512x512.png`, `public/icon-maskable-512x512.png`) plus matching `public/favicon.svg`, and updated `vite.config.js` manifest and Workbox config for installability.

### Tests & Documentation
- Added Vitest suite covering `geo.js`, `mapboxMatching.js`, and `mapboxDirections.js`.
- Updated `README.md` with setup, scoped token/URL restriction rules, HTTPS deployment guidance, and a manual GPS QA checklist.

---

## Step 0 — Audit (Baseline)
- Audited React 19 / Mapbox GL / PWA architecture and prioritized P0 crashes/race conditions, P1 broken routing/GPS/PWA flows, and P2 coupling/accessibility issues prior to Phase 1 implementation.

---

## Remaining Ideas (Future Roadmap)
- **Elevation Profile Chart**: Request `elevation` or Terrain-RGB sampling along custom bypass routes to preview steep climbs for cycling/walking profiles.
- **Lane Guidance & Junction View**: Surface Mapbox step `intersections[].lanes` turn-lane indicators inside the Next-Maneuver Banner.
- **Route Simulation Playback**: Built-in GPX playback mode inside the UI so desktop users can preview a drawn bypass route animated along roads without opening Chrome DevTools Sensors.
- **Cloud / Passphrase-Encrypted Sync (Opt-in)**: Optional end-to-end encrypted backup of Favorites & Saved Routes across devices via a user-controlled sync provider.
