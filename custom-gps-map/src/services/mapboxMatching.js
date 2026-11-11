import {
  buildNormalizedRoute,
  downsampleCoordinates,
  haversineDistanceMeters,
} from '../utils/geo.js';
import { fetchMapboxJson, MapboxServiceError } from './apiClient.js';

const MAP_MATCHING_BASE_URL = 'https://api.mapbox.com/matching/v5/mapbox';
export const MAX_MATCHING_COORDINATES = 100;
export const SNAP_RADIUS_METERS = 50; // Maximum Mapbox Map Matching radius for hand-drawn lines
const SUB_MATCH_GAP_WARNING_METERS = 20;

/**
 * Extracts LineString GeoJSON features highlighting drawn stretches that could not
 * snap to roads (tracepoints === null in Mapbox Map Matching v5).
 */
export function buildUnmatchedSegmentFeatures(sampledCoords, tracepoints) {
  if (!Array.isArray(sampledCoords) || sampledCoords.length < 2) return [];

  // When tracepoints is missing/all-null (e.g. NoSegment), highlight the entire sampled trace
  if (!Array.isArray(tracepoints) || tracepoints.length !== sampledCoords.length) {
    return [
      {
        type: 'Feature',
        properties: { kind: 'no-segment' },
        geometry: {
          type: 'LineString',
          coordinates: sampledCoords,
        },
      },
    ];
  }

  const features = [];
  let currentRun = [];

  for (let i = 0; i < sampledCoords.length; i++) {
    const isUnmatched = tracepoints[i] === null;
    if (isUnmatched) {
      if (currentRun.length === 0 && i > 0) {
        currentRun.push(sampledCoords[i - 1]);
      }
      currentRun.push(sampledCoords[i]);
    } else if (currentRun.length > 0) {
      currentRun.push(sampledCoords[i]);
      if (currentRun.length >= 2) {
        features.push({
          type: 'Feature',
          properties: { kind: 'unmatched' },
          geometry: { type: 'LineString', coordinates: currentRun },
        });
      }
      currentRun = [];
    }
  }

  if (currentRun.length >= 2) {
    features.push({
      type: 'Feature',
      properties: { kind: 'unmatched' },
      geometry: { type: 'LineString', coordinates: currentRun },
    });
  } else if (currentRun.length === 1 && sampledCoords.length >= 2) {
    const last = sampledCoords.length - 1;
    features.push({
      type: 'Feature',
      properties: { kind: 'unmatched' },
      geometry: { type: 'LineString', coordinates: [sampledCoords[last - 1], sampledCoords[last]] },
    });
  }

  return features;
}

/**
 * Detects disconnected gaps between consecutive Map Matching sub-matchings.
 */
export function buildSubMatchGapFeatures(matchings) {
  if (!Array.isArray(matchings) || matchings.length < 2) {
    return { gapFeatures: [], maxGapMeters: 0 };
  }

  const gapFeatures = [];
  let maxGapMeters = 0;

  for (let i = 0; i < matchings.length - 1; i++) {
    const prevCoords = matchings[i]?.geometry?.coordinates;
    const nextCoords = matchings[i + 1]?.geometry?.coordinates;
    if (!prevCoords?.length || !nextCoords?.length) continue;

    const endCoord = prevCoords[prevCoords.length - 1];
    const startCoord = nextCoords[0];
    const gapMeters = haversineDistanceMeters(endCoord, startCoord);

    if (gapMeters > maxGapMeters) {
      maxGapMeters = gapMeters;
    }

    if (gapMeters >= SUB_MATCH_GAP_WARNING_METERS) {
      gapFeatures.push({
        type: 'Feature',
        properties: { kind: 'submatch-gap', gapMeters: Math.round(gapMeters) },
        geometry: {
          type: 'LineString',
          coordinates: [endCoord, startCoord],
        },
      });
    }
  }

  return { gapFeatures, maxGapMeters };
}

/**
 * Snaps raw drawn [lng, lat] coordinates to actual drivable/routable roads
 * via the Mapbox Map Matching API v5.
 */
export async function snapRouteToRoads({
  coordinates,
  accessToken,
  profile = 'driving',
  signal,
}) {
  if (!accessToken || accessToken === 'YOUR_MAPBOX_ACCESS_TOKEN') {
    throw new MapboxServiceError(
      'Add a valid Mapbox access token before snapping routes to roads.',
      { code: 'MISSING_TOKEN', isAuthError: true, retryable: false },
    );
  }

  const sampled = downsampleCoordinates(coordinates, MAX_MATCHING_COORDINATES);
  if (sampled.length < 2) {
    throw new MapboxServiceError('Draw at least two distinct points to create a route.', {
      code: 'INVALID_INPUT',
      retryable: false,
    });
  }

  const coordString = sampled.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';');
  const radiuses = sampled.map(() => SNAP_RADIUS_METERS).join(';');

  const params = new URLSearchParams({
    geometries: 'geojson',
    overview: 'full',
    steps: 'true',
    tidy: 'true',
    radiuses,
    access_token: accessToken,
  });

  const url = `${MAP_MATCHING_BASE_URL}/${profile}/${coordString}?${params.toString()}`;
  const data = await fetchMapboxJson(url, { signal, serviceName: 'Map Matching' });

  if (data.code !== 'Ok' || !Array.isArray(data.matchings) || data.matchings.length === 0) {
    const failedSegments = buildUnmatchedSegmentFeatures(sampled, data.tracepoints);
    if (data.code === 'NoSegment') {
      throw new MapboxServiceError(
        'Highlighted drawn points are >50 m from a drivable road. Drag vertices closer to roads.',
        {
          code: 'NO_SEGMENT',
          retryable: true,
          details: { failedSegments },
        },
      );
    }
    throw new MapboxServiceError(
      data.message ||
        'Could not match your drawn line to roads. Adjust the highlighted segment closer to streets.',
      {
        code: data.code || 'MATCH_FAILED',
        retryable: true,
        details: { failedSegments },
      },
    );
  }

  // Merge sub-matchings sequentially if Mapbox split the trace into multiple matched segments
  const mergedCoords = [];
  const mergedLegs = [];
  let totalDistance = 0;
  let totalDuration = 0;
  let confidenceSum = 0;

  for (const matching of data.matchings) {
    const segCoords = matching.geometry?.coordinates || [];
    for (let i = 0; i < segCoords.length; i++) {
      const pt = segCoords[i];
      const prev = mergedCoords[mergedCoords.length - 1];
      if (!prev || prev[0] !== pt[0] || prev[1] !== pt[1]) {
        mergedCoords.push(pt);
      }
    }

    totalDistance += matching.distance || 0;
    totalDuration += matching.duration || 0;
    confidenceSum += matching.confidence || 0;
    mergedLegs.push(...(matching.legs || []));
  }

  if (mergedCoords.length < 2) {
    const failedSegments = buildUnmatchedSegmentFeatures(sampled, data.tracepoints);
    throw new MapboxServiceError(
      'Matched route geometry was empty. Try drawing closer to connected roads.',
      {
        code: 'EMPTY_MATCH',
        retryable: true,
        details: { failedSegments },
      },
    );
  }

  const unmatchedPointCount = Array.isArray(data.tracepoints)
    ? data.tracepoints.filter((tp) => tp === null).length
    : 0;
  const failedSegments =
    unmatchedPointCount > 0 ? buildUnmatchedSegmentFeatures(sampled, data.tracepoints) : [];
  const { gapFeatures, maxGapMeters } = buildSubMatchGapFeatures(data.matchings);

  const avgConfidence = confidenceSum / data.matchings.length;
  const warningParts = [];
  if (unmatchedPointCount > 0) {
    warningParts.push(
      `${unmatchedPointCount} off-road point${unmatchedPointCount === 1 ? ' was' : 's were'} highlighted in dashed red and excluded`,
    );
  }
  if (gapFeatures.length > 0) {
    warningParts.push(
      `${data.matchings.length} disconnected road segments (max ${Math.round(maxGapMeters)} m gap) were joined`,
    );
  }

  return buildNormalizedRoute({
    coordinates: mergedCoords,
    legs: mergedLegs,
    distance: totalDistance,
    duration: totalDuration,
    confidence: avgConfidence,
    subMatchCount: data.matchings.length,
    warning: warningParts.length > 0 ? `${warningParts.join('. ')}.` : null,
    failedSegments,
    gapSegments: gapFeatures,
    unmatchedPointCount,
  });
}
