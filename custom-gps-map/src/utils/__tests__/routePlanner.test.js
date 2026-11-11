import { describe, expect, it } from 'vitest';
import {
  isRoundTripCoordinates,
  removeWaypointAtIndex,
  reorderWaypointList,
  toggleRoundTripWaypoints,
} from '../routePlanner.js';

describe('Multi-stop route planner helpers', () => {
  const waypoints = [
    [77.59, 12.97],
    [77.6, 12.98],
    [77.62, 12.99],
  ];

  it('reorders waypoints safely and keeps all stops pinned', () => {
    const { coordinates, pinnedStopIndices } = reorderWaypointList(waypoints, [0, 1, 2], 1, 2);
    expect(coordinates).toEqual([waypoints[0], waypoints[2], waypoints[1]]);
    expect(pinnedStopIndices).toEqual([0, 1, 2]);
  });

  it('removes stop only while >= 2 points remain', () => {
    const res = removeWaypointAtIndex(waypoints, 1);
    expect(res.coordinates).toEqual([waypoints[0], waypoints[2]]);
    expect(removeWaypointAtIndex([waypoints[0], waypoints[2]], 0)).toBeNull();
  });

  it('toggles round-trip return to start cleanly', () => {
    expect(isRoundTripCoordinates(waypoints)).toBe(false);

    const enabled = toggleRoundTripWaypoints(waypoints);
    expect(enabled.isRoundTrip).toBe(true);
    expect(enabled.coordinates).toHaveLength(4);
    expect(enabled.coordinates[3]).toEqual(waypoints[0]);
    expect(isRoundTripCoordinates(enabled.coordinates)).toBe(true);

    const disabled = toggleRoundTripWaypoints(enabled.coordinates);
    expect(disabled.isRoundTrip).toBe(false);
    expect(disabled.coordinates).toEqual(waypoints);
  });
});
