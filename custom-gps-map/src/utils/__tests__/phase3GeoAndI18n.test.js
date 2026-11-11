import { describe, expect, it } from 'vitest';
import {
  buildMaxSpeedsArray,
  computePolylineDistanceMeters,
  filterLocationsAlongRoute,
  getSpeedLimitAtSegment,
  sortLocationsByDistance,
} from '../geo.js';
import { t } from '../i18n.js';

describe('Phase 3 geo enhancements (speed limits, drawn length, corridor filter)', () => {
  it('calculates polyline length across waypoints', () => {
    const len = computePolylineDistanceMeters([
      [0, 0],
      [0.01, 0],
    ]);
    expect(len).toBeGreaterThan(1000);
    expect(len).toBeLessThan(1200);
  });

  it('extracts and converts Directions maxspeed annotations accurately', () => {
    const maxSpeeds = buildMaxSpeedsArray([
      {
        annotation: {
          maxspeed: [
            { speed: 50, unit: 'km/h' },
            { speed: 45, unit: 'mph' },
            { unknown: true },
          ],
        },
      },
    ]);

    expect(maxSpeeds).toHaveLength(3);
    expect(getSpeedLimitAtSegment(maxSpeeds, 0, 3, 'metric')).toEqual({
      value: 50,
      unit: 'km/h',
      kmh: 50,
    });
    expect(getSpeedLimitAtSegment(maxSpeeds, 1, 3, 'imperial')?.value).toBe(45);
    expect(getSpeedLimitAtSegment(maxSpeeds, 2, 3, 'metric')).toBeNull();
  });

  it('filters POIs within corridor and sorts chronologically along route', () => {
    const route = [
      [0, 0],
      [0.02, 0],
    ];
    const places = [
      { id: 'far', name: 'Far Away', coordinates: [0.01, 0.03] }, // ~3.3 km off route
      { id: 'second', name: 'Mile 1 Fuel', coordinates: [0.015, 0.001] }, // ~111 m off route
      { id: 'first', name: 'Start Cafe', coordinates: [0.005, 0.001] }, // ~111 m off route
    ];

    const filtered = filterLocationsAlongRoute(places, route, 800);
    expect(filtered.map((p) => p.id)).toEqual(['first', 'second']);
  });

  it('sorts search candidates by distance', () => {
    const ref = [0, 0];
    const sorted = sortLocationsByDistance(
      [
        { id: 'b', coordinates: [0.05, 0] },
        { id: 'a', coordinates: [0.01, 0] },
      ],
      ref,
    );
    expect(sorted.map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('English & Hindi i18n scaffolding', () => {
  it('interpolates variables and switches locale cleanly', () => {
    expect(t('en', 'drawnLength', { dist: '1.2 km' })).toBe('Drawn: 1.2 km');
    expect(t('hi', 'drawnLength', { dist: '1.2 km' })).toBe('दूरी: 1.2 km');
    expect(t('hi', 'startNav')).toBe('शुरू करें');
  });
});
