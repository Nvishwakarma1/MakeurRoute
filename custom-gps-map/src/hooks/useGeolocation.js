import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildGeolocationErrorDetail,
  computeGpsTimeoutRetryDelayMs,
  detectGeolocationEnvironment,
  HIGH_ACCURACY_WATCH_OPTIONS,
  HUD_COMMIT_INTERVAL_MS,
  processRawGeolocationPosition,
  QUICK_FIRST_FIX_OPTIONS,
  RELAXED_WATCH_OPTIONS,
} from '../utils/geolocationHelpers.js';

export { MAX_SNAP_ACCURACY_METERS as MAX_GPS_ACCURACY_METERS } from '../utils/geolocationHelpers.js';

/**
 * Watches live device GPS coordinates cleanly across desktop, Android Chrome, iOS Safari, and PWAs:
 * - Verifies secure origin (`https://` / `localhost`) and checks `navigator.permissions` first.
 * - Acquires a fast coarse fix (`getCurrentPosition`) before starting high-accuracy `watchPosition`.
 * - Retries `TIMEOUT` cleanly with relaxed Wi-Fi/cell options and exponential backoff (no tight loops).
 * - Updates `positionRef` synchronously on every fix and throttles React HUD commits to ~1 Hz.
 * - Ignores fixes with `accuracy > 100 m` for route/puck snapping while retaining them for the accuracy halo.
 */
export function useGeolocation({ onValidLocationFix, enabled = true } = {}) {
  const env = detectGeolocationEnvironment();
  const isGeolocationSupported = env.isSupported;

  const [userLocation, setUserLocation] = useState(null);
  const [weakAccuracyMeters, setWeakAccuracyMeters] = useState(null);
  const [isLocating, setIsLocating] = useState(false);
  const [status, setStatus] = useState(() => {
    if (!env.isSupported || !env.isSecureContext) return 'unavailable';
    return enabled ? 'prompting' : 'idle';
  });
  const [geoError, setGeoError] = useState(() =>
    !env.isSupported || !env.isSecureContext ? buildGeolocationErrorDetail(null, env) : null,
  );
  const [watchGeneration, setWatchGeneration] = useState(0);

  const onValidFixRef = useRef(onValidLocationFix);
  const positionRef = useRef(null);
  const smoothingRefs = useRef({
    smoothedCoord: null,
    bearingAnchorCoord: null,
    smoothedHeading: null,
  });
  const lastCommitTimeRef = useRef(0);
  const pendingLocationRef = useRef(null);
  const throttleTimerRef = useRef(null);
  const watchActiveRef = useRef(false);

  useEffect(() => {
    onValidFixRef.current = onValidLocationFix;
  }, [onValidLocationFix]);

  const commitProcessedResult = useCallback((result, { forceImmediate = false } = {}) => {
    if (!result) return;
    const prevFix = positionRef.current;
    positionRef.current = result.fix;
    if (result.kind === 'accurate') {
      smoothingRefs.current = result.nextRefs;
    }

    const applyCommit = (fixToCommit) => {
      lastCommitTimeRef.current = Date.now();
      pendingLocationRef.current = null;
      setUserLocation(fixToCommit);
      setWeakAccuracyMeters(fixToCommit.isCoarse ? Math.round(fixToCommit.accuracy) : null);
      setStatus('granted');
      setGeoError(null);
      if (!fixToCommit.isCoarse) {
        onValidFixRef.current?.(fixToCommit);
      }
    };

    const modeSwitched = !prevFix || Boolean(prevFix.isCoarse) !== Boolean(result.fix.isCoarse);
    const now = Date.now();
    const elapsed = now - lastCommitTimeRef.current;

    if (forceImmediate || modeSwitched || lastCommitTimeRef.current === 0 || elapsed >= HUD_COMMIT_INTERVAL_MS) {
      if (throttleTimerRef.current) {
        window.clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
      applyCommit(result.fix);
      return;
    }

    pendingLocationRef.current = result.fix;
    if (!throttleTimerRef.current) {
      throttleTimerRef.current = window.setTimeout(() => {
        throttleTimerRef.current = null;
        if (pendingLocationRef.current) {
          applyCommit(pendingLocationRef.current);
        }
      }, HUD_COMMIT_INTERVAL_MS - elapsed);
    }
  }, []);

  /**
   * Explicitly requests an immediate location fix synchronously inside a user tap/click
   * gesture (required by iOS Safari / installed iOS PWA) and ensures watching restarts cleanly.
   */
  const requestLocation = useCallback(() => {
    const currentEnv = detectGeolocationEnvironment();
    if (!currentEnv.isSupported || !currentEnv.isSecureContext) {
      const detail = buildGeolocationErrorDetail(null, currentEnv);
      setStatus(detail.status);
      setGeoError(detail);
      return Promise.resolve(null);
    }

    setIsLocating(true);
    setGeoError(null);
    if (!positionRef.current) {
      setStatus('prompting');
    }

    return new Promise((resolve) => {
      try {
        navigator.geolocation.getCurrentPosition(
          (rawPosition) => {
            setIsLocating(false);
            const result = processRawGeolocationPosition(rawPosition, smoothingRefs.current);
            if (result) {
              commitProcessedResult(result, { forceImmediate: true });
              if (!watchActiveRef.current) {
                setWatchGeneration((prev) => prev + 1);
              }
              resolve(result.fix);
            } else {
              resolve(null);
            }
          },
          (err) => {
            setIsLocating(false);
            const detail = buildGeolocationErrorDetail(err, currentEnv);
            setStatus(detail.status);
            setGeoError(detail);
            if (err?.code !== 1 && !watchActiveRef.current) {
              setWatchGeneration((prev) => prev + 1);
            }
            resolve(null);
          },
          QUICK_FIRST_FIX_OPTIONS,
        );
      } catch (err) {
        setIsLocating(false);
        const detail = buildGeolocationErrorDetail(err, currentEnv);
        setStatus(detail.status);
        setGeoError(detail);
        resolve(null);
      }
    });
  }, [commitProcessedResult]);

  const retryGeolocation = useCallback(() => {
    const currentEnv = detectGeolocationEnvironment();
    if (!currentEnv.isSupported || !currentEnv.isSecureContext) {
      const detail = buildGeolocationErrorDetail(null, currentEnv);
      setStatus(detail.status);
      setGeoError(detail);
      return;
    }
    setGeoError(null);
    setStatus('prompting');
    setWatchGeneration((prev) => prev + 1);
    requestLocation();
  }, [requestLocation]);

  const dismissGeoError = useCallback(() => {
    setGeoError(null);
  }, []);

  useEffect(() => {
    const currentEnv = detectGeolocationEnvironment();
    if (!enabled || !currentEnv.isSupported || !currentEnv.isSecureContext) {
      watchActiveRef.current = false;
      return undefined;
    }

    let disposed = false;
    let activeWatchId = null;
    let retryTimerId = null;
    let permissionStatus = null;
    let timeoutAttempts = 0;

    const clearWatchAndRetry = () => {
      if (activeWatchId !== null) {
        navigator.geolocation.clearWatch(activeWatchId);
        activeWatchId = null;
      }
      watchActiveRef.current = false;
      if (retryTimerId !== null) {
        window.clearTimeout(retryTimerId);
        retryTimerId = null;
      }
    };

    const startWatch = (options = HIGH_ACCURACY_WATCH_OPTIONS) => {
      if (disposed) return;
      clearWatchAndRetry();

      watchActiveRef.current = true;
      activeWatchId = navigator.geolocation.watchPosition(
        (rawPosition) => {
          if (disposed) return;
          timeoutAttempts = 0;
          const result = processRawGeolocationPosition(rawPosition, smoothingRefs.current);
          if (result) {
            commitProcessedResult(result);
          }
        },
        (err) => {
          if (disposed) return;
          const detail = buildGeolocationErrorDetail(err, currentEnv);

          if (err?.code === 1) {
            clearWatchAndRetry();
            setStatus('denied');
            setGeoError(detail);
            return;
          }

          if (err?.code === 3) {
            // Avoid stalling permanently or tight-looping on indoor/desktop TIMEOUT
            clearWatchAndRetry();
            if (!positionRef.current) {
              setStatus('timeout');
              setGeoError(detail);
            }
            const delayMs = computeGpsTimeoutRetryDelayMs(timeoutAttempts);
            timeoutAttempts += 1;
            retryTimerId = window.setTimeout(() => {
              if (!disposed) {
                startWatch(RELAXED_WATCH_OPTIONS);
              }
            }, delayMs);
            return;
          }

          if (!positionRef.current) {
            setStatus(detail.status);
            setGeoError(detail);
          }
        },
        options,
      );
    };

    const beginQuickFixThenWatch = () => {
      if (disposed) return;
      if (positionRef.current) {
        startWatch(HIGH_ACCURACY_WATCH_OPTIONS);
        return;
      }
      try {
        navigator.geolocation.getCurrentPosition(
          (rawPosition) => {
            if (disposed) return;
            const result = processRawGeolocationPosition(rawPosition, smoothingRefs.current);
            if (result) {
              commitProcessedResult(result, { forceImmediate: true });
            }
            startWatch(HIGH_ACCURACY_WATCH_OPTIONS);
          },
          (err) => {
            if (disposed) return;
            if (err?.code === 1) {
              clearWatchAndRetry();
              setStatus('denied');
              setGeoError(buildGeolocationErrorDetail(err, currentEnv));
              return;
            }
            if (err?.code === 3) {
              if (!positionRef.current) {
                setStatus('timeout');
              }
              startWatch(RELAXED_WATCH_OPTIONS);
              return;
            }
            if (!positionRef.current) {
              const detail = buildGeolocationErrorDetail(err, currentEnv);
              setStatus(detail.status);
              setGeoError(detail);
            }
            startWatch(HIGH_ACCURACY_WATCH_OPTIONS);
          },
          QUICK_FIRST_FIX_OPTIONS,
        );
      } catch {
        startWatch(HIGH_ACCURACY_WATCH_OPTIONS);
      }
    };

    const handlePermissionChange = () => {
      if (disposed || !permissionStatus) return;
      if (permissionStatus.state === 'granted') {
        setGeoError(null);
        setStatus((prev) => (positionRef.current ? 'granted' : prev === 'denied' ? 'prompting' : prev));
        setWatchGeneration((prev) => prev + 1);
      } else if (permissionStatus.state === 'denied') {
        clearWatchAndRetry();
        setStatus('denied');
        setGeoError(buildGeolocationErrorDetail({ code: 1 }, currentEnv));
      }
    };

    if (typeof navigator.permissions?.query === 'function') {
      navigator.permissions
        .query({ name: 'geolocation' })
        .then((perm) => {
          if (disposed) return;
          permissionStatus = perm;
          permissionStatus.addEventListener?.('change', handlePermissionChange);

          if (perm.state === 'denied') {
            setStatus('denied');
            setGeoError(buildGeolocationErrorDetail({ code: 1 }, currentEnv));
            return;
          }

          if (perm.state === 'granted') {
            setStatus('granted');
          } else {
            setStatus('prompting');
          }
          beginQuickFixThenWatch();
        })
        .catch(() => {
          if (!disposed) {
            beginQuickFixThenWatch();
          }
        });
    } else {
      beginQuickFixThenWatch();
    }

    return () => {
      disposed = true;
      clearWatchAndRetry();
      permissionStatus?.removeEventListener?.('change', handlePermissionChange);
      if (throttleTimerRef.current) {
        window.clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
      pendingLocationRef.current = null;
    };
  }, [enabled, watchGeneration, commitProcessedResult]);

  return {
    isGeolocationSupported,
    status,
    position: userLocation,
    userLocation,
    positionRef,
    accuracy: userLocation?.accuracy ?? null,
    heading: userLocation?.heading ?? null,
    speed: userLocation?.speed ?? null,
    weakAccuracyMeters,
    isLocating,
    error: geoError,
    geoError,
    requestLocation,
    retryGeolocation,
    dismissGeoError,
  };
}
