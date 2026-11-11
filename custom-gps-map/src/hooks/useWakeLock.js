import { useCallback, useEffect, useState } from 'react';

/**
 * Keeps the screen awake during active turn-by-turn navigation via the Screen Wake Lock API,
 * re-acquiring automatically on tab `visibilitychange` and handling denial/release cleanly.
 */
export function useWakeLock(isActive) {
  const isSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

  const [status, setStatus] = useState(() => (isSupported ? 'idle' : 'unsupported'));
  const [wakeLockNotice, setWakeLockNotice] = useState(null);

  const dismissWakeLockNotice = useCallback(() => {
    setWakeLockNotice(null);
  }, []);

  useEffect(() => {
    if (!isSupported) return undefined;

    if (!isActive) {
      return undefined;
    }

    let sentinel = null;
    let disposed = false;

    const handleSentinelRelease = () => {
      sentinel = null;
      if (!disposed) {
        setStatus('idle');
      }
    };

    const requestLock = async () => {
      if (disposed) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }

      try {
        const nextSentinel = await navigator.wakeLock.request('screen');
        if (disposed) {
          nextSentinel.release().catch(() => {});
          return;
        }
        sentinel = nextSentinel;
        sentinel.addEventListener?.('release', handleSentinelRelease);
        setStatus('active');
        setWakeLockNotice(null);
      } catch (error) {
        if (disposed) return;
        const isPermissionDenied = error?.name === 'NotAllowedError';
        setStatus(isPermissionDenied ? 'denied' : 'idle');
        setWakeLockNotice(
          isPermissionDenied
            ? 'Screen Wake Lock was blocked by your browser or battery saver mode.'
            : null,
        );
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !sentinel && !disposed) {
        requestLock();
      }
    };

    requestLock();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (sentinel) {
        sentinel.removeEventListener?.('release', handleSentinelRelease);
        sentinel.release().catch(() => {});
        sentinel = null;
      }
    };
  }, [isActive, isSupported]);

  return {
    wakeLockStatus: isActive ? status : isSupported ? 'idle' : 'unsupported',
    wakeLockNotice: isActive ? wakeLockNotice : null,
    dismissWakeLockNotice,
  };
}
