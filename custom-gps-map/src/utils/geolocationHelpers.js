import {
  computeBearingDegrees,
  haversineDistanceMeters,
  isAccurateGpsFix,
  smoothHeadingDegrees,
  smoothPosition,
} from './geo.js';

export const MAX_SNAP_ACCURACY_METERS = 100;
export const MAX_HALO_RADIUS_METERS = 2000;
export const HUD_COMMIT_INTERVAL_MS = 950;

export const QUICK_FIRST_FIX_OPTIONS = {
  enableHighAccuracy: false,
  maximumAge: 30000,
  timeout: 15000,
};

export const HIGH_ACCURACY_WATCH_OPTIONS = {
  enableHighAccuracy: true,
  maximumAge: 5000,
  timeout: 20000,
};

export const RELAXED_WATCH_OPTIONS = {
  enableHighAccuracy: false,
  maximumAge: 30000,
  timeout: 25000,
};

export const TIMEOUT_RETRY_BASE_MS = 2000;
export const TIMEOUT_RETRY_MAX_MS = 30000;

/**
 * Detects browser secure context, installed PWA standalone mode, and coarse OS/browser platform
 * to provide tailored Location recovery instructions without network or third-party calls.
 */
export function detectGeolocationEnvironment() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      isSupported: false,
      isSecureContext: true,
      isStandalone: false,
      platform: 'desktop',
    };
  }

  const ua = navigator.userAgent || '';
  const isIOS =
    /iPad|iPhone|iPod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1);
  const isAndroid = /Android/i.test(ua);
  const isStandalone = Boolean(
    window.matchMedia?.('(display-mode: standalone)')?.matches || navigator.standalone === true,
  );

  return {
    isSupported: 'geolocation' in navigator,
    isSecureContext: window.isSecureContext !== false,
    isStandalone,
    platform: isIOS ? 'ios' : isAndroid ? 'android' : 'desktop',
  };
}

/**
 * Maps browser Geolocation errors and environment blockers into actionable,
 * dismissible recovery state with Chrome Android, iOS Safari, and installed PWA guidance.
 */
export function buildGeolocationErrorDetail(err, env = detectGeolocationEnvironment()) {
  if (!env.isSupported) {
    return {
      code: 'UNSUPPORTED',
      status: 'unavailable',
      message: 'Geolocation is not supported by your browser.',
      retryable: false,
    };
  }

  if (!env.isSecureContext) {
    return {
      code: 'INSECURE_CONTEXT',
      status: 'unavailable',
      message:
        'GPS requires a secure HTTPS connection (or localhost). Open this app via https:// rather than plain http://, then retry.',
      retryable: true,
    };
  }

  if (!err) {
    return {
      code: 'POSITION_UNAVAILABLE',
      status: 'unavailable',
      message: 'Unable to determine your GPS position. Check device Location Services and retry.',
      retryable: true,
    };
  }

  if (err.code === 1 || err.code === 'PERMISSION_DENIED') {
    const recoveryByPlatform =
      env.platform === 'ios'
        ? env.isStandalone
          ? 'On iOS Home Screen PWA: open iOS Settings -> Privacy & Security -> Location Services -> Safari Websites -> While Using the App, or reopen in Safari and re-grant location, then tap Retry.'
          : 'On iOS Safari: tap aA / Website Settings -> Location -> Allow, and verify Settings -> Privacy & Security -> Location Services -> Safari Websites is enabled, then tap Retry.'
        : env.platform === 'android'
          ? env.isStandalone
            ? 'On installed Chrome Android PWA: open App Info -> Permissions -> Location -> Allow, ensure Device Location is on, then tap Retry.'
            : 'On Chrome Android: tap the lock/tune icon in the address bar -> Permissions -> Location -> Allow and enable Device Location, then tap Retry.'
          : 'Enable Location in browser site settings (address bar lock/tune icon -> Location -> Allow). On mobile: Chrome Android (Site settings -> Location) or iOS Safari/PWA (Settings -> Privacy & Security -> Location Services).';

    return {
      code: 'PERMISSION_DENIED',
      status: 'denied',
      message: `Location access denied. ${recoveryByPlatform}`,
      retryable: true,
    };
  }

  if (err.code === 2 || err.code === 'POSITION_UNAVAILABLE') {
    return {
      code: 'POSITION_UNAVAILABLE',
      status: 'unavailable',
      message:
        'GPS signal is currently unavailable. Turn on device Location Services / Wi-Fi or move outdoors, then tap Retry.',
      retryable: true,
    };
  }

  if (err.code === 3 || err.code === 'TIMEOUT') {
    return {
      code: 'TIMEOUT',
      status: 'timeout',
      message:
        'GPS fix timed out. Switching to relaxed Wi-Fi/cell fallback automatically — or tap Retry.',
      retryable: true,
    };
  }

  return {
    code: 'POSITION_UNAVAILABLE',
    status: 'unavailable',
    message: err.message || 'Location tracking failed. Check GPS settings and retry.',
    retryable: true,
  };
}

/**
 * Returns capped exponential retry delay on TIMEOUT (2s -> 4s -> 8s -> 15s -> 30s)
 * so relaxed fallback retries smoothly without tight loops.
 */
export function computeGpsTimeoutRetryDelayMs(attempt = 0) {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  return Math.min(TIMEOUT_RETRY_MAX_MS, TIMEOUT_RETRY_BASE_MS * 2 ** safeAttempt);
}

/**
 * Processes a raw GeolocationPosition:
 * - Rejects invalid/non-finite coordinates.
 * - Flags accuracy > 100 m as coarse (`isCoarse: true`) so callers skip puck/route snapping
 *   while still rendering a large accuracy halo and allowing Find-me centering.
 * - Lightly smooths accurate coordinates and computes heading from movement when native heading is absent.
 */
export function processRawGeolocationPosition(
  position,
  prevRefs = {
    smoothedCoord: null,
    bearingAnchorCoord: null,
    smoothedHeading: null,
  },
) {
  const coords = position?.coords;
  if (!coords) return null;

  const { latitude, longitude, heading, speed, accuracy } = coords;
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  const safeAccuracy =
    typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0
      ? accuracy
      : MAX_SNAP_ACCURACY_METERS + 50;
  const timestamp = Number.isFinite(position.timestamp) ? position.timestamp : Date.now();
  const safeSpeed = Number.isFinite(speed) && speed >= 0 ? speed : null;

  const accurateEnoughToSnap = isAccurateGpsFix(safeAccuracy, MAX_SNAP_ACCURACY_METERS);
  if (!accurateEnoughToSnap) {
    return {
      kind: 'coarse',
      fix: {
        latitude,
        longitude,
        heading: Number.isFinite(heading) && heading >= 0 ? heading : prevRefs.smoothedHeading ?? 0,
        speed: safeSpeed,
        accuracy: safeAccuracy,
        timestamp,
        isCoarse: true,
      },
      nextRefs: prevRefs,
    };
  }

  const rawCoord = [longitude, latitude];
  const filteredCoord = smoothPosition(prevRefs.smoothedCoord, rawCoord, 0.55);

  let bearingAnchorCoord = prevRefs.bearingAnchorCoord;
  let targetHeading = prevRefs.smoothedHeading;

  if (typeof heading === 'number' && Number.isFinite(heading) && heading >= 0) {
    targetHeading = heading;
    bearingAnchorCoord = filteredCoord;
  } else if (Array.isArray(bearingAnchorCoord) && bearingAnchorCoord.length >= 2) {
    const movedMeters = haversineDistanceMeters(bearingAnchorCoord, filteredCoord);
    if (movedMeters >= 3) {
      targetHeading = computeBearingDegrees(bearingAnchorCoord, filteredCoord);
      bearingAnchorCoord = filteredCoord;
    }
  } else {
    bearingAnchorCoord = filteredCoord;
  }

  const nextSmoothedHeading =
    targetHeading != null && Number.isFinite(targetHeading)
      ? smoothHeadingDegrees(prevRefs.smoothedHeading, targetHeading, 0.38)
      : prevRefs.smoothedHeading;

  return {
    kind: 'accurate',
    fix: {
      latitude: filteredCoord[1],
      longitude: filteredCoord[0],
      heading: nextSmoothedHeading ?? 0,
      speed: safeSpeed,
      accuracy: safeAccuracy,
      timestamp,
      isCoarse: false,
    },
    nextRefs: {
      smoothedCoord: filteredCoord,
      bearingAnchorCoord,
      smoothedHeading: nextSmoothedHeading,
    },
  };
}

/**
 * Returns true when a [lng, lat] coordinate falls outside the current map viewport bounds.
 */
export function isCoordOutsideMapBounds(bounds, coord) {
  if (!bounds || typeof bounds.contains !== 'function') return false;
  if (!Array.isArray(coord) || coord.length < 2) return false;
  const [lng, lat] = coord;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  try {
    return !bounds.contains([lng, lat]);
  } catch {
    return false;
  }
}
