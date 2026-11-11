import { projectPointOnRoute } from './geo.js';

export const OFF_ROUTE_THRESHOLD_METERS = 45;
export const OFF_ROUTE_CONFIRM_MS = 4000;
export const REROUTE_COOLDOWN_MS = 12000;

/**
 * Pure predicate deciding whether live off-route hysteresis + debounce cooldown
 * warrants triggering a Mapbox Directions reroute.
 */
export function shouldTriggerReroute({
  isNavigating = false,
  isDrawing = false,
  isEditingPath = false,
  isMatching = false,
  isRerouting = false,
  hasArrived = false,
  distanceToRouteMeters = 0,
  offRouteSinceMs = null,
  lastRerouteAtMs = 0,
  nowMs = Date.now(),
} = {}) {
  if (!isNavigating || isDrawing || isEditingPath || isMatching || isRerouting || hasArrived) {
    return false;
  }

  if (!Number.isFinite(distanceToRouteMeters) || distanceToRouteMeters <= OFF_ROUTE_THRESHOLD_METERS) {
    return false;
  }

  if (offRouteSinceMs == null || nowMs - offRouteSinceMs < OFF_ROUTE_CONFIRM_MS) {
    return false;
  }

  if (lastRerouteAtMs > 0 && nowMs - lastRerouteAtMs < REROUTE_COOLDOWN_MS) {
    return false;
  }

  return true;
}

/**
 * Builds the remaining [lng, lat] waypoint chain from the user's current position
 * through any unvisited user-added intermediate stops to the route destination.
 */
export function buildRemainingWaypointsForReroute({
  currentCoord,
  rawCoordinates = [],
  snappedRoute = null,
  pinnedStopIndices = [],
  distanceTraveledMeters = 0,
  routeSourceMode = 'matching',
} = {}) {
  if (!Array.isArray(currentCoord) || currentCoord.length < 2) {
    return { waypoints: [], pinnedIndices: [] };
  }

  // Pick final destination from snapped route end or raw polyline end
  const snappedCoords = snappedRoute?.geometry?.coordinates || [];
  const destination =
    rawCoordinates.length >= 2
      ? rawCoordinates[rawCoordinates.length - 1]
      : snappedCoords.length >= 2
        ? snappedCoords[snappedCoords.length - 1]
        : null;

  if (!destination) {
    return { waypoints: [], pinnedIndices: [] };
  }

  const intermediateStops = [];

  if (rawCoordinates.length > 2 && Array.isArray(pinnedStopIndices) && pinnedStopIndices.length > 0) {
    const uniqueSorted = Array.from(
      new Set(
        pinnedStopIndices.filter(
          (idx) => Number.isInteger(idx) && idx > 0 && idx < rawCoordinates.length - 1,
        ),
      ),
    ).sort((a, b) => a - b);

    const routeCoords = snappedCoords.length >= 2 ? snappedCoords : rawCoordinates;
    const cumDistances = snappedRoute?.cumulativeDistances;

    for (const idx of uniqueSorted) {
      const stopCoord = rawCoordinates[idx];
      if (!Array.isArray(stopCoord) || stopCoord.length < 2) continue;

      if (routeCoords.length >= 2 && cumDistances?.length === routeCoords.length) {
        const projected = projectPointOnRoute(stopCoord, routeCoords, cumDistances);
        if (projected && projected.distanceTraveledMeters <= distanceTraveledMeters + 25) {
          continue; // Stop has already been passed
        }
      }
      intermediateStops.push(stopCoord);
    }
  } else if (routeSourceMode === 'matching' && rawCoordinates.length > 2 && (!pinnedStopIndices || pinnedStopIndices.length === 0)) {
    // Preserve midpoint only if user drew a sharp detour and is before the first half
    const routeTotal = snappedRoute?.distance || 0;
    if (routeTotal > 300 && distanceTraveledMeters < routeTotal * 0.4) {
      const midIdx = Math.floor(rawCoordinates.length / 2);
      const midPoint = rawCoordinates[midIdx];
      if (
        Array.isArray(midPoint) &&
        snappedCoords.length >= 2 &&
        snappedRoute?.cumulativeDistances?.length === snappedCoords.length
      ) {
        const proj = projectPointOnRoute(midPoint, snappedCoords, snappedRoute.cumulativeDistances);
        if (proj && proj.distanceTraveledMeters > distanceTraveledMeters + 45) {
          intermediateStops.push(midPoint);
        }
      }
    }
  }

  const waypoints = [currentCoord, ...intermediateStops, destination];
  const pinnedIndices = waypoints.map((_, i) => i);

  return { waypoints, pinnedIndices };
}
