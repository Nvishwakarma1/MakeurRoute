import { haversineDistanceMeters } from './geo.js';

const ROUND_TRIP_THRESHOLD_METERS = 25;

/**
 * Checks whether a waypoint sequence starts and returns to essentially the same origin point.
 */
export function isRoundTripCoordinates(coordinates = []) {
  if (!Array.isArray(coordinates) || coordinates.length < 3) return false;
  return (
    haversineDistanceMeters(coordinates[0], coordinates[coordinates.length - 1]) <=
    ROUND_TRIP_THRESHOLD_METERS
  );
}

/**
 * Moves a waypoint from `fromIndex` to `toIndex`, keeping start, intermediate stops, and destination pinned.
 */
export function reorderWaypointList(coordinates = [], pinnedStopIndices = [], fromIndex, toIndex) {
  if (
    !Array.isArray(coordinates) ||
    coordinates.length < 2 ||
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= coordinates.length ||
    toIndex >= coordinates.length
  ) {
    return {
      coordinates,
      pinnedStopIndices,
    };
  }

  const nextCoords = [...coordinates];
  const [moved] = nextCoords.splice(fromIndex, 1);
  nextCoords.splice(toIndex, 0, moved);

  const nextPinned = nextCoords.map((_, idx) => idx);
  return {
    coordinates: nextCoords,
    pinnedStopIndices: nextPinned,
  };
}

/**
 * Removes a stop at `removeIndex` when at least 2 waypoints will remain.
 */
export function removeWaypointAtIndex(coordinates = [], removeIndex) {
  if (!Array.isArray(coordinates) || coordinates.length <= 2) {
    return null;
  }
  if (removeIndex < 0 || removeIndex >= coordinates.length) {
    return null;
  }
  const nextCoords = coordinates.filter((_, idx) => idx !== removeIndex);
  return {
    coordinates: nextCoords,
    pinnedStopIndices: nextCoords.map((_, idx) => idx),
  };
}

/**
 * Toggles returning to origin (`[lng, lat]` equal to start) for round-trip planning.
 */
export function toggleRoundTripWaypoints(coordinates = []) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return { coordinates, isRoundTrip: false };
  }

  if (isRoundTripCoordinates(coordinates)) {
    const trimmed = coordinates.slice(0, -1);
    return {
      coordinates: trimmed,
      pinnedStopIndices: trimmed.map((_, idx) => idx),
      isRoundTrip: false,
    };
  }

  const nextCoords = [...coordinates, [...coordinates[0]]];
  return {
    coordinates: nextCoords,
    pinnedStopIndices: nextCoords.map((_, idx) => idx),
    isRoundTrip: true,
  };
}
