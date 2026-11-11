import { afterEach, describe, expect, it, vi } from 'vitest';
import { MapboxServiceError } from '../apiClient.js';
import {
  buildDirectionsExcludeParam,
  getDirectionsRoute,
  MAX_DIRECTIONS_WAYPOINTS,
} from '../mapboxDirections.js';

describe('mapboxDirections service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves pinned stops and emits a simplification warning when waypoints > 25', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'Ok',
          routes: [
            {
              distance: 2500,
              duration: 180,
              geometry: {
                type: 'LineString',
                coordinates: [
                  [0, 0],
                  [0.01, 0.01],
                ],
              },
              legs: [],
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const waypoints = Array.from({ length: 34 }, (_, i) => [i * 0.001, i * 0.0003]);
    const pinnedCoord = waypoints[12];
    const route = await getDirectionsRoute({
      waypoints,
      pinnedIndices: [12],
      accessToken: 'pk.testtoken123456',
    });

    const sentUrl = fetchSpy.mock.calls[0][0];
    const sentCoords = sentUrl.split('/driving/')[1].split('?')[0].split(';');
    expect(sentCoords).toHaveLength(MAX_DIRECTIONS_WAYPOINTS);
    expect(sentCoords).toContain(`${pinnedCoord[0].toFixed(6)},${pinnedCoord[1].toFixed(6)}`);
    expect(route.warning).toContain('34 vertices to 25 key points');
    expect(sentUrl).not.toContain('alternatives=true');
  });

  it('returns up to 2 alternative routes and passes traffic/exclude query params cleanly', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'Ok',
          routes: [
            {
              distance: 5000,
              duration: 420,
              duration_typical: 390,
              geometry: { type: 'LineString', coordinates: [[0, 0], [0.02, 0.02]] },
              legs: [],
            },
            {
              distance: 5600,
              duration: 480,
              geometry: { type: 'LineString', coordinates: [[0, 0], [0.03, 0.02]] },
              legs: [],
            },
            {
              distance: 6200,
              duration: 540,
              geometry: { type: 'LineString', coordinates: [[0, 0], [0.04, 0.02]] },
              legs: [],
            },
            {
              distance: 7000,
              duration: 600,
              geometry: { type: 'LineString', coordinates: [[0, 0], [0.05, 0.02]] },
              legs: [],
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const route = await getDirectionsRoute({
      waypoints: [
        [0, 0],
        [0.02, 0.02],
      ],
      profile: 'driving-traffic',
      avoid: { tolls: true, highways: true, ferries: true },
      accessToken: 'pk.testtoken123456',
    });

    const calledUrl = fetchSpy.mock.calls[0][0];
    expect(calledUrl).toContain('/driving-traffic/');
    expect(calledUrl).toContain('alternatives=true');
    expect(calledUrl).toContain('exclude=toll%2Cmotorway%2Cferry');
    expect(route.durationTypical).toBe(390);
    expect(route.alternatives).toHaveLength(3);
  });

  it('filters unsupported exclude flags when profile is walking or cycling', () => {
    expect(
      buildDirectionsExcludeParam({ tolls: true, highways: true, ferries: true }, 'driving-traffic'),
    ).toBe('toll,motorway,ferry');
    expect(
      buildDirectionsExcludeParam({ tolls: true, highways: true, ferries: true }, 'walking'),
    ).toBe('ferry');
    expect(buildDirectionsExcludeParam({ tolls: true }, 'cycling')).toBeNull();
  });

  it('maps 401 unauthorized token responses cleanly to MapboxServiceError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'Not Authorized - Invalid Token' }), { status: 401 }),
    );

    let caught = null;
    try {
      await getDirectionsRoute({
        waypoints: [
          [0, 0],
          [0.01, 0.01],
        ],
        accessToken: 'pk.invalidtoken1234',
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(MapboxServiceError);
    expect(caught.code).toBe('UNAUTHORIZED');
    expect(caught.isAuthError).toBe(true);
  });
});
