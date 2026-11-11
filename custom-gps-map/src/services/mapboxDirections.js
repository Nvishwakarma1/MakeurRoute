import { buildNormalizedRoute, selectImportantWaypoints } from '../utils/geo.js';
import { fetchMapboxJson, MapboxServiceError } from './apiClient.js';

const MAPBOX_DIRECTIONS_URL = 'https://api.mapbox.com/directions/v5/mapbox';
export const MAX_DIRECTIONS_WAYPOINTS = 25;
export const MAX_ROUTE_ALTERNATIVES = 3; // Primary + up to 2 alternative routes

export const AVOID_OPTIONS = [
  { id: 'tolls', label: 'Tolls', mapboxValue: 'toll' },
  { id: 'highways', label: 'Highways', mapboxValue: 'motorway' },
  { id: 'ferries', label: 'Ferries', mapboxValue: 'ferry' },
];

/**
 * Builds profile-compatible Mapbox Directions `exclude` query values.
 * Tolls/motorways apply only to driving profiles; ferries apply to all supported profiles.
 */
export function buildDirectionsExcludeParam(avoid = {}, profile = 'driving') {
  const isDriving = profile === 'driving' || profile === 'driving-traffic';
  const excludes = [];

  if (isDriving && avoid?.tolls) excludes.push('toll');
  if (isDriving && avoid?.highways) excludes.push('motorway');
  if (avoid?.ferries) excludes.push('ferry');

  return excludes.length > 0 ? excludes.join(',') : null;
}

/**
 * Builds drivable/routable routes through ordered [lng, lat] waypoints via
 * Mapbox Directions API v5, returning normalized primary + up to 2 alternatives
 * when supported by waypoint count.
 */
export async function getDirectionsRoute({
  waypoints,
  accessToken,
  profile = 'driving',
  pinnedIndices = [],
  avoid = {},
  includeAlternatives = true,
  signal,
}) {
  if (!accessToken || accessToken === 'YOUR_MAPBOX_ACCESS_TOKEN') {
    throw new MapboxServiceError('Add a valid Mapbox access token before routing.', {
      code: 'MISSING_TOKEN',
      isAuthError: true,
      retryable: false,
    });
  }

  const selection = selectImportantWaypoints(
    waypoints,
    MAX_DIRECTIONS_WAYPOINTS,
    pinnedIndices,
  );
  const sampled = selection.waypoints;

  if (sampled.length < 2) {
    throw new MapboxServiceError('At least a start location and destination are required.', {
      code: 'INVALID_INPUT',
      retryable: false,
    });
  }

  const coordString = sampled.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';');
  const params = new URLSearchParams({
    geometries: 'geojson',
    overview: 'full',
    steps: 'true',
    access_token: accessToken,
  });

  if (profile === 'driving' || profile === 'driving-traffic') {
    params.set('annotations', 'maxspeed');
  }

  // Mapbox Directions supports alternatives=true cleanly on 2-waypoint origin->destination requests
  if (includeAlternatives && sampled.length === 2) {
    params.set('alternatives', 'true');
  }

  const excludeParam = buildDirectionsExcludeParam(avoid, profile);
  if (excludeParam) {
    params.set('exclude', excludeParam);
  }

  const url = `${MAPBOX_DIRECTIONS_URL}/${profile}/${coordString}?${params.toString()}`;
  const data = await fetchMapboxJson(url, { signal, serviceName: 'Directions' });

  const rawRoutes = Array.isArray(data.routes) ? data.routes.filter((r) => r?.geometry?.coordinates?.length >= 2) : [];
  if (data.code !== 'Ok' || rawRoutes.length === 0) {
    throw new MapboxServiceError(
      data.message || 'No drivable route found between the selected waypoints.',
      {
        code: data.code || 'NO_ROUTE',
        retryable: true,
      },
    );
  }

  let warning = null;
  if (selection.wasReduced) {
    warning = selection.droppedPinnedStops
      ? `Route had ${selection.originalCount} points and was thinned to Mapbox's ${MAX_DIRECTIONS_WAYPOINTS}-waypoint limit; start and destination are kept.`
      : `Route simplified from ${selection.originalCount} vertices to ${selection.keptCount} key points while preserving your start, end, and selected stops.`;
  }

  const normalizedRoutes = rawRoutes.slice(0, MAX_ROUTE_ALTERNATIVES).map((candidate, index) =>
    buildNormalizedRoute({
      coordinates: candidate.geometry.coordinates,
      legs: candidate.legs || [],
      distance: candidate.distance || 0,
      duration: candidate.duration || 0,
      durationTypical:
        typeof candidate.duration_typical === 'number' ? candidate.duration_typical : null,
      confidence: 1,
      subMatchCount: 1,
      warning: index === 0 ? warning : null,
    }),
  );

  return {
    ...normalizedRoutes[0],
    alternatives: normalizedRoutes,
  };
}
