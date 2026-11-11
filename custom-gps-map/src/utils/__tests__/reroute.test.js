import { describe, expect, it } from 'vitest';
import { buildNormalizedRoute } from '../geo.js';
import {
  buildRemainingWaypointsForReroute,
  OFF_ROUTE_CONFIRM_MS,
  REROUTE_COOLDOWN_MS,
  shouldTriggerReroute,
} from '../reroute.js';

describe('reroute logic', () => {
  it('enforces off-route confirmation window and cooldown debounce', () => {
    const base = {
      isNavigating: true,
      isDrawing: false,
      isEditingPath: false,
      isMatching: false,
      isRerouting: false,
      hasArrived: false,
      distanceToRouteMeters: 62,
      offRouteSinceMs: 10_000,
      lastRerouteAtMs: 0,
    };

    // Too early (only 2s off-route < 4s confirm threshold)
    expect(shouldTriggerReroute({ ...base, nowMs: 12_000 })).toBe(false);

    // Sustained off-route past confirm threshold triggers reroute
    expect(
      shouldTriggerReroute({ ...base, nowMs: 10_000 + OFF_ROUTE_CONFIRM_MS }),
    ).toBe(true);

    // Within cooldown window after previous reroute -> suppresses thrashing
    expect(
      shouldTriggerReroute({
        ...base,
        lastRerouteAtMs: 20_000,
        nowMs: 20_000 + REROUTE_COOLDOWN_MS - 1000,
      }),
    ).toBe(false);

    // Past cooldown window -> allows next reroute
    expect(
      shouldTriggerReroute({
        ...base,
        lastRerouteAtMs: 20_000,
        nowMs: 20_000 + REROUTE_COOLDOWN_MS,
      }),
    ).toBe(true);

    // Never reroute if within <= 45m corridor or paused/arrived
    expect(
      shouldTriggerReroute({ ...base, distanceToRouteMeters: 40, nowMs: 20_000 }),
    ).toBe(false);
    expect(
      shouldTriggerReroute({ ...base, hasArrived: true, nowMs: 20_000 }),
    ).toBe(false);
  });

  it('preserves remaining unvisited user stops and drops already passed stops', () => {
    const start = [0, 0];
    const stopPassed = [0, 0.002]; // ~222m along route
    const stopUpcoming = [0, 0.008]; // ~890m along route
    const destination = [0, 0.012]; // ~1334m along route

    const route = buildNormalizedRoute({
      coordinates: [start, stopPassed, stopUpcoming, destination],
      distance: 1334,
      duration: 120,
    });

    const currentCoord = [0.001, 0.004]; // ~444m along route, past stopPassed
    const { waypoints, pinnedIndices } = buildRemainingWaypointsForReroute({
      currentCoord,
      rawCoordinates: [start, stopPassed, stopUpcoming, destination],
      snappedRoute: route,
      pinnedStopIndices: [0, 1, 2, 3],
      distanceTraveledMeters: 444,
      routeSourceMode: 'directions',
    });

    expect(waypoints).toEqual([currentCoord, stopUpcoming, destination]);
    expect(pinnedIndices).toEqual([0, 1, 2]);
  });
});
