import { afterEach, describe, expect, it, vi } from 'vitest';
import { MapboxServiceError } from '../apiClient.js';
import { MAX_MATCHING_COORDINATES, snapRouteToRoads } from '../mapboxMatching.js';

describe('mapboxMatching service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('downsamples traces over 100 coordinates and builds a normalized route', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'Ok',
          tracepoints: new Array(MAX_MATCHING_COORDINATES).fill({ location: [0, 0] }),
          matchings: [
            {
              distance: 500,
              duration: 45,
              confidence: 0.92,
              geometry: {
                type: 'LineString',
                coordinates: [
                  [0, 0],
                  [0.002, 0.002],
                ],
              },
              legs: [
                {
                  steps: [
                    { distance: 500, maneuver: { type: 'depart', instruction: 'Go' } },
                    { distance: 0, maneuver: { type: 'arrive', instruction: 'Arrive' } },
                  ],
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const coords = Array.from({ length: 140 }, (_, i) => [i * 0.0001, i * 0.0001]);
    const route = await snapRouteToRoads({
      coordinates: coords,
      accessToken: 'pk.testtoken123456',
    });

    const calledUrl = fetchSpy.mock.calls[0][0];
    const coordSection = calledUrl.split('/driving/')[1].split('?')[0];
    expect(coordSection.split(';')).toHaveLength(MAX_MATCHING_COORDINATES);
    expect(route.distance).toBe(500);
    expect(route.warning).toBeNull();
  });

  it('returns highlighted failedSegments when Mapbox responds with NoSegment', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'NoSegment',
          message: 'Could not find a matching segment for input.',
          tracepoints: [null, null, { location: [0.003, 0.003] }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    let caught = null;
    try {
      await snapRouteToRoads({
        coordinates: [
          [0, 0],
          [0.001, 0.001],
          [0.003, 0.003],
        ],
        accessToken: 'pk.testtoken123456',
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(MapboxServiceError);
    expect(caught.code).toBe('NO_SEGMENT');
    expect(caught.details?.failedSegments?.length).toBeGreaterThan(0);
    expect(caught.details.failedSegments[0].geometry.type).toBe('LineString');
  });

  it('surfaces warnings for unmatched tracepoints and sub-matching gaps', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'Ok',
          tracepoints: [{ location: [0, 0] }, null, { location: [0.005, 0] }],
          matchings: [
            {
              distance: 100,
              duration: 12,
              confidence: 0.85,
              geometry: {
                type: 'LineString',
                coordinates: [
                  [0, 0],
                  [0.001, 0],
                ],
              },
              legs: [],
            },
            {
              distance: 120,
              duration: 14,
              confidence: 0.8,
              geometry: {
                type: 'LineString',
                coordinates: [
                  [0.004, 0],
                  [0.005, 0],
                ],
              },
              legs: [],
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const route = await snapRouteToRoads({
      coordinates: [
        [0, 0],
        [0.0025, 0.003],
        [0.005, 0],
      ],
      accessToken: 'pk.testtoken123456',
    });

    expect(route.unmatchedPointCount).toBe(1);
    expect(route.failedSegments).toHaveLength(1);
    expect(route.gapSegments).toHaveLength(1);
    expect(route.subMatchCount).toBe(2);
    expect(route.warning).toContain('excluded');
    expect(route.warning).toContain('disconnected road segments');
  });

  it('handles non-JSON 502 error responses without throwing SyntaxError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>502 Bad Gateway</html>', {
        status: 502,
        headers: { 'Content-Type': 'text/html' },
      }),
    );

    let caught = null;
    try {
      await snapRouteToRoads({
        coordinates: [
          [0, 0],
          [0.001, 0.001],
        ],
        accessToken: 'pk.testtoken123456',
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(MapboxServiceError);
    expect(caught.code).toBe('SERVER_ERROR');
    expect(caught.status).toBe(502);
    expect(caught.retryable).toBe(true);
  });
});
