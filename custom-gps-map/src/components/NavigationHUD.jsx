import { useEffect, useState } from 'react';
import { POI_CATEGORIES } from '../services/mapboxGeocoding.js';
import {
  computePolylineDistanceMeters,
  formatDistance,
  formatDuration,
  formatEtaClock,
  formatSignedDistanceDelta,
  formatSignedDurationDelta,
  formatSpeed,
} from '../utils/geo.js';
import { t } from '../utils/i18n.js';
import LocationSearch from './LocationSearch.jsx';

const MAP_STYLE_LABELS = {
  satellite: 'Sat',
  night: 'Night',
  day: 'Day',
};

const PROFILE_OPTIONS = [
  { id: 'driving-traffic', label: 'Traffic' },
  { id: 'driving', label: 'Drive' },
  { id: 'cycling', label: 'Cycle' },
  { id: 'walking', label: 'Walk' },
];

function ManeuverIcon({ type, modifier, size = 'lg' }) {
  const dim = size === 'sm' ? 'h-4 w-4' : 'h-6 w-6';

  if (type === 'arrive') {
    return (
      <svg viewBox="0 0 24 24" className={`${dim} text-emerald-400`} fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z" />
        <circle cx="12" cy="9" r="2.5" />
      </svg>
    );
  }

  const mod = modifier || '';
  if (mod.includes('left')) {
    return (
      <svg viewBox="0 0 24 24" className={`${dim} text-teal-300`} fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 7 4 12l5 5" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 12h11a4 4 0 0 1 4 4v4" />
      </svg>
    );
  }

  if (mod.includes('right')) {
    return (
      <svg viewBox="0 0 24 24" className={`${dim} text-teal-300`} fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="m15 7 5 5-5 5" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H9a4 4 0 0 0-4 4v4" />
      </svg>
    );
  }

  if (mod.includes('uturn')) {
    return (
      <svg viewBox="0 0 24 24" className={`${dim} text-amber-300`} fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 14 5 18l4 4" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 18V9a6 6 0 1 1 12 0v9" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className={`${dim} text-teal-300`} fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0-5 5m5-5 5 5" />
    </svg>
  );
}

function getGpsChipInfo({ geoStatus, userLocation, weakAccuracyMeters, isLocating }) {
  if (geoStatus === 'denied') {
    return {
      label: 'Denied',
      dotClass: 'bg-rose-400',
      badgeClass: 'border-rose-500/40 bg-rose-950/75 text-rose-200',
    };
  }
  if (geoStatus === 'unavailable') {
    return {
      label: 'Unavailable',
      dotClass: 'bg-rose-400',
      badgeClass: 'border-rose-500/35 bg-slate-900/90 text-rose-200',
    };
  }
  if (isLocating && !userLocation) {
    return {
      label: 'Locating...',
      dotClass: 'animate-ping bg-teal-400',
      badgeClass: 'border-teal-400/50 bg-teal-950/75 text-teal-200',
    };
  }
  if (weakAccuracyMeters != null || userLocation?.isCoarse) {
    const meters = Math.round(weakAccuracyMeters ?? userLocation?.accuracy ?? 0);
    return {
      label: `Weak signal (±${meters} m)`,
      dotClass: 'bg-amber-400',
      badgeClass: 'border-amber-500/40 bg-amber-950/75 text-amber-200',
    };
  }
  if (userLocation && !userLocation.isCoarse) {
    return {
      label: `Ready · ±${Math.round(userLocation.accuracy || 0)} m`,
      dotClass: 'bg-emerald-400 shadow-[0_0_8px_#34d399]',
      badgeClass: 'border-emerald-500/40 bg-emerald-950/75 text-emerald-200',
    };
  }
  return {
    label: 'Searching',
    dotClass: 'animate-pulse bg-amber-400',
    badgeClass: 'border-amber-500/35 bg-slate-900/90 text-amber-200',
  };
}

/**
 * Mobile-first PWA overlay providing location search, turn-by-turn cues with
 * "then" preview, auto-reroute status, alternative route picker, voice mute,
 * units/time/avoid preferences, accessible error/retry banners, and live telemetry.
 */
export default function NavigationHUD({
  accessToken,
  userLocation,
  geoStatus = 'prompting',
  weakAccuracyMeters,
  isLocating = false,
  isUserOffScreen = false,
  getSearchProximity,
  geoError,
  findMeNotice,
  routeError,
  routeNotice,
  satelliteNotice,
  satelliteFallbackActive = false,
  tileError,
  poiError,
  wakeLockNotice,
  onRetryGeo,
  onDismissGeoError,
  onDismissFindMeNotice,
  onRetryRoute,
  onDismissRouteError,
  onDismissRouteNotice,
  onDismissSatelliteNotice,
  onRetryStandardSatellite,
  onRetryTiles,
  onDismissTileError,
  onRetryPois,
  onDismissPoiError,
  onDismissWakeLockNotice,
  isDrawing,
  isEditingPath,
  isMatching,
  isRerouting,
  onCancelReroute,
  snappedRoute,
  alternativeRoutes,
  selectedRouteIndex,
  onSelectAlternativeRoute,
  isOfflineCachedRoute,
  hasSavedLastRoute,
  onRestoreLastRoute,
  routeProgress,
  speedLimit,
  isOverSpeedLimit,
  mapBearing = 0,
  nextStepInfo,
  hasArrived,
  isNavigating,
  followUser,
  headingUp,
  profile,
  mapTheme,
  unitSystem,
  timeFormat,
  uiLanguage = 'en',
  voiceMuted,
  onToggleVoiceMuted,
  isPreviewingRoute = false,
  liveDrawCoordinates = [],
  canUndo = false,
  canRedo = false,
  rawWaypointCount = 0,
  onCommitRoutePreview,
  onUndoRouteEdit,
  onRedoRouteEdit,
  onDropLastDrawPoint,
  selectedPlace,
  homePlace,
  workPlace,
  favoritePlaces,
  recentSearches,
  isSelectedPlaceFavorited,
  onRecordRecentSearch,
  onToggleFavoritePlace,
  onSetSlotPlace,
  activePoiCategory,
  alongRouteOnly,
  openNowOnly,
  poiCount,
  isLoadingPois,
  poiAreaDirty,
  onTogglePoiCategory,
  onToggleAlongRoute,
  onToggleOpenNowOnly,
  onRefreshPois,
  onClearPois,
  onSelectPlace,
  onClearPlace,
  onRouteHere,
  onExtendRoute,
  onReplaceDestination,
  onAddStop,
  onStartDrawing,
  onFinishDrawing,
  onEditPath,
  onClearRoute,
  onFitRoute,
  onFindMe,
  onToggleHeadingUp,
  onResetNorth,
  onToggleNavigation,
  onChangeProfile,
  onCycleMapTheme,
  onOpenSavedHub,
  onOpenPlanner,
  onOpenShareImport,
  onOpenSettings,
  onOpenTokenModal,
  onSearchOpenChange,
  liteModeEnabled = true,
  onToggleLiteMode,
}) {
  const [clockNowMs, setClockNowMs] = useState(() => Date.now());
  const [dismissedOfflineBanner, setDismissedOfflineBanner] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClockNowMs(Date.now());
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);

  const speed = formatSpeed(userLocation?.speed, unitSystem);
  const drawnDistanceMeters = computePolylineDistanceMeters(liveDrawCoordinates);

  const isOffRoute =
    Boolean(snappedRoute && routeProgress) && routeProgress.distanceToRouteMeters > 45;

  const remainingMeters = routeProgress
    ? routeProgress.remainingDistanceMeters
    : snappedRoute?.distance ?? null;

  const remainingSeconds = (() => {
    if (!snappedRoute) return null;
    if (!routeProgress) return snappedRoute.duration;
    if (userLocation?.speed && userLocation.speed > 2) {
      return routeProgress.remainingDistanceMeters / userLocation.speed;
    }
    const ratio = 1 - routeProgress.progressRatio;
    return snappedRoute.duration * Math.max(0, ratio);
  })();

  const etaClockText = formatEtaClock(remainingSeconds, timeFormat, clockNowMs);

  const primaryBanner = (() => {
    if (routeError) {
      return {
        key: 'route',
        message: routeError.message,
        isAuthError: routeError.isAuthError,
        onRetry: routeError.retryable ? onRetryRoute : null,
        onDismiss: onDismissRouteError,
      };
    }
    if (tileError) {
      return {
        key: 'tiles',
        message: tileError.message,
        isAuthError: tileError.isAuthError,
        onRetry: tileError.retryable ? onRetryTiles : null,
        onDismiss: onDismissTileError,
      };
    }
    if (poiError) {
      return {
        key: 'poi',
        message: poiError.message,
        isAuthError: poiError.isAuthError,
        onRetry: poiError.retryable ? onRetryPois : null,
        onDismiss: onDismissPoiError,
      };
    }
    return null;
  })();

  const activeNoticeInfo = routeNotice
    ? { message: routeNotice, onDismiss: onDismissRouteNotice }
    : findMeNotice
      ? {
          message: findMeNotice.message,
          onDismiss: onDismissFindMeNotice,
          actionLabel: findMeNotice.retryable ? 'Retry' : null,
          onAction: findMeNotice.retryable ? onFindMe : null,
        }
      : satelliteNotice
        ? {
            message: satelliteNotice,
            onDismiss: onDismissSatelliteNotice,
            actionLabel: satelliteFallbackActive ? 'Try Standard' : null,
            onAction: satelliteFallbackActive ? onRetryStandardSatellite : null,
          }
        : wakeLockNotice
          ? { message: wakeLockNotice, onDismiss: onDismissWakeLockNotice }
          : null;

  const gpsChip = getGpsChipInfo({
    geoStatus,
    userLocation,
    weakAccuracyMeters,
    isLocating,
  });
  const baseRoute = alternativeRoutes?.[0] || snappedRoute;
  const followingStep = nextStepInfo?.nextFollowingStep;

  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-[max(0.75rem,env(safe-area-inset-top))]">
      {/* Top Search, Category Discovery, Turn-by-Turn & Status Area */}
      <div className="hud-surface ml-[54px] flex flex-col gap-2">
        <LocationSearch
          accessToken={accessToken}
          userLocation={userLocation}
          unitSystem={unitSystem}
          uiLanguage={uiLanguage}
          getSearchProximity={getSearchProximity}
          hasRoute={Boolean(snappedRoute)}
          selectedPlace={selectedPlace}
          homePlace={homePlace}
          workPlace={workPlace}
          favoritePlaces={favoritePlaces}
          recentSearches={recentSearches}
          isPlaceFavorited={isSelectedPlaceFavorited}
          onSelectPlace={onSelectPlace}
          onClearPlace={onClearPlace}
          onRouteHere={onRouteHere}
          onExtendRoute={onExtendRoute}
          onReplaceDestination={onReplaceDestination}
          onAddStop={onAddStop}
          onRecordRecentSearch={onRecordRecentSearch}
          onToggleFavorite={onToggleFavoritePlace}
          onSetSlotPlace={onSetSlotPlace}
          onOpenTokenModal={onOpenTokenModal}
          onSearchOpenChange={onSearchOpenChange}
        />

        {!isDrawing && !isEditingPath && !isNavigating && !selectedPlace && (
          <div className="pointer-events-auto flex flex-col gap-1.5">
            <div className="hud-scroll-x scrollbar-none flex items-center gap-1.5 overflow-x-auto pb-0.5">
              {snappedRoute && (
                <button
                  type="button"
                  aria-pressed={alongRouteOnly}
                  onClick={onToggleAlongRoute}
                  className={`hud-focusable flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold shadow-md backdrop-blur-md transition active:scale-95 ${
                    alongRouteOnly
                      ? 'border-teal-300 bg-teal-400 text-slate-950'
                      : 'border-slate-700/70 bg-slate-950/85 text-teal-200 hover:bg-slate-900'
                  }`}
                >
                  {t(uiLanguage, 'alongRoute')}
                </button>
              )}

              {activePoiCategory && (
                <button
                  type="button"
                  aria-pressed={openNowOnly}
                  onClick={onToggleOpenNowOnly}
                  className={`hud-focusable flex min-h-11 shrink-0 items-center gap-1 rounded-full border px-3 text-xs font-semibold shadow-md backdrop-blur-md transition active:scale-95 ${
                    openNowOnly
                      ? 'border-emerald-400 bg-emerald-400 text-slate-950'
                      : 'border-slate-700/70 bg-slate-950/85 text-emerald-200 hover:bg-slate-900'
                  }`}
                >
                  {t(uiLanguage, 'openNow')}
                </button>
              )}

              {POI_CATEGORIES.map((cat) => {
                const isActive = activePoiCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => onTogglePoiCategory(cat.id)}
                    className={`hud-focusable flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold shadow-md backdrop-blur-md transition active:scale-95 ${
                      isActive
                        ? 'border-teal-300/80 bg-slate-900/95 text-white ring-1 ring-teal-400/50'
                        : 'border-slate-700/70 bg-slate-950/85 text-slate-200 hover:bg-slate-900'
                    }`}
                  >
                    {isActive && isLoadingPois ? (
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-teal-300 border-t-transparent" />
                    ) : (
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: cat.color }}
                      />
                    )}
                    {cat.label}
                  </button>
                );
              })}

              {(activePoiCategory || poiCount > 0) && (
                <button
                  type="button"
                  onClick={onClearPois}
                  className="hud-focusable min-h-11 shrink-0 rounded-full border border-slate-700/70 bg-slate-950/90 px-3 text-xs font-semibold text-rose-300 shadow-md backdrop-blur-md active:scale-95"
                >
                  {t(uiLanguage, 'clear')}
                  {poiCount > 0 ? ` (${poiCount})` : ''}
                </button>
              )}
            </div>

            {activePoiCategory && !isLoadingPois && !alongRouteOnly && (poiAreaDirty || poiCount === 0) && (
              <div className="flex items-center gap-2 self-start">
                <button
                  type="button"
                  onClick={onRefreshPois}
                  className="hud-focusable min-h-11 rounded-full border border-teal-400/60 bg-slate-950/90 px-3.5 text-xs font-semibold text-teal-300 shadow-lg backdrop-blur-md active:scale-95"
                >
                  {poiCount === 0 ? 'No places here · Search area' : 'Search this area'}
                </button>
              </div>
            )}
          </div>
        )}

        {isNavigating && activePoiCategory && (
          <button
            type="button"
            onClick={onClearPois}
            className="hud-surface hud-focusable pointer-events-auto min-h-11 self-start rounded-full border border-slate-700/70 bg-slate-950/85 px-3 text-xs font-semibold text-slate-200 shadow-md backdrop-blur-md active:scale-95"
          >
            Hide map pins ({poiCount}) ✕
          </button>
        )}

        {snappedRoute && nextStepInfo && !selectedPlace && (
          <div className="hud-surface pointer-events-auto overflow-hidden rounded-2xl border border-slate-700/70 bg-slate-950/92 shadow-2xl backdrop-blur-md">
            <div className="flex items-center gap-3 px-3.5 py-2.5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-800/90">
                <ManeuverIcon
                  type={hasArrived ? 'arrive' : nextStepInfo.step?.maneuver?.type}
                  modifier={nextStepInfo.step?.maneuver?.modifier}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-base font-bold text-teal-300">
                    {hasArrived
                      ? 'Arrived'
                      : formatDistance(nextStepInfo.distanceToManeuverMeters, unitSystem)}
                  </span>
                  {nextStepInfo.step?.name && !hasArrived && (
                    <span className="max-w-[140px] truncate rounded bg-slate-800/90 px-1.5 py-0.5 text-[11px] font-medium text-slate-200">
                      {nextStepInfo.step.name}
                    </span>
                  )}
                  {isOffRoute && (
                    <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
                      Off route · {formatDistance(routeProgress.distanceToRouteMeters, unitSystem)}
                    </span>
                  )}
                  {!isOffRoute && routeProgress && isNavigating && (
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                      Snapped
                    </span>
                  )}
                  {isOfflineCachedRoute && (
                    <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-300">
                      Saved offline
                    </span>
                  )}
                </div>
                <p className="truncate text-sm font-medium text-slate-100">
                  {hasArrived
                    ? 'You have reached your destination'
                    : nextStepInfo.step?.maneuver?.instruction ||
                      nextStepInfo.step?.name ||
                      'Continue along custom bypass'}
                </p>
              </div>
            </div>

            {followingStep && !hasArrived && (
              <div className="flex items-center gap-2 border-t border-slate-800/90 bg-slate-900/75 px-3.5 py-1.5 text-xs text-slate-300">
                <span className="font-semibold uppercase tracking-wide text-slate-400">Then</span>
                <ManeuverIcon
                  size="sm"
                  type={followingStep.maneuver?.type}
                  modifier={followingStep.maneuver?.modifier}
                />
                <span className="min-w-0 flex-1 truncate">
                  {followingStep.maneuver?.instruction || followingStep.name || 'Continue ahead'}
                </span>
              </div>
            )}
          </div>
        )}

        {isRerouting && (
          <div
            role="status"
            aria-live="polite"
            className="hud-surface pointer-events-auto flex items-center justify-between gap-2 rounded-xl border border-amber-400/50 bg-amber-950/92 px-3 py-2 text-xs font-semibold text-amber-100 shadow-lg backdrop-blur-md"
          >
            <div className="flex items-center gap-2">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-300 border-t-transparent" />
              Rerouting from current location...
            </div>
            <button
              type="button"
              onClick={onCancelReroute}
              className="hud-focusable min-h-11 rounded-lg bg-amber-900/80 px-3 text-xs font-semibold text-amber-100 hover:bg-amber-800"
            >
              Cancel
            </button>
          </div>
        )}

        {isDrawing && (
          <div className="hud-surface pointer-events-auto flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-500/40 bg-slate-950/90 px-3.5 py-2.5 shadow-xl backdrop-blur-md">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">
                  {t(uiLanguage, 'drawBypass')}
                </p>
                {liveDrawCoordinates.length >= 2 && (
                  <span className="rounded bg-amber-400/20 px-2 py-0.5 text-[11px] font-bold text-amber-200">
                    {t(uiLanguage, 'drawnLength', {
                      dist: formatDistance(drawnDistanceMeters, unitSystem),
                    })}{' '}
                    ({liveDrawCoordinates.length} pts)
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-300">{t(uiLanguage, 'drawingHint')}</p>
            </div>
            <div className="flex items-center gap-1.5">
              {liveDrawCoordinates.length > 0 && (
                <button
                  type="button"
                  onClick={onDropLastDrawPoint}
                  className="hud-focusable min-h-11 rounded-xl border border-slate-700 bg-slate-900 px-3 text-xs font-semibold text-amber-200 active:scale-95"
                >
                  {t(uiLanguage, 'dropLast')}
                </button>
              )}
              <button
                type="button"
                onClick={onFinishDrawing}
                className="hud-focusable min-h-11 rounded-xl bg-teal-400 px-3.5 text-xs font-bold text-slate-950 active:scale-95"
              >
                {t(uiLanguage, 'finishDraw')}
              </button>
            </div>
          </div>
        )}

        {isPreviewingRoute && snappedRoute && !isDrawing && !isEditingPath && (
          <div className="hud-surface pointer-events-auto flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-teal-400/50 bg-slate-950/92 px-3.5 py-2.5 shadow-xl backdrop-blur-md">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold uppercase tracking-wide text-teal-300">
                Snapped Route Preview
              </p>
              <p className="text-xs text-slate-300">
                {formatDistance(snappedRoute.distance, unitSystem)} ·{' '}
                {formatDuration(snappedRoute.duration)} snapped to roads
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={onCommitRoutePreview}
                className="hud-focusable min-h-11 rounded-xl bg-teal-400 px-3 text-xs font-bold text-slate-950 active:scale-95"
              >
                {t(uiLanguage, 'commitPreview')}
              </button>
              <button
                type="button"
                onClick={onEditPath}
                className="hud-focusable min-h-11 rounded-xl border border-slate-700 bg-slate-900 px-3 text-xs font-semibold text-slate-200 active:scale-95"
              >
                {t(uiLanguage, 'editMore')}
              </button>
              <button
                type="button"
                onClick={onClearRoute}
                className="hud-focusable min-h-11 rounded-xl border border-slate-700 bg-slate-900 px-3 text-xs font-semibold text-rose-300 active:scale-95"
              >
                {t(uiLanguage, 'discardPreview')}
              </button>
            </div>
          </div>
        )}

        {(isOfflineCachedRoute || (typeof navigator !== 'undefined' && !navigator.onLine)) &&
          !dismissedOfflineBanner && (
            <div
              role="status"
              className="hud-surface pointer-events-auto flex items-center justify-between gap-2 rounded-xl border border-sky-400/40 bg-slate-950/90 px-3 py-2 text-xs text-sky-200 shadow-lg backdrop-blur-md"
            >
              <span className="min-w-0 flex-1">{t(uiLanguage, 'offlineBanner')}</span>
              <button
                type="button"
                onClick={() => setDismissedOfflineBanner(true)}
                aria-label={t(uiLanguage, 'close')}
                className="hud-focusable flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-sky-300 hover:bg-slate-800"
              >
                ✕
              </button>
            </div>
          )}

        {isEditingPath && (
          <div className="hud-surface pointer-events-auto flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-sky-400/40 bg-slate-950/90 px-3.5 py-2.5 shadow-xl backdrop-blur-md">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-300">
                Editing Route
              </p>
              <p className="text-xs text-slate-300">
                Drag yellow vertices or blue midpoints to reshape your route.
              </p>
            </div>
            <button
              type="button"
              onClick={onFinishDrawing}
              className="hud-focusable min-h-11 rounded-xl bg-sky-400 px-3.5 text-xs font-bold text-slate-950 active:scale-95"
            >
              Done
            </button>
          </div>
        )}

        {isMatching && (
          <div
            role="status"
            aria-live="polite"
            className="hud-surface pointer-events-auto flex min-h-11 items-center gap-2.5 self-start rounded-xl border border-teal-500/40 bg-slate-950/90 px-3.5 py-2 text-xs font-medium text-teal-300 shadow-lg backdrop-blur-md"
          >
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-teal-300 border-t-transparent" />
            Calculating road route...
          </div>
        )}

        {activeNoticeInfo && !primaryBanner && (
          <div
            role="status"
            aria-live="polite"
            className="hud-surface pointer-events-auto flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-950/90 px-3.5 py-2 text-xs text-amber-100 shadow-lg backdrop-blur-md"
          >
            <span className="min-w-0 flex-1 leading-relaxed">{activeNoticeInfo.message}</span>
            {activeNoticeInfo.actionLabel && activeNoticeInfo.onAction && (
              <button
                type="button"
                onClick={activeNoticeInfo.onAction}
                className="hud-focusable min-h-11 rounded-lg bg-amber-800/80 px-2.5 text-xs font-semibold text-amber-100 hover:bg-amber-700"
              >
                {activeNoticeInfo.actionLabel}
              </button>
            )}
            <button
              type="button"
              onClick={activeNoticeInfo.onDismiss}
              aria-label="Dismiss notice"
              className="hud-focusable flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-amber-200 hover:bg-amber-900/60"
            >
              ✕
            </button>
          </div>
        )}

        {geoError && (
          <div
            role="alert"
            className="hud-surface pointer-events-auto flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-500/45 bg-rose-950/92 px-3 py-2 text-xs text-rose-100 shadow-lg backdrop-blur-md"
          >
            <span className="min-w-0 flex-1 leading-relaxed">{geoError.message}</span>
            <div className="flex items-center gap-1.5">
              {geoError.retryable && onRetryGeo && (
                <button
                  type="button"
                  onClick={onRetryGeo}
                  className="hud-focusable min-h-11 rounded-lg bg-rose-800/80 px-3 text-xs font-semibold text-white hover:bg-rose-700"
                >
                  Retry
                </button>
              )}
              {onDismissGeoError && (
                <button
                  type="button"
                  onClick={onDismissGeoError}
                  className="hud-focusable flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-rose-200 hover:bg-rose-800/60"
                  aria-label="Dismiss location alert"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        )}

        {primaryBanner && (
          <div
            role="alert"
            className="hud-surface pointer-events-auto flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-500/40 bg-rose-950/92 px-3 py-2 text-xs text-rose-100 shadow-lg backdrop-blur-md"
          >
            <span className="min-w-0 flex-1 leading-relaxed">{primaryBanner.message}</span>
            <div className="flex items-center gap-1.5">
              {primaryBanner.isAuthError && (
                <button
                  type="button"
                  onClick={onOpenTokenModal}
                  className="hud-focusable min-h-11 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-teal-300 hover:bg-slate-800"
                >
                  Update Token
                </button>
              )}
              {primaryBanner.onRetry && (
                <button
                  type="button"
                  onClick={primaryBanner.onRetry}
                  className="hud-focusable min-h-11 rounded-lg bg-rose-800/80 px-3 text-xs font-semibold text-white hover:bg-rose-700"
                >
                  Retry
                </button>
              )}
              <button
                type="button"
                onClick={primaryBanner.onDismiss}
                className="hud-focusable flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-rose-200 hover:bg-rose-800/60"
                aria-label="Dismiss alert"
              >
                ✕
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Right-side Quick Controls */}
      <div className="pointer-events-none relative z-10 my-auto flex shrink-0 justify-end">
        <div className="hud-surface pointer-events-auto grid grid-cols-2 gap-1.5 sm:grid-cols-1">
          <button
            type="button"
            onClick={onResetNorth}
            aria-label={t(uiLanguage, 'resetNorth')}
            title={t(uiLanguage, 'resetNorth')}
            className="hud-focusable flex h-11 w-11 items-center justify-center rounded-xl border border-slate-700/70 bg-slate-950/85 text-slate-200 shadow-lg backdrop-blur-md transition active:scale-95"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5 transition-transform duration-150"
              style={{ transform: `rotate(${Math.round(-mapBearing)}deg)` }}
              aria-hidden="true"
            >
              <polygon points="12,3 15.5,12 12,10.5 8.5,12" fill="#f43f5e" />
              <polygon points="12,21 15.5,12 12,13.5 8.5,12" fill="#94a3b8" />
            </svg>
          </button>

          <button
            type="button"
            onClick={onFindMe}
            aria-label="Find my location"
            aria-pressed={followUser && Boolean(userLocation)}
            title={isLocating ? 'Locating...' : t(uiLanguage, 'recenter')}
            className={`hud-focusable flex h-11 w-11 items-center justify-center rounded-xl border shadow-lg backdrop-blur-md transition active:scale-95 ${
              followUser && userLocation
                ? 'border-teal-400/70 bg-teal-500/25 text-teal-300'
                : 'border-slate-700/70 bg-slate-950/85 text-slate-200'
            }`}
          >
            {isLocating ? (
              <span
                aria-hidden="true"
                className="h-4 w-4 animate-spin rounded-full border-2 border-teal-300 border-t-transparent"
              />
            ) : (
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path strokeLinecap="round" d="M12 2v3m0 14v3M2 12h3m14 0h3" />
                <circle cx="12" cy="12" r="7" />
              </svg>
            )}
          </button>

          <button
            type="button"
            onClick={onToggleHeadingUp}
            aria-label={headingUp ? 'Switch to North-up 2D view' : 'Switch to Heading-up 3D view'}
            aria-pressed={headingUp}
            title={headingUp ? 'Switch to North-up 2D' : 'Switch to Heading-up 3D'}
            className={`hud-focusable flex h-11 w-11 items-center justify-center rounded-xl border text-xs font-bold shadow-lg backdrop-blur-md transition active:scale-95 ${
              headingUp
                ? 'border-teal-400/70 bg-teal-500/25 text-teal-300'
                : 'border-slate-700/70 bg-slate-950/85 text-slate-200'
            }`}
          >
            {headingUp ? '3D' : '2D'}
          </button>

          <button
            type="button"
            onClick={onToggleVoiceMuted}
            aria-label={voiceMuted ? 'Unmute voice guidance' : 'Mute voice guidance'}
            aria-pressed={!voiceMuted}
            title={voiceMuted ? 'Voice muted' : 'Voice active'}
            className={`hud-focusable flex h-11 w-11 items-center justify-center rounded-xl border shadow-lg backdrop-blur-md transition active:scale-95 ${
              voiceMuted
                ? 'border-slate-700/70 bg-slate-950/85 text-slate-400'
                : 'border-teal-400/70 bg-teal-500/25 text-teal-300'
            }`}
          >
            {voiceMuted ? (
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5 6 9H3v6h3l5 4V5Z" />
                <path strokeLinecap="round" d="m16 9 5 6m0-6-5 6" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5 6 9H3v6h3l5 4V5Z" />
                <path strokeLinecap="round" d="M15.5 8.5a5 5 0 0 1 0 7m3-9.5a8.5 8.5 0 0 1 0 12" />
              </svg>
            )}
          </button>

          {snappedRoute && (
            <button
              type="button"
              onClick={onFitRoute}
              aria-label={t(uiLanguage, 'fitRoute')}
              title={t(uiLanguage, 'fitRoute')}
              className="hud-focusable flex h-11 w-11 items-center justify-center rounded-xl border border-slate-700/70 bg-slate-950/85 text-slate-200 shadow-lg backdrop-blur-md transition active:scale-95"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 9V4h5M20 9V4h-5M4 15v5h5m11-5v5h-5" />
              </svg>
            </button>
          )}

          <button
            type="button"
            onClick={onCycleMapTheme}
            aria-label={`Switch map style, current ${mapTheme}`}
            title="Switch map style"
            className="hud-focusable flex h-11 w-11 items-center justify-center rounded-xl border border-slate-700/70 bg-slate-950/85 text-[11px] font-semibold text-slate-200 shadow-lg backdrop-blur-md transition active:scale-95"
          >
            {MAP_STYLE_LABELS[mapTheme]}
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            aria-label={t(uiLanguage, 'settings')}
            title={t(uiLanguage, 'settings')}
            className="hud-focusable flex h-11 w-11 items-center justify-center rounded-xl border border-slate-700/70 bg-slate-950/85 text-slate-300 shadow-lg backdrop-blur-md transition active:scale-95"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.77 1.02 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Bottom Alternatives Picker, Quick Utility Bar & Telemetry Sheet */}
      <div className="pointer-events-auto flex flex-col">
        {!followUser && userLocation && isUserOffScreen && !isDrawing && !isEditingPath && (
          <div className="mb-2 flex justify-start">
            <button
              type="button"
              onClick={onFindMe}
              aria-label="Recenter map on my location"
              className="hud-surface hud-focusable flex min-h-11 items-center gap-2 rounded-full border border-teal-400/60 bg-slate-950/92 px-3.5 text-xs font-bold text-teal-200 shadow-xl backdrop-blur-md transition active:scale-95"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path strokeLinecap="round" d="M12 2v3m0 14v3M2 12h3m14 0h3" />
                <circle cx="12" cy="12" r="7" />
              </svg>
              {isLocating ? 'Locating...' : 'Recenter'}
            </button>
          </div>
        )}

        {alternativeRoutes?.length > 1 && !isNavigating && !isDrawing && !isEditingPath && (
          <div className="hud-scroll-x scrollbar-none mb-2 flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {alternativeRoutes.map((altRoute, index) => {
              const isSelected = index === selectedRouteIndex;
              const durDelta =
                index === 0 ? null : (altRoute.duration || 0) - (baseRoute?.duration || 0);
              const distDelta =
                index === 0 ? null : (altRoute.distance || 0) - (baseRoute?.distance || 0);

              return (
                <button
                  key={`alt-route-${index}`}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => onSelectAlternativeRoute(index)}
                  className={`hud-surface hud-focusable flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold shadow-lg backdrop-blur-md transition active:scale-95 ${
                    isSelected
                      ? 'border-teal-400 bg-slate-900/95 text-white ring-1 ring-teal-400/50'
                      : 'border-slate-700/80 bg-slate-950/90 text-slate-300 hover:bg-slate-900'
                  }`}
                >
                  <span className={isSelected ? 'text-teal-300' : 'text-slate-200'}>
                    {index === 0 ? 'Fastest' : `Alt ${index}`}
                  </span>
                  <span className="text-slate-400">·</span>
                  <span>
                    {index === 0
                      ? `${formatDuration(altRoute.duration)} (${formatDistance(altRoute.distance, unitSystem)})`
                      : `${formatSignedDurationDelta(durDelta)} (${formatSignedDistanceDelta(distDelta, unitSystem)})`}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {!isNavigating && !isDrawing && (
          <div className="hud-scroll-x scrollbar-none mb-2 flex items-center gap-1.5 overflow-x-auto pb-0.5">
            <button
              type="button"
              onClick={() => onOpenSavedHub('places')}
              className="hud-surface hud-focusable min-h-11 shrink-0 rounded-xl border border-slate-700/80 bg-slate-950/90 px-3 text-xs font-semibold text-slate-200 shadow-lg backdrop-blur-md active:scale-95"
            >
              ★ {t(uiLanguage, 'savedPlaces')}
            </button>

            <button
              type="button"
              onClick={() => onOpenSavedHub('routes')}
              className="hud-surface hud-focusable min-h-11 shrink-0 rounded-xl border border-slate-700/80 bg-slate-950/90 px-3 text-xs font-semibold text-slate-200 shadow-lg backdrop-blur-md active:scale-95"
            >
              {t(uiLanguage, 'savedRoutes')}
            </button>

            {rawWaypointCount >= 2 && (
              <button
                type="button"
                onClick={onOpenPlanner}
                className="hud-surface hud-focusable min-h-11 shrink-0 rounded-xl border border-slate-700/80 bg-slate-950/90 px-3 text-xs font-semibold text-violet-200 shadow-lg backdrop-blur-md active:scale-95"
              >
                {t(uiLanguage, 'planner')} ({rawWaypointCount})
              </button>
            )}

            <button
              type="button"
              onClick={onOpenShareImport}
              className="hud-surface hud-focusable min-h-11 shrink-0 rounded-xl border border-slate-700/80 bg-slate-950/90 px-3 text-xs font-semibold text-teal-200 shadow-lg backdrop-blur-md active:scale-95"
            >
              {t(uiLanguage, 'shareExport')}
            </button>

            {canUndo && (
              <button
                type="button"
                onClick={onUndoRouteEdit}
                className="hud-surface hud-focusable min-h-11 shrink-0 rounded-xl border border-slate-700/80 bg-slate-950/90 px-3 text-xs font-semibold text-amber-200 shadow-lg backdrop-blur-md active:scale-95"
              >
                ↶ {t(uiLanguage, 'undo')}
              </button>
            )}

            {canRedo && (
              <button
                type="button"
                onClick={onRedoRouteEdit}
                className="hud-surface hud-focusable min-h-11 shrink-0 rounded-xl border border-slate-700/80 bg-slate-950/90 px-3 text-xs font-semibold text-amber-200 shadow-lg backdrop-blur-md active:scale-95"
              >
                ↷ {t(uiLanguage, 'redo')}
              </button>
            )}

            {onToggleLiteMode && (
              <button
                type="button"
                aria-pressed={liteModeEnabled}
                onClick={onToggleLiteMode}
                title="Restrict tile area to ~15 km during navigation"
                className={`hud-surface hud-focusable min-h-11 shrink-0 rounded-xl border px-3 text-xs font-semibold shadow-lg backdrop-blur-md active:scale-95 ${
                  liteModeEnabled
                    ? 'border-teal-400/60 bg-teal-500/20 text-teal-200'
                    : 'border-slate-700/80 bg-slate-950/90 text-slate-300'
                }`}
              >
                Lite {liteModeEnabled ? 'On' : 'Off'}
              </button>
            )}
          </div>
        )}

        <div className="hud-surface rounded-2xl border border-slate-700/70 bg-slate-950/92 p-3 shadow-2xl backdrop-blur-md">
          {snappedRoute ? (
            <div className="flex flex-col gap-2.5">
              {/* Progress Bar */}
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-teal-400 to-emerald-400 transition-all duration-300"
                  style={{
                    width: `${Math.round((routeProgress?.progressRatio ?? 0) * 100)}%`,
                  }}
                />
              </div>

              {/* Metrics, Speed Limit & Profile Row */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <div>
                    <span className="text-lg font-bold text-white">
                      {formatDistance(remainingMeters, unitSystem)}
                    </span>
                    <span className="ml-1 text-[11px] text-slate-400">left</span>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-lg font-bold text-teal-300">
                      {formatDuration(remainingSeconds)}
                    </span>
                    <span className="text-[11px] text-slate-400">· {etaClockText}</span>
                    {profile === 'driving-traffic' && (
                      <span className="ml-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                        Live
                      </span>
                    )}
                  </div>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${gpsChip.badgeClass}`}
                  >
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${gpsChip.dotClass}`} />
                    {gpsChip.label}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <div
                      className={`text-sm font-semibold ${
                        isOverSpeedLimit ? 'text-rose-300' : 'text-slate-200'
                      }`}
                    >
                      <span>{speed.value}</span>
                      <span className="ml-0.5 text-[10px] text-slate-400">{speed.unit}</span>
                    </div>
                    {speedLimit && (
                      <div
                        aria-label={`Speed limit ${speedLimit.value} ${speedLimit.unit}`}
                        className={`flex h-9 w-9 flex-col items-center justify-center rounded-full border-2 text-center leading-none ${
                          isOverSpeedLimit
                            ? 'animate-pulse border-rose-500 bg-rose-950 text-rose-100'
                            : 'border-rose-500/80 bg-white text-slate-950'
                        }`}
                      >
                        <span className="text-[7px] font-bold uppercase tracking-tighter">
                          {t(uiLanguage, 'speedLimit')}
                        </span>
                        <span className="text-xs font-extrabold">{speedLimit.value}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-0.5 rounded-xl bg-slate-900 p-1">
                  {PROFILE_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      aria-pressed={profile === opt.id}
                      onClick={() => onChangeProfile(opt.id)}
                      className={`hud-focusable min-h-9 rounded-lg px-2 text-xs font-semibold transition ${
                        profile === opt.id
                          ? 'bg-teal-400 text-slate-950'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Primary Navigation Controls */}
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={onToggleNavigation}
                  className={`hud-focusable min-h-11 min-w-[96px] flex-1 rounded-xl px-3 text-sm font-bold transition active:scale-[0.98] ${
                    isNavigating
                      ? 'bg-rose-500/20 text-rose-300 ring-1 ring-rose-500/50'
                      : 'bg-teal-400 text-slate-950'
                  }`}
                >
                  {isNavigating ? t(uiLanguage, 'stopNav') : t(uiLanguage, 'startNav')}
                </button>

                <button
                  type="button"
                  onClick={isEditingPath ? onFinishDrawing : onEditPath}
                  className={`hud-focusable min-h-11 rounded-xl border px-3 text-xs font-semibold active:scale-95 ${
                    isEditingPath
                      ? 'border-sky-400/60 bg-sky-400/20 text-sky-200'
                      : 'border-slate-700 bg-slate-900 text-slate-200'
                  }`}
                >
                  {isEditingPath ? 'Done' : 'Edit'}
                </button>

                <button
                  type="button"
                  onClick={isDrawing ? onFinishDrawing : onStartDrawing}
                  className="hud-focusable min-h-11 rounded-xl border border-slate-700 bg-slate-900 px-3 text-xs font-semibold text-slate-200 active:scale-95"
                >
                  {isDrawing ? 'Snap' : 'Redraw'}
                </button>

                <button
                  type="button"
                  onClick={onClearRoute}
                  className="hud-focusable min-h-11 rounded-xl border border-slate-700 bg-slate-900 px-3 text-xs font-semibold text-rose-300 active:scale-95"
                >
                  {t(uiLanguage, 'clear')}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${gpsChip.badgeClass}`}
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${gpsChip.dotClass}`} />
                    <span className="truncate">{gpsChip.label}</span>
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-400">
                  {userLocation
                    ? `${speed.value} ${speed.unit} · ${userLocation.latitude.toFixed(5)}, ${userLocation.longitude.toFixed(5)}`
                    : 'Search a place or draw a custom bypass route'}
                </p>
              </div>

              <div className="flex items-center gap-1.5">
                {hasSavedLastRoute && !isDrawing && (
                  <button
                    type="button"
                    onClick={onRestoreLastRoute}
                    className="hud-focusable min-h-11 shrink-0 rounded-xl border border-slate-700 bg-slate-900 px-3 text-xs font-semibold text-slate-200 active:scale-95"
                  >
                    Last Route
                  </button>
                )}

                <button
                  type="button"
                  onClick={isDrawing ? onFinishDrawing : onStartDrawing}
                  className={`hud-focusable min-h-11 shrink-0 rounded-xl px-4 text-xs font-bold transition active:scale-95 ${
                    isDrawing ? 'bg-amber-400 text-slate-950' : 'bg-teal-400 text-slate-950'
                  }`}
                >
                  {isDrawing ? t(uiLanguage, 'finishDraw') : t(uiLanguage, 'drawBypass')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
