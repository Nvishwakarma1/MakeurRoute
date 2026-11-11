import { describe, expect, it } from 'vitest';
import {
  classifyMapboxResourceKind,
  computeLiteBoundsAroundCoord,
  formatMapTileError,
  getRateLimitBackoffMs,
  isTelemetryBlockedUrl,
  shouldRecomputeLiteBounds,
  shouldUpdateFollowCamera,
} from '../mapOptimization.js';
import {
  FALLBACK_SATELLITE_STYLE,
  MAP_STYLES,
  MAP_THEME_ORDER,
  STANDARD_SATELLITE_CONFIG,
  STANDARD_SATELLITE_STYLE,
} from '../../hooks/useMapStyle.js';
import { DEFAULT_PREFERENCES, TOKEN_STORAGE_KEY } from '../../store/navigationContext.js';

describe('mapOptimization', () => {
  it('sets show3dObjects to false and retains road/POI/place labels in Standard config', () => {
    expect(STANDARD_SATELLITE_CONFIG.basemap.show3dObjects).toBe(false);
    expect(STANDARD_SATELLITE_CONFIG.basemap.showPointOfInterestLabels).toBe(true);
    expect(STANDARD_SATELLITE_CONFIG.basemap.showPlaceLabels).toBe(true);
    expect(STANDARD_SATELLITE_CONFIG.basemap.showRoadLabels).toBe(true);
    expect(STANDARD_SATELLITE_CONFIG.basemap.showRoadsAndTransit).toBe(true);
  });

  it('throttles follow camera easeTo unless moved >10 m, >=2 s passed, or mode synced', () => {
    const origin = [-122.4194, 37.7749];
    // ~3 m north (< 10 m) and only 1000 ms later (< 2000 ms) -> skip
    const minorStep = [-122.4194, 37.774927];
    expect(
      shouldUpdateFollowCamera({
        hasCenteredInitially: true,
        followUser: true,
        isDrawing: false,
        isEditingPath: false,
        isRateLimitPaused: false,
        prevCameraCoord: origin,
        nextCoord: minorStep,
        prevUpdateAtMs: 10_000,
        nowMs: 11_000,
      }),
    ).toBe('skip');

    // >= 2000 ms elapsed -> ease even for tiny move
    expect(
      shouldUpdateFollowCamera({
        hasCenteredInitially: true,
        followUser: true,
        isDrawing: false,
        isEditingPath: false,
        isRateLimitPaused: false,
        prevCameraCoord: origin,
        nextCoord: minorStep,
        prevUpdateAtMs: 10_000,
        nowMs: 12_000,
      }),
    ).toBe('ease');

    // ~22 m north (> 10 m) inside < 2 s -> ease
    const largerMove = [-122.4194, 37.7751];
    expect(
      shouldUpdateFollowCamera({
        hasCenteredInitially: true,
        followUser: true,
        isDrawing: false,
        isEditingPath: false,
        isRateLimitPaused: false,
        prevCameraCoord: origin,
        nextCoord: largerMove,
        prevUpdateAtMs: 10_000,
        nowMs: 10_500,
      }),
    ).toBe('ease');

    // During 429 rate-limit pause -> strictly skip camera easeTo
    expect(
      shouldUpdateFollowCamera({
        hasCenteredInitially: true,
        followUser: true,
        isDrawing: false,
        isEditingPath: false,
        isRateLimitPaused: true,
        prevCameraCoord: origin,
        nextCoord: largerMove,
        prevUpdateAtMs: 10_000,
        nowMs: 15_000,
        forceSync: true,
      }),
    ).toBe('skip');

    // When followUser is false before initial GPS centering, never hijack manual pan/search camera
    expect(
      shouldUpdateFollowCamera({
        hasCenteredInitially: false,
        followUser: false,
        isDrawing: false,
        isEditingPath: false,
        isRateLimitPaused: false,
        prevCameraCoord: null,
        nextCoord: origin,
        prevUpdateAtMs: 0,
        nowMs: 15_000,
      }),
    ).toBe('skip');
  });

  it('computes ~15 km Lite bounds and recomputes only after >3 km movement', () => {
    const center = [-73.9857, 40.7484];
    const bounds = computeLiteBoundsAroundCoord(center, 15_000);
    expect(bounds).toHaveLength(2);
    expect(bounds[0][0]).toBeLessThan(center[0]);
    expect(bounds[1][0]).toBeGreaterThan(center[0]);
    expect(bounds[0][1]).toBeLessThan(center[1]);
    expect(bounds[1][1]).toBeGreaterThan(center[1]);

    // Move ~1.1 km -> stays inside 3 km threshold (do not recompute bounds)
    expect(shouldRecomputeLiteBounds(center, [-73.9857, 40.7584], 3000)).toBe(false);
    // Move ~4.4 km -> exceeds 3 km threshold (recompute bounds)
    expect(shouldRecomputeLiteBounds(center, [-73.9857, 40.7884], 3000)).toBe(true);
  });

  it('uses capped exponential backoff starting at 10s for 429 pauses', () => {
    expect(getRateLimitBackoffMs(0)).toBe(10_000);
    expect(getRateLimitBackoffMs(1)).toBe(20_000);
    expect(getRateLimitBackoffMs(2)).toBe(40_000);
    expect(getRateLimitBackoffMs(3)).toBe(80_000);
    expect(getRateLimitBackoffMs(4)).toBe(80_000);
  });

  it('distinguishes telemetry noise from /styles/, /fonts/, and /v4/ tile errors', () => {
    expect(isTelemetryBlockedUrl('https://events.mapbox.com/events/v2')).toBe(true);
    expect(isTelemetryBlockedUrl('https://api.mapbox.com/v4/mapbox.satellite/1/0/0.webp')).toBe(
      false,
    );

    expect(
      classifyMapboxResourceKind('https://api.mapbox.com/styles/v1/mapbox/standard-satellite')
        .requiredScope,
    ).toBe('styles:read');
    expect(
      classifyMapboxResourceKind('https://api.mapbox.com/fonts/v1/mapbox/DIN/0-255.pbf')
        .requiredScope,
    ).toBe('fonts:read');
    expect(
      classifyMapboxResourceKind('https://api.mapbox.com/v4/mapbox.satellite/14/4823/6160.webp')
        .requiredScope,
    ).toBe('styles:tiles');

    const forbiddenTiles = formatMapTileError(
      {
        status: 403,
        url: 'https://api.mapbox.com/v4/mapbox.satellite/14/4823/6160.webp',
        message: 'Forbidden',
      },
      { origin: 'http://localhost:5173', hasStoredTokenOverride: false },
    );
    expect(forbiddenTiles.isAuthError).toBe(true);
    expect(forbiddenTiles.message).toContain('styles:tiles');
    expect(forbiddenTiles.message).toContain('http://localhost:5173');
  });

  it('defines satellite fallback styles, cycling order, Lite defaults, and single token storage key', () => {
    expect(STANDARD_SATELLITE_STYLE).toBe('mapbox://styles/mapbox/standard-satellite');
    expect(FALLBACK_SATELLITE_STYLE).toBe('mapbox://styles/mapbox/satellite-streets-v12');
    expect(MAP_STYLES.satelliteFallback).toBe(FALLBACK_SATELLITE_STYLE);
    expect(MAP_THEME_ORDER).toEqual(['satellite', 'night', 'day']);
    expect(TOKEN_STORAGE_KEY).toBe('takeurroute_mapbox_token');
    expect(DEFAULT_PREFERENCES.liteModeEnabled).toBe(true);
    expect(DEFAULT_PREFERENCES.navLightStyleEnabled).toBe(false);
  });
});
