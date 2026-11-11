import { normalizeMapboxError } from '../services/apiClient.js';
import { haversineDistanceMeters } from './geo.js';

const METERS_PER_DEGREE_LAT = 111320;
const MIN_COS_LAT = 0.05;

export const DEFAULT_MAX_PITCH = 45;
export const DEFAULT_FADE_DURATION = 0;
export const DEFAULT_MAX_TILE_CACHE_SIZE = 200;

export const CAMERA_MIN_MOVE_METERS = 10;
export const CAMERA_MIN_INTERVAL_MS = 2000;

export const LITE_MODE_RADIUS_METERS = 15000;
export const LITE_MODE_RECOMPUTE_DISTANCE_METERS = 3000;

export const TILE_BACKOFF_BASE_MS = 10000;
export const TILE_BACKOFF_MAX_MS = 80000;

/**
 * Computes Web Mercator-safe [[west, south], [east, north]] bounds around [lng, lat]
 * with a default ~15 km half-width radius for Lite navigation tile clamping.
 */
export function computeLiteBoundsAroundCoord(coord, radiusMeters = LITE_MODE_RADIUS_METERS) {
  if (!Array.isArray(coord) || coord.length < 2) return null;
  const [lng, lat] = coord;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;

  const latDelta = radiusMeters / METERS_PER_DEGREE_LAT;
  const cosLat = Math.max(MIN_COS_LAT, Math.cos((lat * Math.PI) / 180));
  const lngDelta = radiusMeters / (METERS_PER_DEGREE_LAT * cosLat);

  const west = Math.max(-180, lng - lngDelta);
  const east = Math.min(180, lng + lngDelta);
  const south = Math.max(-85, lat - latDelta);
  const north = Math.min(85, lat + latDelta);

  return [
    [west, south],
    [east, north],
  ];
}

/**
 * Returns true when Lite bounds have not been set or the user moved >3 km from box center.
 */
export function shouldRecomputeLiteBounds(
  prevCenterCoord,
  currentCoord,
  thresholdMeters = LITE_MODE_RECOMPUTE_DISTANCE_METERS,
) {
  if (!Array.isArray(currentCoord) || currentCoord.length < 2) return false;
  if (!Array.isArray(prevCenterCoord) || prevCenterCoord.length < 2) return true;
  return haversineDistanceMeters(prevCenterCoord, currentCoord) > thresholdMeters;
}

/**
 * Throttles GPS follow-camera updates to curb 1 Hz tile request bursts:
 * skips easeTo unless moved >10 m, >=2 s elapsed since last easeTo, or mode changed.
 */
export function shouldUpdateFollowCamera({
  hasCenteredInitially,
  followUser,
  isDrawing,
  isEditingPath,
  isRateLimitPaused,
  prevCameraCoord,
  nextCoord,
  prevUpdateAtMs = 0,
  nowMs = Date.now(),
  forceSync = false,
  minMoveMeters = CAMERA_MIN_MOVE_METERS,
  minIntervalMs = CAMERA_MIN_INTERVAL_MS,
}) {
  if (!Array.isArray(nextCoord) || nextCoord.length < 2) return 'skip';
  if (!followUser || isDrawing || isEditingPath) return 'skip';
  if (!hasCenteredInitially) return 'initial_fly';
  if (isRateLimitPaused) return 'skip';
  if (forceSync || !Array.isArray(prevCameraCoord) || prevCameraCoord.length < 2) {
    return 'ease';
  }

  const elapsedMs = nowMs - prevUpdateAtMs;
  if (elapsedMs >= minIntervalMs) {
    return 'ease';
  }

  const movedMeters = haversineDistanceMeters(prevCameraCoord, nextCoord);
  return movedMeters > minMoveMeters ? 'ease' : 'skip';
}

/**
 * Returns capped exponential backoff delay in milliseconds (10s -> 20s -> 40s -> 80s).
 */
export function getRateLimitBackoffMs(
  attemptIndex = 0,
  baseMs = TILE_BACKOFF_BASE_MS,
  maxMs = TILE_BACKOFF_MAX_MS,
) {
  const safeAttempt = Math.max(0, Math.floor(attemptIndex));
  return Math.min(maxMs, baseMs * 2 ** safeAttempt);
}

/**
 * Returns true when a Mapbox error URL targets analytics/telemetry (often blocked by ad blockers)
 * rather than map rendering assets.
 */
export function isTelemetryBlockedUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  return /(^|\/\/)events\.mapbox\.com\b/i.test(url);
}

/**
 * Distinguishes failing Mapbox resource types (/styles/, /fonts/, /v4/ tiles) and required scopes.
 */
export function classifyMapboxResourceKind(url) {
  if (typeof url !== 'string' || !url) {
    return {
      kind: 'resource',
      requiredScope: 'styles:tiles, styles:read, fonts:read',
      label: 'Map tiles',
    };
  }

  if (/\/styles\/v\d+\//i.test(url) || url.startsWith('mapbox://styles/')) {
    return {
      kind: 'style',
      requiredScope: 'styles:read',
      label: 'Map style JSON',
    };
  }

  if (/\/fonts\/v\d+\//i.test(url)) {
    return {
      kind: 'fonts',
      requiredScope: 'fonts:read',
      label: 'Map fonts',
    };
  }

  if (/\/v4\/|tiles\.mapbox\.com|\.(pbf|webp|png|jpg)(\?|$)/i.test(url)) {
    return {
      kind: 'tiles',
      requiredScope: 'styles:tiles',
      label: 'Map tiles',
    };
  }

  return {
    kind: 'resource',
    requiredScope: 'styles:tiles, styles:read, fonts:read',
    label: 'Map tiles',
  };
}

/**
 * Formats a Mapbox GL `error` event into a specific user-facing notice distinguishing
 * 401 token errors, 403 scope/URL-restriction blocks, 429 rate-limits, and offline/network failures.
 */
export function formatMapTileError(err, { origin = '', hasStoredTokenOverride = false } = {}) {
  const errorUrl = typeof err?.url === 'string' ? err.url : '';
  const resource = classifyMapboxResourceKind(errorUrl);
  const normalized = normalizeMapboxError(err, resource.label);

  let message = normalized.message;
  if (normalized.status === 401) {
    message = hasStoredTokenOverride
      ? 'Invalid or expired Mapbox token (401) in saved browser settings. Update Token or Reset Saved to use .env.local.'
      : 'Invalid or expired Mapbox token (401). Update your pk.* token and retry.';
  } else if (normalized.status === 403) {
    const originHint = origin ? ` or URL restriction allowing ${origin}` : '';
    message = `${resource.label} blocked (403). Check token scope (${resource.requiredScope})${originHint}.`;
  }

  return {
    message,
    code: normalized.code,
    status: normalized.status,
    isAuthError: normalized.isAuthError,
    retryable: normalized.retryable,
    resourceKind: resource.kind,
    url: errorUrl,
  };
}
