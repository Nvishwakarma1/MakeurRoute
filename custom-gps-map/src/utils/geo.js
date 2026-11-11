const EARTH_RADIUS_METERS = 6371000;
const METERS_PER_DEGREE_LAT = 111320;

const toRadians = (deg) => (deg * Math.PI) / 180;
const toDegrees = (rad) => (rad * 180) / Math.PI;

/**
 * Computes the great-circle distance in meters between two [lng, lat] coordinates.
 */
export function haversineDistanceMeters(coordA, coordB) {
  const [lng1, lat1] = coordA;
  const [lng2, lat2] = coordB;

  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const radLat1 = toRadians(lat1);
  const radLat2 = toRadians(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(radLat1) * Math.cos(radLat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Computes the compass bearing in degrees [0, 360) from coordA to coordB.
 */
export function computeBearingDegrees(coordA, coordB) {
  const [lng1, lat1] = coordA;
  const [lng2, lat2] = coordB;

  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const deltaLambda = toRadians(lng2 - lng1);

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Checks whether a browser Geolocation accuracy value meets the navigation quality threshold.
 */
export function isAccurateGpsFix(accuracyMeters, maxAccuracyMeters = 50) {
  return (
    typeof accuracyMeters === 'number' &&
    Number.isFinite(accuracyMeters) &&
    accuracyMeters >= 0 &&
    accuracyMeters <= maxAccuracyMeters
  );
}

/**
 * Exponentially smooths [lng, lat] GPS coordinates to dampen small standstill/urban jitter
 * while snapping cleanly if a large cold-start jump (> 250 m) occurs.
 */
export function smoothPosition(prevCoords, nextCoords, alpha = 0.55) {
  if (!Array.isArray(nextCoords) || nextCoords.length < 2) return prevCoords || null;
  if (!Array.isArray(prevCoords) || prevCoords.length < 2) return nextCoords;

  const jumpMeters = haversineDistanceMeters(prevCoords, nextCoords);
  if (!Number.isFinite(jumpMeters) || jumpMeters > 250 || jumpMeters < 0.25) {
    return nextCoords;
  }

  return [
    prevCoords[0] + alpha * (nextCoords[0] - prevCoords[0]),
    prevCoords[1] + alpha * (nextCoords[1] - prevCoords[1]),
  ];
}

/**
 * Circular low-pass filter for compass/GPS heading angles in [0, 360).
 */
export function smoothHeadingDegrees(prevHeading, nextHeading, alpha = 0.35) {
  if (!Number.isFinite(nextHeading)) {
    return Number.isFinite(prevHeading) ? ((prevHeading % 360) + 360) % 360 : 0;
  }
  const normalizedNext = ((nextHeading % 360) + 360) % 360;
  if (!Number.isFinite(prevHeading)) {
    return normalizedNext;
  }
  const normalizedPrev = ((prevHeading % 360) + 360) % 360;
  let delta = normalizedNext - normalizedPrev;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;

  return (((normalizedPrev + alpha * delta) % 360) + 360) % 360;
}

/**
 * Builds cumulative vertex distances in meters for a LineString coordinate array.
 */
export function buildCumulativeDistances(coordinates) {
  if (!coordinates?.length) return [];
  const cumulative = new Array(coordinates.length);
  cumulative[0] = 0;
  for (let i = 1; i < coordinates.length; i++) {
    cumulative[i] = cumulative[i - 1] + haversineDistanceMeters(coordinates[i - 1], coordinates[i]);
  }
  return cumulative;
}

function deduplicateWithPinnedIndices(coordinates, pinnedIndices = []) {
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return { deduped: [], pinnedSet: new Set() };
  }

  const pinnedRaw = new Set(
    (pinnedIndices || []).filter(
      (idx) => Number.isInteger(idx) && idx >= 0 && idx < coordinates.length,
    ),
  );

  const deduped = [coordinates[0]];
  const pinnedSet = new Set([0]); // Always preserve start point

  for (let i = 1; i < coordinates.length; i++) {
    const prev = deduped[deduped.length - 1];
    const curr = coordinates[i];
    const isDistinct = Math.abs(curr[0] - prev[0]) > 1e-6 || Math.abs(curr[1] - prev[1]) > 1e-6;

    if (isDistinct) {
      deduped.push(curr);
      if (pinnedRaw.has(i) || i === coordinates.length - 1) {
        pinnedSet.add(deduped.length - 1);
      }
    } else if (pinnedRaw.has(i) || i === coordinates.length - 1) {
      pinnedSet.add(deduped.length - 1);
    }
  }

  pinnedSet.add(deduped.length - 1); // Always preserve end point
  return { deduped, pinnedSet };
}

function perpendicularDistanceMeters(point, segStart, segEnd) {
  const [pLng, pLat] = point;
  const [aLng, aLat] = segStart;
  const [bLng, bLat] = segEnd;
  const metersPerDegLng = METERS_PER_DEGREE_LAT * Math.max(0.01, Math.cos(toRadians(pLat)));

  const dx = (bLng - aLng) * metersPerDegLng;
  const dy = (bLat - aLat) * METERS_PER_DEGREE_LAT;
  const px = (pLng - aLng) * metersPerDegLng;
  const py = (pLat - aLat) * METERS_PER_DEGREE_LAT;

  const segLenSq = dx * dx + dy * dy;
  if (segLenSq <= 0) return Math.hypot(px, py);
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / segLenSq));
  const projX = t * dx;
  const projY = t * dy;
  return Math.hypot(px - projX, py - projY);
}

/**
 * Deduplicates consecutive identical points and downsamples to <= maxPoints
 * while preserving the start and end coordinates for Mapbox Map Matching API.
 */
export function downsampleCoordinates(coordinates, maxPoints = 100) {
  if (!Array.isArray(coordinates) || coordinates.length === 0) return [];
  if (maxPoints <= 0) return [];

  const { deduped } = deduplicateWithPinnedIndices(coordinates);
  if (deduped.length <= maxPoints) return deduped;
  if (maxPoints === 1) return [deduped[0]];

  const sampled = [];
  const lastIndex = deduped.length - 1;
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.round((i * lastIndex) / (maxPoints - 1));
    sampled.push(deduped[idx]);
  }
  return sampled;
}

/**
 * Selects up to maxPoints waypoints from a route trace without silently dropping
 * user-chosen stops. Retains geometric corners via Ramer-Douglas-Peucker deviation scoring.
 */
export function selectImportantWaypoints(coordinates, maxPoints = 25, pinnedIndices = []) {
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return {
      waypoints: [],
      originalCount: 0,
      keptCount: 0,
      wasReduced: false,
      droppedPinnedStops: false,
    };
  }

  const { deduped, pinnedSet } = deduplicateWithPinnedIndices(coordinates, pinnedIndices);
  const originalCount = coordinates.length;

  if (deduped.length <= maxPoints) {
    return {
      waypoints: deduped,
      originalCount,
      keptCount: deduped.length,
      wasReduced: false,
      droppedPinnedStops: false,
    };
  }

  const pinnedList = Array.from(pinnedSet).sort((a, b) => a - b);

  // If even pinned stops + endpoints exceed maxPoints, thin pinned stops while keeping endpoints
  if (pinnedList.length >= maxPoints) {
    const selectedIndices = [0];
    const interiorBudget = Math.max(0, maxPoints - 2);
    const interiorPinned = pinnedList.slice(1, -1);

    if (interiorBudget > 0 && interiorPinned.length > 0) {
      for (let i = 0; i < interiorBudget; i++) {
        const pick = Math.round((i * (interiorPinned.length - 1)) / Math.max(1, interiorBudget - 1));
        selectedIndices.push(interiorPinned[pick]);
      }
    }
    if (deduped.length - 1 !== 0 && maxPoints >= 2) {
      selectedIndices.push(deduped.length - 1);
    }

    const uniqueSorted = Array.from(new Set(selectedIndices)).sort((a, b) => a - b);
    return {
      waypoints: uniqueSorted.map((idx) => deduped[idx]),
      originalCount,
      keptCount: uniqueSorted.length,
      wasReduced: true,
      droppedPinnedStops: pinnedList.length > maxPoints,
    };
  }

  // Keep all pinned vertices and greedily insert the most significant intermediate corners
  const kept = new Set(pinnedList);

  while (kept.size < maxPoints) {
    const sortedKept = Array.from(kept).sort((a, b) => a - b);
    let bestIdx = -1;
    let bestDist = -1;

    for (let k = 0; k < sortedKept.length - 1; k++) {
      const startIdx = sortedKept[k];
      const endIdx = sortedKept[k + 1];
      if (endIdx - startIdx <= 1) continue;

      const segStart = deduped[startIdx];
      const segEnd = deduped[endIdx];
      for (let i = startIdx + 1; i < endIdx; i++) {
        const d = perpendicularDistanceMeters(deduped[i], segStart, segEnd);
        if (d > bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
    }

    if (bestIdx === -1) break;
    kept.add(bestIdx);
  }

  const finalIndices = Array.from(kept).sort((a, b) => a - b);
  return {
    waypoints: finalIndices.map((idx) => deduped[idx]),
    originalCount,
    keptCount: finalIndices.length,
    wasReduced: true,
    droppedPinnedStops: false,
  };
}

function projectOntoSegmentRange(point, coordinates, startIdx, endIdx, metersPerDegLng) {
  const [pLng, pLat] = point;
  let bestDistance = Infinity;
  let bestIndex = startIdx;
  let bestT = 0;
  let bestPoint = coordinates[startIdx];

  for (let i = startIdx; i <= endIdx; i++) {
    const [aLng, aLat] = coordinates[i];
    const [bLng, bLat] = coordinates[i + 1];

    const dx = (bLng - aLng) * metersPerDegLng;
    const dy = (bLat - aLat) * METERS_PER_DEGREE_LAT;
    const px = (pLng - aLng) * metersPerDegLng;
    const py = (pLat - aLat) * METERS_PER_DEGREE_LAT;

    const segLenSq = dx * dx + dy * dy;
    const rawT = segLenSq > 0 ? (px * dx + py * dy) / segLenSq : 0;
    const t = Math.max(0, Math.min(1, rawT));

    const projLng = aLng + t * (bLng - aLng);
    const projLat = aLat + t * (bLat - aLat);
    const dist = Math.hypot((pLng - projLng) * metersPerDegLng, (pLat - projLat) * METERS_PER_DEGREE_LAT);

    if (dist < bestDistance) {
      bestDistance = dist;
      bestIndex = i;
      bestT = t;
      bestPoint = [projLng, projLat];
    }
  }

  return { bestDistance, bestIndex, bestT, bestPoint };
}

/**
 * Projects a live GPS [lng, lat] point onto a polyline and computes progress metrics
 * plus split coordinate arrays for traveled vs remaining route rendering.
 * Supports optional `lastSegmentIndex` locality bias to prevent premature jumps across loops/overpasses.
 */
export function projectPointOnRoute(point, coordinates, cumulativeDistances, options = {}) {
  if (!point || !coordinates || coordinates.length < 2 || !cumulativeDistances?.length) {
    return null;
  }

  const [, pLat] = point;
  const metersPerDegLng = METERS_PER_DEGREE_LAT * Math.max(0.01, Math.cos(toRadians(pLat)));
  const maxSegIndex = coordinates.length - 2;

  const hasHint =
    Number.isInteger(options.lastSegmentIndex) &&
    options.lastSegmentIndex >= 0 &&
    options.lastSegmentIndex <= maxSegIndex;

  let chosen;
  if (hasHint) {
    const windowStart = Math.max(0, options.lastSegmentIndex - 3);
    const windowEnd = Math.min(maxSegIndex, options.lastSegmentIndex + 30);
    const localMatch = projectOntoSegmentRange(
      point,
      coordinates,
      windowStart,
      windowEnd,
      metersPerDegLng,
    );

    if (localMatch.bestDistance <= 45) {
      chosen = localMatch;
    } else {
      const globalMatch = projectOntoSegmentRange(point, coordinates, 0, maxSegIndex, metersPerDegLng);
      chosen = globalMatch.bestDistance + 12 < localMatch.bestDistance ? globalMatch : localMatch;
    }
  } else {
    chosen = projectOntoSegmentRange(point, coordinates, 0, maxSegIndex, metersPerDegLng);
  }

  const { bestDistance, bestIndex, bestT, bestPoint } = chosen;
  const totalDistanceMeters = cumulativeDistances[cumulativeDistances.length - 1] || 0;
  const segStartDist = cumulativeDistances[bestIndex] || 0;
  const segEndDist = cumulativeDistances[bestIndex + 1] ?? segStartDist;
  const distanceTraveledMeters = segStartDist + bestT * (segEndDist - segStartDist);
  const remainingDistanceMeters = Math.max(0, totalDistanceMeters - distanceTraveledMeters);
  const progressRatio = totalDistanceMeters > 0 ? Math.min(1, distanceTraveledMeters / totalDistanceMeters) : 0;

  const traveledCoordinates = coordinates.slice(0, bestIndex + 1);
  if (bestT > 0) {
    traveledCoordinates.push(bestPoint);
  }

  const remainingCoordinates =
    bestT < 1 ? [bestPoint, ...coordinates.slice(bestIndex + 1)] : coordinates.slice(bestIndex + 1);

  return {
    snappedPoint: bestPoint,
    segmentIndex: bestIndex,
    distanceToRouteMeters: bestDistance,
    distanceTraveledMeters,
    remainingDistanceMeters,
    totalDistanceMeters,
    progressRatio,
    traveledCoordinates: traveledCoordinates.length >= 2 ? traveledCoordinates : [coordinates[0], bestPoint],
    remainingCoordinates:
      remainingCoordinates.length >= 2 ? remainingCoordinates : [bestPoint, coordinates[coordinates.length - 1]],
  };
}

/**
 * Evaluates whether the user has arrived at the route destination, handling both
 * short custom routes (<= 50 m) and normal multi-segment routes cleanly.
 */
export function computeArrivalStatus({
  totalDistanceMeters = 0,
  remainingDistanceMeters = Infinity,
  distanceToRouteMeters = 0,
  distanceTraveledMeters = 0,
  hasMovedFromStart = false,
} = {}) {
  if (!Number.isFinite(totalDistanceMeters) || totalDistanceMeters <= 0) {
    return false;
  }

  if (totalDistanceMeters <= 50) {
    const threshold = Math.max(6, Math.min(20, totalDistanceMeters * 0.35));
    const meaningfulProgress =
      hasMovedFromStart || distanceTraveledMeters >= totalDistanceMeters * 0.55;
    return meaningfulProgress && remainingDistanceMeters <= threshold && distanceToRouteMeters <= 35;
  }

  return remainingDistanceMeters < 20 && distanceToRouteMeters <= 40;
}

/**
 * Determines the upcoming turn-by-turn maneuver along the matched route.
 * Each Mapbox step covers travel up to the following step's maneuver location.
 * Supports monotonic `minStepIndex` clamping to avoid backward flickers from GPS jitter.
 */
export function getNextNavigationStep(steps, distanceTraveledMeters, minStepIndex = 0) {
  if (!steps?.length) return null;

  let naturalStepIndex = steps.length - 1;
  for (let i = 0; i < steps.length - 1; i++) {
    const step = steps[i];
    if (distanceTraveledMeters < step.endDistanceMeters) {
      naturalStepIndex = i + 1;
      break;
    }
  }

  const clampedTargetIndex = Math.min(
    steps.length - 1,
    Math.max(naturalStepIndex, Number.isInteger(minStepIndex) ? minStepIndex : 0),
  );

  if (clampedTargetIndex >= steps.length - 1 && naturalStepIndex >= steps.length - 1) {
    const lastStep = steps[steps.length - 1];
    return {
      step: lastStep,
      stepIndex: steps.length - 1,
      nextFollowingStep: null,
      distanceToManeuverMeters: 0,
      isFinalArrival: true,
    };
  }

  const activeLegIdx = Math.max(0, clampedTargetIndex - 1);
  const currentLeg = steps[activeLegIdx];
  const nextStep = steps[clampedTargetIndex];
  const nextFollowingStep = clampedTargetIndex + 1 < steps.length ? steps[clampedTargetIndex + 1] : null;

  return {
    step: nextStep,
    stepIndex: clampedTargetIndex,
    nextFollowingStep,
    distanceToManeuverMeters: Math.max(0, currentLeg.endDistanceMeters - distanceTraveledMeters),
    isFinalArrival: nextStep.maneuver?.type === 'arrive',
  };
}

/**
 * Computes an LngLatBounds pair [[minLng, minLat], [maxLng, maxLat]] for fitBounds.
 */
export function getCoordinatesBounds(coordinates) {
  if (!coordinates?.length) return null;

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const [lng, lat] of coordinates) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }

  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

/**
 * Builds a GeoJSON Polygon approximating a circle of radiusMeters around [lng, lat].
 */
export function createAccuracyCircleGeoJSON(longitude, latitude, radiusMeters, steps = 48) {
  const safeRadius = Math.max(1, radiusMeters || 1);
  const latScale = safeRadius / METERS_PER_DEGREE_LAT;
  const lngScale = safeRadius / (METERS_PER_DEGREE_LAT * Math.max(0.01, Math.cos(toRadians(latitude))));

  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    ring.push([longitude + Math.cos(angle) * lngScale, latitude + Math.sin(angle) * latScale]);
  }

  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [ring],
    },
  };
}

export function formatDistance(meters, unitSystem = 'metric') {
  if (meters == null || Number.isNaN(meters)) return '--';

  if (unitSystem === 'imperial') {
    const feet = meters * 3.28084;
    const miles = meters / 1609.344;
    if (miles < 0.1) return `${Math.round(feet)} ft`;
    return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
  }

  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

export function formatSpeed(speedMps, unitSystem = 'metric') {
  const safeSpeed = speedMps != null && Number.isFinite(speedMps) ? Math.max(0, speedMps) : 0;
  if (unitSystem === 'imperial') {
    return { value: Math.round(safeSpeed * 2.23694), unit: 'mph' };
  }
  return { value: Math.round(safeSpeed * 3.6), unit: 'km/h' };
}

export function formatDuration(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return '--';
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins > 0 ? `${hours} hr ${mins} min` : `${hours} hr`;
}

export function formatSignedDurationDelta(deltaSeconds) {
  if (deltaSeconds == null || !Number.isFinite(deltaSeconds)) return 'Same ETA';
  const mins = Math.round(deltaSeconds / 60);
  if (mins === 0) return 'Same ETA';
  return mins > 0 ? `+${mins} min` : `${mins} min`;
}

export function formatSignedDistanceDelta(deltaMeters, unitSystem = 'metric') {
  if (deltaMeters == null || !Number.isFinite(deltaMeters)) return '';
  if (Math.abs(deltaMeters) < 30) return 'Same dist';
  const sign = deltaMeters > 0 ? '+' : '-';
  return `${sign}${formatDistance(Math.abs(deltaMeters), unitSystem)}`;
}

export function formatEtaClock(remainingSeconds, timeFormat = '12h', nowMs = Date.now()) {
  if (remainingSeconds == null || !Number.isFinite(remainingSeconds)) return '--';
  const arrivalDate = new Date(nowMs + Math.max(0, remainingSeconds) * 1000);
  const hours24 = arrivalDate.getHours();
  const minutes = String(arrivalDate.getMinutes()).padStart(2, '0');

  if (timeFormat === '24h') {
    return `${String(hours24).padStart(2, '0')}:${minutes}`;
  }

  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${minutes} ${period}`;
}

export function computePolylineDistanceMeters(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < coordinates.length; i++) {
    total += haversineDistanceMeters(coordinates[i - 1], coordinates[i]);
  }
  return total;
}

/**
 * Extracts normalized km/h speed limit values (or null if unknown/none) from Mapbox Directions leg annotations.
 */
export function buildMaxSpeedsArray(legs = []) {
  const speeds = [];
  for (const leg of legs) {
    const rawList = leg?.annotation?.maxspeed;
    if (!Array.isArray(rawList)) continue;
    for (const item of rawList) {
      if (!item || item.unknown || item.none || typeof item.speed !== 'number') {
        speeds.push(null);
      } else if (item.unit === 'mph') {
        speeds.push(item.speed * 1.609344);
      } else {
        speeds.push(item.speed);
      }
    }
  }
  return speeds;
}

/**
 * Resolves the active speed limit for the current projected segment in metric or imperial units.
 */
export function getSpeedLimitAtSegment(
  maxSpeeds,
  segmentIndex,
  totalSegments,
  unitSystem = 'metric',
) {
  if (!Array.isArray(maxSpeeds) || maxSpeeds.length === 0 || segmentIndex == null) {
    return null;
  }

  let idx = Math.max(0, Math.round(segmentIndex));
  if (totalSegments > 0 && maxSpeeds.length !== totalSegments) {
    idx = Math.round((idx / Math.max(1, totalSegments - 1)) * (maxSpeeds.length - 1));
  }
  idx = Math.min(maxSpeeds.length - 1, Math.max(0, idx));

  const kmh = maxSpeeds[idx];
  if (typeof kmh !== 'number' || !Number.isFinite(kmh) || kmh <= 0) {
    return null;
  }

  if (unitSystem === 'imperial') {
    return {
      value: Math.round(kmh * 0.621371),
      unit: 'mph',
      kmh,
    };
  }
  return {
    value: Math.round(kmh),
    unit: 'km/h',
    kmh,
  };
}

/**
 * Samples evenly spaced [lng, lat] corridor checkpoints along a route for POI search-along-route queries.
 */
export function buildAlongRouteSamplePoints(coordinates, maxSamples = 6) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return [];
  if (coordinates.length <= maxSamples) return coordinates;
  const samples = [];
  for (let i = 0; i < maxSamples; i++) {
    const idx = Math.round((i / (maxSamples - 1)) * (coordinates.length - 1));
    samples.push(coordinates[idx]);
  }
  return samples;
}

/**
 * Projects POI results onto the active route corridor and returns matches within `maxCorridorMeters`,
 * ordered progressively from route start to finish.
 */
export function filterLocationsAlongRoute(places, routeCoordinates, maxCorridorMeters = 800) {
  if (!Array.isArray(places) || !Array.isArray(routeCoordinates) || routeCoordinates.length < 2) {
    return [];
  }
  const cumDistances = buildCumulativeDistances(routeCoordinates);
  const matches = [];

  for (const place of places) {
    if (!place?.coordinates || place.coordinates.length < 2) continue;
    const proj = projectPointOnRoute(place.coordinates, routeCoordinates, cumDistances);
    if (proj && proj.distanceToRouteMeters <= maxCorridorMeters) {
      matches.push({
        ...place,
        distanceFromRouteMeters: proj.distanceToRouteMeters,
        distanceAlongRouteMeters: proj.distanceTraveledMeters,
      });
    }
  }

  return matches.sort((a, b) => a.distanceAlongRouteMeters - b.distanceAlongRouteMeters);
}

/**
 * Enriches and sorts candidate places by straight-line proximity to `referenceCoord`.
 */
export function sortLocationsByDistance(places, referenceCoord) {
  if (!Array.isArray(places)) return [];

  return places
    .map((place) => {
      const dist =
        referenceCoord &&
        referenceCoord.length >= 2 &&
        Array.isArray(place.coordinates) &&
        place.coordinates.length >= 2
          ? haversineDistanceMeters(referenceCoord, place.coordinates)
          : place.distanceMeters ?? Infinity;
      return {
        ...place,
        computedDistanceMeters: Number.isFinite(dist) ? dist : null,
      };
    })
    .sort((a, b) => (a.computedDistanceMeters ?? Infinity) - (b.computedDistanceMeters ?? Infinity));
}

/**
 * Normalizes route coordinates and Mapbox step distances onto a unified
 * cumulative-distance timeline for live progress tracking.
 */
export function buildNormalizedRoute({
  coordinates,
  legs = [],
  distance = 0,
  duration = 0,
  durationTypical = null,
  confidence = 1,
  subMatchCount = 1,
  warning = null,
  failedSegments = [],
  gapSegments = [],
  unmatchedPointCount = 0,
}) {
  const mergedSteps = [];
  let runningStepDistance = 0;

  for (const leg of legs) {
    for (const step of leg.steps || []) {
      const stepDist = step.distance || 0;
      mergedSteps.push({
        ...step,
        startDistanceMeters: runningStepDistance,
        endDistanceMeters: runningStepDistance + stepDist,
      });
      runningStepDistance += stepDist;
    }
  }

  const cumulativeDistances = buildCumulativeDistances(coordinates);
  const geometryDistance = cumulativeDistances[cumulativeDistances.length - 1] || 0;
  const distanceScale =
    geometryDistance > 0 && runningStepDistance > 0 ? geometryDistance / runningStepDistance : 1;

  const normalizedSteps = mergedSteps.map((step) => ({
    ...step,
    startDistanceMeters: step.startDistanceMeters * distanceScale,
    endDistanceMeters: step.endDistanceMeters * distanceScale,
  }));

  const legsSummary = legs.map((leg, index) => ({
    index,
    distance: leg.distance || 0,
    duration: leg.duration || 0,
    summary: leg.summary || '',
  }));

  const maxSpeeds = buildMaxSpeedsArray(legs);

  return {
    geometry: {
      type: 'LineString',
      coordinates,
    },
    distance: distance || geometryDistance,
    duration,
    durationTypical,
    confidence,
    steps: normalizedSteps,
    legsSummary,
    maxSpeeds,
    cumulativeDistances,
    subMatchCount,
    warning,
    failedSegments,
    gapSegments,
    unmatchedPointCount,
  };
}
