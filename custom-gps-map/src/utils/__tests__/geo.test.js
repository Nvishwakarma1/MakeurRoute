import { describe, expect, it } from 'vitest';
import {
  buildCumulativeDistances,
  buildNormalizedRoute,
  computeArrivalStatus,
  computeBearingDegrees,
  downsampleCoordinates,
  formatDistance,
  formatEtaClock,
  formatSignedDistanceDelta,
  formatSignedDurationDelta,
  formatSpeed,
  getNextNavigationStep,
  haversineDistanceMeters,
  isAccurateGpsFix,
  projectPointOnRoute,
  selectImportantWaypoints,
  smoothHeadingDegrees,
  smoothPosition,
} from '../geo.js';

describe('geo utilities', () => {
  it('computes cardinal compass bearings accurately', () => {
    const origin = [0, 0];
    expect(computeBearingDegrees(origin, [0, 0.01])).toBeCloseTo(0, 1);
    expect(computeBearingDegrees(origin, [0.01, 0])).toBeCloseTo(90, 1);
    expect(computeBearingDegrees(origin, [0, -0.01])).toBeCloseTo(180, 1);
    expect(computeBearingDegrees(origin, [-0.01, 0])).toBeCloseTo(270, 1);
  });

  it('downsamples long traces to maxPoints while keeping start and end coordinates', () => {
    const trace = Array.from({ length: 150 }, (_, i) => [i * 0.001, i * 0.0005]);
    const sampled = downsampleCoordinates(trace, 100);
    expect(sampled).toHaveLength(100);
    expect(sampled[0]).toEqual(trace[0]);
    expect(sampled[sampled.length - 1]).toEqual(trace[trace.length - 1]);
  });

  it('preserves user-chosen pinned stops when simplifying > 25 waypoints', () => {
    const trace = Array.from({ length: 40 }, (_, i) => [
      i * 0.001,
      i === 17 ? 0.012 : Math.sin(i * 0.25) * 0.0004,
    ]);
    const pinnedStop = trace[17];
    const result = selectImportantWaypoints(trace, 25, [17]);

    expect(result.wasReduced).toBe(true);
    expect(result.droppedPinnedStops).toBe(false);
    expect(result.waypoints).toHaveLength(25);
    expect(result.waypoints[0]).toEqual(trace[0]);
    expect(result.waypoints[result.waypoints.length - 1]).toEqual(trace[trace.length - 1]);
    expect(result.waypoints).toContainEqual(pinnedStop);
  });

  it('projects GPS points along the route and respects lastSegmentIndex near self-crossings', () => {
    // Out-and-back / self-crossing route: seg 0 goes north, seg 1 goes east, seg 2 crosses back near seg 0
    const coords = [
      [0, 0],
      [0, 0.002],
      [0.002, 0.002],
      [0, 0.00005],
    ];
    const cumulative = buildCumulativeDistances(coords);

    // Near start on segment 0 (slightly close to both seg 0 and seg 2)
    const proj = projectPointOnRoute([0.00008, 0.001], coords, cumulative, {
      lastSegmentIndex: 0,
    });

    expect(proj).not.toBeNull();
    expect(proj.segmentIndex).toBe(0);
    expect(proj.distanceTraveledMeters).toBeGreaterThan(80);
    expect(proj.remainingCoordinates.length).toBeGreaterThanOrEqual(2);
  });

  it('enforces monotonic step progression despite minor backward GPS jitter', () => {
    const route = buildNormalizedRoute({
      coordinates: [
        [0, 0],
        [0, 0.002],
        [0.002, 0.002],
      ],
      legs: [
        {
          steps: [
            { distance: 222, maneuver: { type: 'depart', instruction: 'Head north' } },
            { distance: 222, maneuver: { type: 'turn', modifier: 'right', instruction: 'Turn right' } },
            { distance: 0, maneuver: { type: 'arrive', instruction: 'Arrive' } },
          ],
        },
      ],
      distance: 444,
      duration: 60,
    });

    // User already reached stepIndex 2, GPS jitters slightly back to 150m (< 222m boundary)
    const next = getNextNavigationStep(route.steps, 150, 2);
    expect(next).not.toBeNull();
    expect(next.stepIndex).toBe(2);
    expect(next.step.maneuver.type).toBe('arrive');
  });

  it('detects arrival accurately on both short (<= 50m) and normal routes', () => {
    // Short 30m custom route: should not arrive at 0m traveled, should arrive near destination
    expect(
      computeArrivalStatus({
        totalDistanceMeters: 30,
        remainingDistanceMeters: 30,
        distanceToRouteMeters: 2,
        distanceTraveledMeters: 0,
        hasMovedFromStart: false,
      }),
    ).toBe(false);

    expect(
      computeArrivalStatus({
        totalDistanceMeters: 30,
        remainingDistanceMeters: 5,
        distanceToRouteMeters: 3,
        distanceTraveledMeters: 25,
        hasMovedFromStart: true,
      }),
    ).toBe(true);

    // Normal 500m route within final 20m
    expect(
      computeArrivalStatus({
        totalDistanceMeters: 500,
        remainingDistanceMeters: 12,
        distanceToRouteMeters: 6,
        distanceTraveledMeters: 488,
        hasMovedFromStart: true,
      }),
    ).toBe(true);
  });

  it('filters inaccurate GPS fixes and smooths headings smoothly across north (0/360)', () => {
    expect(isAccurateGpsFix(12, 50)).toBe(true);
    expect(isAccurateGpsFix(50, 50)).toBe(true);
    expect(isAccurateGpsFix(55, 50)).toBe(false);
    expect(isAccurateGpsFix(NaN, 50)).toBe(false);

    // Circular interpolation from 350 -> 10 by alpha=0.5 should equal 0 (North), not 180 (South)
    expect(smoothHeadingDegrees(350, 10, 0.5)).toBeCloseTo(0, 5);

    const start = [-122.4, 37.78];
    const slightStep = [-122.3999, 37.7801];
    const smoothed = smoothPosition(start, slightStep, 0.5);
    expect(haversineDistanceMeters(start, smoothed)).toBeLessThan(
      haversineDistanceMeters(start, slightStep),
    );
  });

  it('formats distances, speeds, route deltas, and ETA clock for metric/imperial and 12h/24h', () => {
    expect(formatDistance(1500, 'metric')).toBe('1.5 km');
    expect(formatDistance(1609.344, 'imperial')).toBe('1.0 mi');
    expect(formatDistance(90, 'imperial')).toBe('295 ft');

    expect(formatSpeed(10, 'metric')).toEqual({ value: 36, unit: 'km/h' });
    expect(formatSpeed(10, 'imperial')).toEqual({ value: 22, unit: 'mph' });

    expect(formatSignedDurationDelta(180)).toBe('+3 min');
    expect(formatSignedDurationDelta(10)).toBe('Same ETA');
    expect(formatSignedDistanceDelta(-500, 'metric')).toBe('-500 m');

    const baseMidnight = new Date(2026, 0, 1, 14, 5, 0).getTime();
    expect(formatEtaClock(600, '12h', baseMidnight)).toBe('2:15 PM');
    expect(formatEtaClock(600, '24h', baseMidnight)).toBe('14:15');
  });
});
