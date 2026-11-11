import { buildAlongRouteSamplePoints, filterLocationsAlongRoute } from '../utils/geo.js';
import { fetchMapboxJson, isAbortError, MapboxServiceError } from './apiClient.js';

const SEARCHBOX_BASE_URL = 'https://api.mapbox.com/search/searchbox/v1';
const GEOCODE_V6_URL = 'https://api.mapbox.com/search/geocode/v6/forward';
const SEARCH_FEATURE_TYPES =
  'poi,address,street,neighborhood,locality,place,district,postcode,region,country';

export const POI_CATEGORIES = [
  { id: 'shopping', label: 'Stores', color: '#f59e0b' },
  { id: 'supermarket', label: 'Grocery', color: '#10b981' },
  { id: 'restaurant', label: 'Food', color: '#f97316' },
  { id: 'coffee', label: 'Cafes', color: '#a855f7' },
  { id: 'gas_station', label: 'Fuel', color: '#38bdf8' },
  { id: 'pharmacy', label: 'Medical', color: '#fb7185' },
  { id: 'atm', label: 'ATMs', color: '#2dd4bf' },
  { id: 'hotel', label: 'Hotels', color: '#818cf8' },
];

/**
 * Generates an RFC 4122 UUIDv4 session token for grouping Search Box API billing sessions.
 */
export function createSessionToken() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const rand = Math.floor(Math.random() * 16);
    const value = ch === 'x' ? rand : (rand & 0x3) | 0x8;
    return value.toString(16);
  });
}

function assertValidToken(accessToken) {
  if (!accessToken || accessToken === 'YOUR_MAPBOX_ACCESS_TOKEN') {
    throw new MapboxServiceError('Add a valid Mapbox access token before searching locations.', {
      code: 'MISSING_TOKEN',
      isAuthError: true,
      retryable: false,
    });
  }
}

function appendProximityParam(params, proximity) {
  if (
    Array.isArray(proximity) &&
    proximity.length === 2 &&
    Number.isFinite(proximity[0]) &&
    Number.isFinite(proximity[1])
  ) {
    params.set('proximity', `${proximity[0].toFixed(6)},${proximity[1].toFixed(6)}`);
  }
}

function appendValidBboxParam(params, bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite)) {
    return;
  }
  const west = Math.max(-180, bbox[0]);
  const south = Math.max(-85, bbox[1]);
  const east = Math.min(180, bbox[2]);
  const north = Math.min(85, bbox[3]);

  // Skip oversized or antimeridian-wrapping viewports so Search Box bbox validation passes
  if (west < east && south < north && east - west <= 5 && north - south <= 5) {
    params.set(
      'bbox',
      `${west.toFixed(6)},${south.toFixed(6)},${east.toFixed(6)},${north.toFixed(6)}`,
    );
  }
}

function formatAddressText(props) {
  if (!props) return '';
  return (
    props.full_address ||
    props.place_formatted ||
    props.address ||
    props.context?.place?.name ||
    ''
  );
}

function extractCategoryLabel(props) {
  if (Array.isArray(props?.poi_category) && props.poi_category.length > 0) {
    return String(props.poi_category[0]).replace(/_/g, ' ');
  }
  return '';
}

function extractOpenNowStatus(props) {
  const openHours = props?.metadata?.open_hours;
  if (!openHours) return null;
  if (typeof openHours.open_now === 'boolean') return openHours.open_now;
  return null;
}

function normalizeFeature(feature, extra = {}) {
  const props = feature?.properties || {};
  const rawCoords = feature?.geometry?.coordinates;
  const fallbackCoords =
    Number.isFinite(props.coordinates?.longitude) &&
    Number.isFinite(props.coordinates?.latitude)
      ? [props.coordinates.longitude, props.coordinates.latitude]
      : null;
  const coordinates =
    Array.isArray(rawCoords) && rawCoords.length >= 2 ? rawCoords : fallbackCoords;

  if (!coordinates) return null;

  return {
    id: props.mapbox_id || feature.id || coordinates.join(','),
    name: props.name || props.full_address || 'Selected location',
    address: formatAddressText(props),
    featureType: props.feature_type || '',
    categoryLabel: extractCategoryLabel(props),
    openNow: extractOpenNowStatus(props),
    coordinates,
    needsRetrieve: false,
    ...extra,
  };
}

function shouldStopBeforeFallback(error) {
  if (isAbortError(error)) return true;
  if (!(error instanceof MapboxServiceError)) return false;
  return (
    error.isAuthError ||
    error.code === 'RATE_LIMITED' ||
    error.code === 'OFFLINE' ||
    error.code === 'MISSING_TOKEN'
  );
}

async function fetchGeocodeV6Fallback({ query, accessToken, proximity, limit, signal }) {
  const params = new URLSearchParams({
    q: query,
    autocomplete: 'true',
    limit: String(limit),
    access_token: accessToken,
  });
  appendProximityParam(params, proximity);

  const data = await fetchMapboxJson(`${GEOCODE_V6_URL}?${params.toString()}`, {
    signal,
    serviceName: 'Geocoding',
  });

  return (data.features || []).map((feature) => normalizeFeature(feature)).filter(Boolean);
}

/**
 * Queries interactive place, store, landmark, address, and city suggestions via Mapbox Search Box API,
 * falling back to Geocoding v6 only if the Search Box endpoint itself is unavailable.
 */
export async function searchLocations({
  query,
  accessToken,
  proximity,
  limit = 8,
  sessionToken,
  signal,
}) {
  const trimmed = query?.trim();
  if (!trimmed) return [];
  assertValidToken(accessToken);

  const activeSessionToken = sessionToken || createSessionToken();
  const params = new URLSearchParams({
    q: trimmed,
    session_token: activeSessionToken,
    types: SEARCH_FEATURE_TYPES,
    limit: String(Math.min(Math.max(limit, 1), 10)),
    access_token: accessToken,
  });
  appendProximityParam(params, proximity);

  try {
    const data = await fetchMapboxJson(`${SEARCHBOX_BASE_URL}/suggest?${params.toString()}`, {
      signal,
      serviceName: 'Search Box',
    });

    return (data.suggestions || [])
      .filter((item) => item?.mapbox_id)
      .map((item, idx) => ({
        id: item.mapbox_id || `${item.name}-${idx}`,
        mapboxId: item.mapbox_id,
        sessionToken: activeSessionToken,
        name: item.name || item.full_address || 'Selected location',
        address: formatAddressText(item),
        featureType: item.feature_type || '',
        categoryLabel: extractCategoryLabel(item),
        distanceMeters: typeof item.distance === 'number' ? item.distance : null,
        coordinates: null,
        needsRetrieve: true,
      }));
  } catch (error) {
    if (shouldStopBeforeFallback(error)) {
      throw error;
    }
    return fetchGeocodeV6Fallback({
      query: trimmed,
      accessToken,
      proximity,
      limit: Math.min(limit, 10),
      signal,
    });
  }
}

/**
 * Resolves exact coordinates and details for a Search Box /suggest result via /retrieve.
 */
export async function retrieveLocation({ mapboxId, sessionToken, accessToken, signal }) {
  assertValidToken(accessToken);
  if (!mapboxId) {
    throw new MapboxServiceError('Missing location identifier.', {
      code: 'INVALID_INPUT',
      retryable: false,
    });
  }

  const params = new URLSearchParams({
    session_token: sessionToken || createSessionToken(),
    access_token: accessToken,
  });

  const data = await fetchMapboxJson(
    `${SEARCHBOX_BASE_URL}/retrieve/${encodeURIComponent(mapboxId)}?${params.toString()}`,
    { signal, serviceName: 'Place Details' },
  );

  return normalizeFeature(data?.features?.[0]) || null;
}

/**
 * Executes a direct one-shot search (with full coordinates) via Search Box /forward,
 * falling back to Geocoding v6 only if Search Box is unavailable.
 */
export async function searchForwardLocations({
  query,
  accessToken,
  proximity,
  limit = 5,
  signal,
}) {
  const trimmed = query?.trim();
  if (!trimmed) return [];
  assertValidToken(accessToken);

  const params = new URLSearchParams({
    q: trimmed,
    types: SEARCH_FEATURE_TYPES,
    limit: String(Math.min(Math.max(limit, 1), 10)),
    access_token: accessToken,
  });
  appendProximityParam(params, proximity);

  try {
    const data = await fetchMapboxJson(`${SEARCHBOX_BASE_URL}/forward?${params.toString()}`, {
      signal,
      serviceName: 'Location Search',
    });
    return (data.features || []).map((feature) => normalizeFeature(feature)).filter(Boolean);
  } catch (error) {
    if (shouldStopBeforeFallback(error)) {
      throw error;
    }
    return fetchGeocodeV6Fallback({ query: trimmed, accessToken, proximity, limit, signal });
  }
}

/**
 * Searches nearby POIs (stores, groceries, restaurants, cafes, fuel, etc.) using Mapbox Search Box /category.
 */
export async function searchCategoryPOIs({
  categoryId,
  accessToken,
  proximity,
  bbox,
  limit = 25,
  signal,
}) {
  assertValidToken(accessToken);
  if (!categoryId) return [];

  const params = new URLSearchParams({
    limit: String(Math.min(Math.max(limit, 1), 25)),
    access_token: accessToken,
  });
  appendProximityParam(params, proximity);
  appendValidBboxParam(params, bbox);

  const data = await fetchMapboxJson(
    `${SEARCHBOX_BASE_URL}/category/${encodeURIComponent(categoryId)}?${params.toString()}`,
    { signal, serviceName: 'Nearby Places' },
  );

  return (data.features || [])
    .map((feature) => normalizeFeature(feature, { categoryId }))
    .filter(Boolean);
}

/**
 * Finds POIs (fuel, food, ATMs, etc.) along the active route corridor within `maxCorridorMeters`.
 */
export async function searchAlongRoutePOIs({
  categoryId,
  routeCoordinates,
  accessToken,
  maxCorridorMeters = 800,
  signal,
}) {
  assertValidToken(accessToken);
  if (!categoryId || !Array.isArray(routeCoordinates) || routeCoordinates.length < 2) {
    return [];
  }

  const samplePoints = buildAlongRouteSamplePoints(routeCoordinates, 4);
  const responses = await Promise.all(
    samplePoints.map((pt) =>
      searchCategoryPOIs({
        categoryId,
        accessToken,
        proximity: pt,
        limit: 10,
        signal,
      }),
    ),
  );

  const byId = new Map();
  for (const list of responses) {
    for (const item of list) {
      if (!byId.has(item.id)) {
        byId.set(item.id, item);
      }
    }
  }

  return filterLocationsAlongRoute(
    Array.from(byId.values()),
    routeCoordinates,
    maxCorridorMeters,
  );
}
