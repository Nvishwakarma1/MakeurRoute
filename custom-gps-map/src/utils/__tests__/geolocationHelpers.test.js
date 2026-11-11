import { describe, expect, it } from 'vitest';
import {
  MAX_SNAP_ACCURACY_METERS,
  buildGeolocationErrorDetail,
  computeGpsTimeoutRetryDelayMs,
  isCoordOutsideMapBounds,
  processRawGeolocationPosition,
} from '../geolocationHelpers.js';

describe('geolocationHelpers', () => {
  describe('buildGeolocationErrorDetail', () => {
    it('reports unsupported browsers cleanly without retryability', () => {
      const detail = buildGeolocationErrorDetail(null, {
        isSupported: false,
        isSecureContext: true,
        isStandalone: false,
        platform: 'desktop',
      });
      expect(detail.code).toBe('UNSUPPORTED');
      expect(detail.status).toBe('unavailable');
      expect(detail.retryable).toBe(false);
    });

    it('reports insecure context when served over plain HTTP outside localhost', () => {
      const detail = buildGeolocationErrorDetail(null, {
        isSupported: true,
        isSecureContext: false,
        isStandalone: false,
        platform: 'android',
      });
      expect(detail.code).toBe('INSECURE_CONTEXT');
      expect(detail.status).toBe('unavailable');
      expect(detail.message).toContain('HTTPS');
      expect(detail.retryable).toBe(true);
    });

    it('provides platform-specific recovery messages when permission is denied', () => {
      const androidBrowser = buildGeolocationErrorDetail(
        { code: 1 },
        { isSupported: true, isSecureContext: true, isStandalone: false, platform: 'android' },
      );
      expect(androidBrowser.code).toBe('PERMISSION_DENIED');
      expect(androidBrowser.status).toBe('denied');
      expect(androidBrowser.message).toContain('Chrome Android');
      expect(androidBrowser.retryable).toBe(true);

      const androidPwa = buildGeolocationErrorDetail(
        { code: 1 },
        { isSupported: true, isSecureContext: true, isStandalone: true, platform: 'android' },
      );
      expect(androidPwa.message).toContain('installed Chrome Android PWA');

      const iosSafari = buildGeolocationErrorDetail(
        { code: 1 },
        { isSupported: true, isSecureContext: true, isStandalone: false, platform: 'ios' },
      );
      expect(iosSafari.message).toContain('iOS Safari');

      const iosPwa = buildGeolocationErrorDetail(
        { code: 1 },
        { isSupported: true, isSecureContext: true, isStandalone: true, platform: 'ios' },
      );
      expect(iosPwa.message).toContain('iOS Home Screen PWA');

      const desktop = buildGeolocationErrorDetail(
        { code: 'PERMISSION_DENIED' },
        { isSupported: true, isSecureContext: true, isStandalone: false, platform: 'desktop' },
      );
      expect(desktop.status).toBe('denied');
      expect(desktop.message).toContain('browser site settings');
    });

    it('maps POSITION_UNAVAILABLE and TIMEOUT errors to expected statuses', () => {
      const env = {
        isSupported: true,
        isSecureContext: true,
        isStandalone: false,
        platform: 'desktop',
      };

      const unavailable = buildGeolocationErrorDetail({ code: 2 }, env);
      expect(unavailable.code).toBe('POSITION_UNAVAILABLE');
      expect(unavailable.status).toBe('unavailable');
      expect(unavailable.retryable).toBe(true);

      const timeout = buildGeolocationErrorDetail({ code: 3 }, env);
      expect(timeout.code).toBe('TIMEOUT');
      expect(timeout.status).toBe('timeout');
      expect(timeout.retryable).toBe(true);
    });
  });

  describe('computeGpsTimeoutRetryDelayMs', () => {
    it('backs off exponentially and caps at 30000 ms', () => {
      expect(computeGpsTimeoutRetryDelayMs(0)).toBe(2000);
      expect(computeGpsTimeoutRetryDelayMs(1)).toBe(4000);
      expect(computeGpsTimeoutRetryDelayMs(2)).toBe(8000);
      expect(computeGpsTimeoutRetryDelayMs(3)).toBe(16000);
      expect(computeGpsTimeoutRetryDelayMs(4)).toBe(30000);
      expect(computeGpsTimeoutRetryDelayMs(8)).toBe(30000);
    });
  });

  describe('processRawGeolocationPosition', () => {
    it('rejects non-finite or out-of-range coordinates', () => {
      expect(processRawGeolocationPosition(null)).toBeNull();
      expect(
        processRawGeolocationPosition({
          coords: { latitude: Number.NaN, longitude: -122.4, accuracy: 10 },
        }),
      ).toBeNull();
      expect(
        processRawGeolocationPosition({
          coords: { latitude: 95, longitude: -122.4, accuracy: 10 },
        }),
      ).toBeNull();
      expect(
        processRawGeolocationPosition({
          coords: { latitude: 37.7, longitude: -181, accuracy: 10 },
        }),
      ).toBeNull();
    });

    it('marks accuracy > 100 m as coarse halo-only without mutating smoothing refs', () => {
      const prevRefs = {
        smoothedCoord: [-122.4194, 37.7749],
        bearingAnchorCoord: [-122.4194, 37.7749],
        smoothedHeading: 90,
      };
      const result = processRawGeolocationPosition(
        {
          coords: {
            latitude: 37.78,
            longitude: -122.41,
            accuracy: MAX_SNAP_ACCURACY_METERS + 150,
            heading: null,
            speed: null,
          },
          timestamp: 123456,
        },
        prevRefs,
      );

      expect(result).not.toBeNull();
      expect(result.kind).toBe('coarse');
      expect(result.fix.isCoarse).toBe(true);
      expect(result.fix.accuracy).toBe(250);
      expect(result.fix.latitude).toBe(37.78);
      expect(result.fix.longitude).toBe(-122.41);
      expect(result.nextRefs).toBe(prevRefs);
    });

    it('smooths <= 100 m fixes and derives heading from >= 3 m movement when native heading is absent', () => {
      const initial = processRawGeolocationPosition({
        coords: {
          latitude: 37.7749,
          longitude: -122.4194,
          accuracy: 15,
          heading: null,
          speed: 4.5,
        },
        timestamp: 1000,
      });

      expect(initial.kind).toBe('accurate');
      expect(initial.fix.isCoarse).toBe(false);
      expect(initial.fix.speed).toBe(4.5);
      expect(initial.nextRefs.smoothedCoord).toEqual([-122.4194, 37.7749]);

      // Move north ~22 m without native heading -> movement bearing ~0° (north)
      const moved = processRawGeolocationPosition(
        {
          coords: {
            latitude: 37.7751,
            longitude: -122.4194,
            accuracy: 12,
            heading: null,
            speed: 5,
          },
          timestamp: 2000,
        },
        initial.nextRefs,
      );

      expect(moved.kind).toBe('accurate');
      expect(moved.fix.isCoarse).toBe(false);
      expect(moved.fix.latitude).toBeGreaterThan(37.7749);
      expect(moved.fix.latitude).toBeLessThan(37.7751);
      expect(moved.fix.heading).toBeGreaterThanOrEqual(0);
      expect(moved.fix.heading).toBeLessThan(5);
    });

    it('uses native heading when provided and finite', () => {
      const result = processRawGeolocationPosition({
        coords: {
          latitude: 37.7749,
          longitude: -122.4194,
          accuracy: 8,
          heading: 135,
          speed: 3,
        },
        timestamp: 3000,
      });

      expect(result.kind).toBe('accurate');
      expect(result.fix.heading).toBe(135);
    });
  });

  describe('isCoordOutsideMapBounds', () => {
    it('detects off-screen coordinates and handles malformed inputs safely', () => {
      const bounds = {
        contains: ([lng, lat]) => lng >= -122.5 && lng <= -122.3 && lat >= 37.7 && lat <= 37.8,
      };
      expect(isCoordOutsideMapBounds(bounds, [-122.4, 37.75])).toBe(false);
      expect(isCoordOutsideMapBounds(bounds, [-122.1, 37.75])).toBe(true);
      expect(isCoordOutsideMapBounds(null, [-122.1, 37.75])).toBe(false);
      expect(isCoordOutsideMapBounds(bounds, [Number.NaN, 37.75])).toBe(false);
      expect(
        isCoordOutsideMapBounds(
          {
            contains: () => {
              throw new Error('bounds unavailable');
            },
          },
          [-122.1, 37.75],
        ),
      ).toBe(false);
    });
  });
});
