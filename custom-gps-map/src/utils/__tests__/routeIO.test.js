import { describe, expect, it } from 'vitest';
import {
  decodePolyline5,
  decodeRouteFromHash,
  encodePolyline5,
  encodeRouteToHash,
  exportRouteToGeoJson,
  exportRouteToGpx,
  importRouteFromGeoJson,
  importRouteFromGpx,
  MAX_SHARE_HASH_LENGTH,
} from '../routeIO.js';

describe('GPX export & import', () => {
  it('round-trips coordinates, waypoints, and XML-escaped names cleanly', () => {
    const gpx = exportRouteToGpx({
      name: 'Bypass & Ridge <Route>',
      rawCoordinates: [
        [-74.0, 40.7],
        [-73.98, 40.72],
        [-73.95, 40.74],
      ],
      pinnedStopIndices: [0, 2],
      snappedRoute: {
        geometry: {
          type: 'LineString',
          coordinates: [
            [-74.0, 40.7],
            [-73.985, 40.715],
            [-73.95, 40.74],
          ],
        },
      },
    });

    expect(gpx).toContain('Bypass &amp; Ridge &lt;Route&gt;');
    const parsed = importRouteFromGpx(gpx);
    expect(parsed.name).toBe('Bypass & Ridge <Route>');
    expect(parsed.coordinates).toHaveLength(3);
    expect(parsed.coordinates[0]).toEqual([-74, 40.7]);
    expect(parsed.coordinates[2]).toEqual([-73.95, 40.74]);
  });

  it('rejects empty or non-GPX payloads with clear error', () => {
    expect(() => importRouteFromGpx('<html>not gpx</html>')).toThrow(/GPX/i);
  });
});

describe('GeoJSON export & import', () => {
  it('exports RFC 7946 FeatureCollection and parses back coordinates', () => {
    const json = exportRouteToGeoJson({
      name: 'Evening Bypass',
      rawCoordinates: [
        [77.5946, 12.9716],
        [77.61, 12.98],
      ],
      pinnedStopIndices: [0, 1],
      snappedRoute: {
        distance: 2100,
        duration: 240,
        geometry: {
          type: 'LineString',
          coordinates: [
            [77.5946, 12.9716],
            [77.601, 12.975],
            [77.61, 12.98],
          ],
        },
      },
    });

    const parsed = importRouteFromGeoJson(json);
    expect(parsed.name).toBe('Evening Bypass');
    expect(parsed.coordinates).toHaveLength(3);
  });
});

describe('URL share hash & polyline5 compression', () => {
  it('encodes and decodes polyline5 coordinates accurately', () => {
    const sample = [
      [-122.4194, 37.7749],
      [-122.4094, 37.7849],
    ];
    const poly = encodePolyline5(sample);
    const decoded = decodePolyline5(poly);
    expect(decoded).toHaveLength(2);
    expect(decoded[0][0]).toBeCloseTo(sample[0][0], 4);
    expect(decoded[0][1]).toBeCloseTo(sample[0][1], 4);
  });

  it('automatically downsamples oversized routes to stay within QR/URL length budget', () => {
    const denseCoords = Array.from({ length: 600 }, (_, i) => [
      -74.0 + i * 0.001,
      40.7 + Math.sin(i * 0.1) * 0.01,
    ]);
    const encoded = encodeRouteToHash({
      coordinates: denseCoords,
      routeSourceMode: 'matching',
      profile: 'driving-traffic',
      name: 'Long Bypass',
    });

    expect(encoded.hash.length).toBeLessThanOrEqual(MAX_SHARE_HASH_LENGTH);
    expect(encoded.wasSimplified).toBe(true);

    const decoded = decodeRouteFromHash(encoded.hash);
    expect(decoded.name).toBe('Long Bypass');
    expect(decoded.profile).toBe('driving-traffic');
    expect(decoded.routeSourceMode).toBe('matching');
    expect(decoded.coordinates.length).toBeGreaterThanOrEqual(2);
    expect(decoded.coordinates.length).toBeLessThan(denseCoords.length);
  });
});
