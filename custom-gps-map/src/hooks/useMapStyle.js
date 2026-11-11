import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { hasStoredTokenOverride } from '../store/navigationContext.js';
import {
  formatMapTileError,
  getRateLimitBackoffMs,
  isTelemetryBlockedUrl,
} from '../utils/mapOptimization.js';

export const STANDARD_SATELLITE_STYLE = 'mapbox://styles/mapbox/standard-satellite';
export const FALLBACK_SATELLITE_STYLE = 'mapbox://styles/mapbox/satellite-streets-v12';

export const MAP_STYLES = {
  satellite: STANDARD_SATELLITE_STYLE,
  satelliteFallback: FALLBACK_SATELLITE_STYLE,
  night: 'mapbox://styles/mapbox/navigation-night-v1',
  day: 'mapbox://styles/mapbox/navigation-day-v1',
};

export const MAP_THEME_ORDER = ['satellite', 'night', 'day'];

export const STANDARD_SATELLITE_CONFIG = {
  basemap: {
    showPointOfInterestLabels: true,
    showPlaceLabels: true,
    showRoadLabels: true,
    showTransitLabels: true,
    showRoadsAndTransit: true,
    showPedestrianRoads: true,
    show3dObjects: false,
    lightPreset: 'day',
  },
};

const TILE_FAILURE_WINDOW_MS = 10000;
const TILE_FALLBACK_FAILURE_THRESHOLD = 3;

/**
 * Manages Mapbox base style selection, Standard Satellite basemap config after `style.load`,
 * automatic `satellite-streets-v12` fallback, and 429 exponential-backoff camera pausing.
 */
export function useMapStyle({ mapTheme, dispatch, mapRef }) {
  const [tileError, setTileError] = useState(null);
  const [satelliteFallbackActive, setSatelliteFallbackActive] = useState(false);
  const [satelliteNotice, setSatelliteNotice] = useState(null);
  const [isTileRequestsPaused, setIsTileRequestsPaused] = useState(false);
  const [mapRetryNonce, setMapRetryNonce] = useState(0);
  const [styleState, setStyleState] = useState({ loadedUrl: '', generation: 0 });

  const effectiveThemeKey =
    mapTheme === 'satellite' && satelliteFallbackActive ? 'satelliteFallback' : mapTheme;
  const mapStyleUrl = MAP_STYLES[effectiveThemeKey] || MAP_STYLES.satellite;
  const useStandardSlots = mapStyleUrl === STANDARD_SATELLITE_STYLE;
  const isStyleReady = styleState.loadedUrl === mapStyleUrl;
  const styleGeneration = styleState.generation;

  const mapStyleUrlRef = useRef(mapStyleUrl);
  const isStyleReadyRef = useRef(isStyleReady);
  const satelliteFallbackRef = useRef(satelliteFallbackActive);
  const appliedStyleRef = useRef({ style: null, url: '' });
  const boundMapRef = useRef(null);
  const listenersCleanupRef = useRef(null);

  const backoffAttemptRef = useRef(0);
  const pauseUntilMsRef = useRef(0);
  const pauseTimerRef = useRef(null);
  const rateLimitToastShownRef = useRef(false);
  const tileFailuresRef = useRef([]);

  useLayoutEffect(() => {
    mapStyleUrlRef.current = mapStyleUrl;
    isStyleReadyRef.current = isStyleReady;
    satelliteFallbackRef.current = satelliteFallbackActive;
  }, [mapStyleUrl, isStyleReady, satelliteFallbackActive]);

  const clearPauseTimer = useCallback(() => {
    if (pauseTimerRef.current !== null) {
      window.clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }
  }, []);

  const applySatelliteBasemapConfig = useCallback((map) => {
    const activeUrl = mapStyleUrlRef.current;
    if (!map || activeUrl !== STANDARD_SATELLITE_STYLE) return;
    if (
      appliedStyleRef.current.style &&
      appliedStyleRef.current.style === map.style &&
      appliedStyleRef.current.url === activeUrl
    ) {
      return;
    }

    if (typeof map.setConfig === 'function') {
      try {
        map.setConfig('basemap', STANDARD_SATELLITE_CONFIG.basemap);
        appliedStyleRef.current = { style: map.style || true, url: activeUrl };
        return;
      } catch {
        // Fall through to per-property application if batch config throws on partial schema
      }
    }

    if (typeof map.setConfigProperty === 'function') {
      for (const [key, value] of Object.entries(STANDARD_SATELLITE_CONFIG.basemap)) {
        try {
          if (
            typeof map.getConfigProperty === 'function' &&
            map.getConfigProperty('basemap', key) === value
          ) {
            continue;
          }
          map.setConfigProperty('basemap', key, value);
        } catch {
          // Ignore properties unsupported by an older basemap schema
        }
      }
      appliedStyleRef.current = { style: map.style || true, url: activeUrl };
    }
  }, []);

  const markStyleLoaded = useCallback(
    (map) => {
      if (!map) return;
      const activeUrl = mapStyleUrlRef.current;
      applySatelliteBasemapConfig(map);
      isStyleReadyRef.current = true;
      setStyleState((prev) => ({
        loadedUrl: activeUrl,
        generation: prev.generation + 1,
      }));
    },
    [applySatelliteBasemapConfig],
  );

  const ensureMapListeners = useCallback(
    (map) => {
      if (!map || boundMapRef.current === map || typeof map.on !== 'function') return;

      listenersCleanupRef.current?.();
      boundMapRef.current = map;

      const onStyleLoad = () => {
        const currentMap = mapRef.current?.getMap?.() || map;
        markStyleLoaded(currentMap);
      };

      map.on('style.load', onStyleLoad);

      listenersCleanupRef.current = () => {
        map.off?.('style.load', onStyleLoad);
      };
    },
    [mapRef, markStyleLoaded],
  );

  useEffect(() => {
    return () => {
      listenersCleanupRef.current?.();
      boundMapRef.current = null;
      clearPauseTimer();
    };
  }, [clearPauseTimer]);

  const handleMapLoad = useCallback(() => {
    const map = mapRef.current?.getMap?.();
    if (!map) return;
    ensureMapListeners(map);
    if (map.isStyleLoaded?.() && appliedStyleRef.current.url !== mapStyleUrlRef.current) {
      markStyleLoaded(map);
    }
  }, [mapRef, ensureMapListeners, markStyleLoaded]);

  const handleMapStyleData = useCallback(() => {
    const map = mapRef.current?.getMap?.();
    if (!map) return;
    ensureMapListeners(map);
  }, [mapRef, ensureMapListeners]);

  const activateSatelliteFallback = useCallback((noticeMessage) => {
    if (satelliteFallbackRef.current) return;
    satelliteFallbackRef.current = true;
    isStyleReadyRef.current = false;
    appliedStyleRef.current = { style: null, url: '' };
    tileFailuresRef.current = [];
    setSatelliteFallbackActive(true);
    setSatelliteNotice(noticeMessage);
    setTileError(null);
  }, []);

  const handleMapError = useCallback(
    (event) => {
      const err = event?.error;
      if (!err || err.name === 'AbortError') return;

      const rawUrl = typeof err?.url === 'string' ? err.url : event?.tile?.tileID?.key || '';
      if (isTelemetryBlockedUrl(rawUrl)) return;

      const origin = typeof window !== 'undefined' ? window.location?.origin || '' : '';
      const formatted = formatMapTileError(err, {
        origin,
        hasStoredTokenOverride: hasStoredTokenOverride(),
      });

      const isStandardSat = mapStyleUrlRef.current === STANDARD_SATELLITE_STYLE;
      const isImportError = /failed to load imports|basemap/i.test(err?.message || '');
      const canFallback =
        isStandardSat &&
        !satelliteFallbackRef.current &&
        !formatted.isAuthError &&
        formatted.code !== 'OFFLINE';

      // Immediate fallback if Standard Satellite style/basemap import itself fails before style.load
      if (canFallback && (!isStyleReadyRef.current || formatted.resourceKind === 'style' || isImportError)) {
        activateSatelliteFallback(
          'Switched to classic Satellite Streets basemap because Standard Satellite failed to load.',
        );
        return;
      }

      if (formatted.code === 'RATE_LIMITED') {
        const nowMs = Date.now();

        if (canFallback) {
          const recent = tileFailuresRef.current.filter((t) => nowMs - t < TILE_FAILURE_WINDOW_MS);
          recent.push(nowMs);
          tileFailuresRef.current = recent;
          if (backoffAttemptRef.current >= 1 && recent.length >= TILE_FALLBACK_FAILURE_THRESHOLD) {
            activateSatelliteFallback(
              'Standard Satellite tiles hit rate limits repeatedly. Switched to Satellite Streets.',
            );
            return;
          }
        }

        if (nowMs < pauseUntilMsRef.current) {
          // Already inside backoff pause: keep toast & pause window stable without tight loops
          return;
        }

        const delayMs = getRateLimitBackoffMs(backoffAttemptRef.current);
        backoffAttemptRef.current += 1;
        pauseUntilMsRef.current = nowMs + delayMs;
        setIsTileRequestsPaused(true);

        if (!rateLimitToastShownRef.current) {
          rateLimitToastShownRef.current = true;
          const seconds = Math.round(delayMs / 1000);
          setTileError({
            message: `Map tiles rate-limited (429). Pausing camera updates for ${seconds}s before resuming.`,
            code: formatted.code,
            isAuthError: false,
            retryable: true,
          });
        }

        clearPauseTimer();
        pauseTimerRef.current = window.setTimeout(() => {
          pauseTimerRef.current = null;
          pauseUntilMsRef.current = 0;
          setIsTileRequestsPaused(false);
        }, delayMs);
        return;
      }

      if (canFallback) {
        const nowMs = Date.now();
        const recent = tileFailuresRef.current.filter((t) => nowMs - t < TILE_FAILURE_WINDOW_MS);
        recent.push(nowMs);
        tileFailuresRef.current = recent;
        if (recent.length >= TILE_FALLBACK_FAILURE_THRESHOLD) {
          activateSatelliteFallback(
            'Satellite tiles kept failing on Standard Satellite. Switched to Satellite Streets.',
          );
          return;
        }
      }

      if (
        formatted.isAuthError ||
        formatted.code === 'SERVER_ERROR' ||
        formatted.code === 'OFFLINE' ||
        formatted.code === 'NETWORK_ERROR'
      ) {
        setTileError({
          message: formatted.message,
          code: formatted.code,
          isAuthError: formatted.isAuthError,
          retryable: formatted.retryable,
        });
      }
    },
    [activateSatelliteFallback, clearPauseTimer],
  );

  const handleMapIdle = useCallback(() => {
    const nowMs = Date.now();

    // Mapbox marks 429 tiles as `errored` and fires `idle` immediately; keep warning during pause.
    if (nowMs < pauseUntilMsRef.current) {
      return;
    }

    backoffAttemptRef.current = 0;
    rateLimitToastShownRef.current = false;
    tileFailuresRef.current = [];
    setTileError(null);
  }, []);

  const dismissTileError = useCallback(() => {
    setTileError(null);
  }, []);

  const dismissSatelliteNotice = useCallback(() => {
    setSatelliteNotice(null);
  }, []);

  const retryStandardSatellite = useCallback(() => {
    satelliteFallbackRef.current = false;
    isStyleReadyRef.current = false;
    appliedStyleRef.current = { style: null, url: '' };
    tileFailuresRef.current = [];
    backoffAttemptRef.current = 0;
    rateLimitToastShownRef.current = false;
    pauseUntilMsRef.current = 0;
    clearPauseTimer();
    setIsTileRequestsPaused(false);
    setSatelliteFallbackActive(false);
    setSatelliteNotice(null);
    setTileError(null);
    setStyleState((prev) => ({ ...prev, loadedUrl: '' }));
  }, [clearPauseTimer]);

  const retryTiles = useCallback(() => {
    backoffAttemptRef.current = 0;
    rateLimitToastShownRef.current = false;
    pauseUntilMsRef.current = 0;
    tileFailuresRef.current = [];
    clearPauseTimer();
    setIsTileRequestsPaused(false);
    setTileError(null);
    isStyleReadyRef.current = false;
    appliedStyleRef.current = { style: null, url: '' };
    setStyleState((prev) => ({ ...prev, loadedUrl: '' }));

    const map = mapRef.current?.getMap?.();
    if (map && typeof map.setStyle === 'function') {
      try {
        map.setStyle(mapStyleUrlRef.current);
        return;
      } catch {
        // Fall through to full map remount if instance failed before initialization
      }
    }
    boundMapRef.current = null;
    setMapRetryNonce((prev) => prev + 1);
  }, [mapRef, clearPauseTimer]);

  const cycleMapTheme = useCallback(() => {
    setTileError(null);
    isStyleReadyRef.current = false;
    appliedStyleRef.current = { style: null, url: '' };
    dispatch({
      type: 'SET_MAP_THEME',
      payload: (prev) => {
        const idx = MAP_THEME_ORDER.indexOf(prev);
        return MAP_THEME_ORDER[(idx + 1) % MAP_THEME_ORDER.length];
      },
    });
  }, [dispatch]);

  return {
    mapStyleUrl,
    useStandardSlots,
    isStyleReady,
    styleGeneration,
    satelliteFallbackActive,
    satelliteNotice,
    dismissSatelliteNotice,
    retryStandardSatellite,
    mapRetryNonce,
    tileError,
    isTileRequestsPaused,
    dismissTileError,
    retryTiles,
    cycleMapTheme,
    handleMapLoad,
    handleMapStyleData,
    handleMapError,
    handleMapIdle,
  };
}
