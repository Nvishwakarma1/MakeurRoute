import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigationStore } from '../store/navigationContext.js';
import {
  computeArrivalStatus,
  createAccuracyCircleGeoJSON,
  getNextNavigationStep,
  getSpeedLimitAtSegment,
  haversineDistanceMeters,
  projectPointOnRoute,
} from '../utils/geo.js';
import {
  isCoordOutsideMapBounds,
  MAX_HALO_RADIUS_METERS,
} from '../utils/geolocationHelpers.js';
import { OFF_ROUTE_THRESHOLD_METERS, shouldTriggerReroute } from '../utils/reroute.js';
import {
  computeLiteBoundsAroundCoord,
  DEFAULT_MAX_PITCH,
  shouldRecomputeLiteBounds,
  shouldUpdateFollowCamera,
} from '../utils/mapOptimization.js';

const SNAP_TO_ROUTE_THRESHOLD_METERS = 35;
const MAX_PLAUSIBLE_TICK_METERS = 350;

export const EMPTY_FEATURE_COLLECTION = {
  type: 'FeatureCollection',
  features: [],
};

function getMapInstance(mapRef) {
  return mapRef?.current?.getMap?.() || mapRef?.current || null;
}

/**
 * Computes live snapped progress, monotonic maneuver tracking, off-route auto-reroute
 * triggering, arrival trip summary generation, GeoJSON overlays, and camera follow.
 */
export function useNavigation({
  userLocation,
  positionRef,
  geoStatus,
  requestLocation,
  mapRef,
  isMapLoaded = true,
  drawRef,
  fitBoundsForCoordinates,
  prefersReducedMotion,
  onAutoReroute,
  isTileRequestsPaused = false,
  isSearchBrowsing = false,
}) {
  const { state, dispatch } = useNavigationStore();
  const {
    snappedRoute,
    alternativeRoutes,
    selectedRouteIndex,
    failedSegments,
    selectedPlace,
    liteModeEnabled,
    followUser,
    headingUp,
    isDrawing,
    isEditingPath,
    isMatching,
    isRerouting,
    isNavigating,
    maxStepIndex,
    maxSegmentIndex,
    hasMovedFromStart,
    offRouteSinceMs,
    lastRerouteAtMs,
    tripStartedAtMs,
    tripDistanceTraveledMeters,
    tripLastCoord,
    unitSystem,
    speedAlertEnabled,
  } = state;

  const [isUserOffScreen, setIsUserOffScreen] = useState(false);
  const [findMeNotice, setFindMeNotice] = useState(null);

  const hasCenteredInitiallyRef = useRef(false);
  const manualFlyUntilMsRef = useRef(0);
  const lastFollowCameraRef = useRef({
    coord: null,
    timeMs: 0,
    followUser: false,
    headingUp: false,
    isNavigating: false,
  });
  const liteBoundsCenterRef = useRef(null);
  const trackingRef = useRef({
    snappedRoute,
    maxStepIndex,
    maxSegmentIndex,
    hasMovedFromStart,
    isNavigating,
    isDrawing,
    isEditingPath,
    isMatching,
    isRerouting,
    offRouteSinceMs,
    lastRerouteAtMs,
    tripStartedAtMs,
    tripDistanceTraveledMeters,
    tripLastCoord,
  });
  const autoRerouteRef = useRef(onAutoReroute);

  useEffect(() => {
    trackingRef.current = {
      snappedRoute,
      maxStepIndex,
      maxSegmentIndex,
      hasMovedFromStart,
      isNavigating,
      isDrawing,
      isEditingPath,
      isMatching,
      isRerouting,
      offRouteSinceMs,
      lastRerouteAtMs,
      tripStartedAtMs,
      tripDistanceTraveledMeters,
      tripLastCoord,
    };
  }, [
    snappedRoute,
    maxStepIndex,
    maxSegmentIndex,
    hasMovedFromStart,
    isNavigating,
    isDrawing,
    isEditingPath,
    isMatching,
    isRerouting,
    offRouteSinceMs,
    lastRerouteAtMs,
    tripStartedAtMs,
    tripDistanceTraveledMeters,
    tripLastCoord,
  ]);

  useEffect(() => {
    autoRerouteRef.current = onAutoReroute;
  }, [onAutoReroute]);

  /**
   * Called from geolocation's async callback so monotonic progression, off-route
   * confirmation timer, trip summary completion, and auto-reroute stay glitch-free.
   */
  const handleValidLocationFix = useCallback(
    (fix) => {
      if (!fix || fix.isCoarse) return;
      const snap = trackingRef.current;
      const activeRoute = snap.snappedRoute;
      const coords = activeRoute?.geometry?.coordinates;
      if (!activeRoute || !coords?.length) return;

      const nowMs = Date.now();
      const point = [fix.longitude, fix.latitude];
      const progress = projectPointOnRoute(point, coords, activeRoute.cumulativeDistances, {
        lastSegmentIndex: snap.maxSegmentIndex,
      });
      if (!progress) return;

      const stepInfo = activeRoute.steps?.length
        ? getNextNavigationStep(
            activeRoute.steps,
            progress.distanceTraveledMeters,
            snap.maxStepIndex,
          )
        : null;

      const distFromStartMeters = haversineDistanceMeters(coords[0], point);
      const nextMovedFromStart =
        snap.hasMovedFromStart || distFromStartMeters >= 8 || progress.distanceTraveledMeters >= 8;
      const isOffRouteNow =
        snap.isNavigating && progress.distanceToRouteMeters > OFF_ROUTE_THRESHOLD_METERS;

      let deltaMeters = 0;
      if (snap.isNavigating && snap.tripLastCoord) {
        const rawStep = haversineDistanceMeters(snap.tripLastCoord, point);
        if (Number.isFinite(rawStep) && rawStep >= 0.5 && rawStep <= MAX_PLAUSIBLE_TICK_METERS) {
          deltaMeters = rawStep;
        }
      }

      const arrivedNow =
        snap.isNavigating &&
        computeArrivalStatus({
          totalDistanceMeters: progress.totalDistanceMeters,
          remainingDistanceMeters: progress.remainingDistanceMeters,
          distanceToRouteMeters: progress.distanceToRouteMeters,
          distanceTraveledMeters: progress.distanceTraveledMeters,
          hasMovedFromStart: nextMovedFromStart,
        });

      let arrivedSummary = null;
      if (arrivedNow) {
        const startedAt = snap.tripStartedAtMs || nowMs;
        const durationSeconds = Math.max(1, Math.round((nowMs - startedAt) / 1000));
        const measuredDistance = snap.tripDistanceTraveledMeters + deltaMeters;
        const distanceMeters = Math.max(measuredDistance, progress.distanceTraveledMeters);
        const averageSpeedMps = distanceMeters / durationSeconds;

        arrivedSummary = {
          distanceMeters,
          durationSeconds,
          averageSpeedMps,
          arrivedAtMs: nowMs,
        };
      }

      dispatch({
        type: 'ADVANCE_TRACKING',
        segmentIndex: progress.segmentIndex,
        stepIndex: stepInfo?.stepIndex ?? 0,
        hasMovedFromStart: nextMovedFromStart,
        isOffRoute: isOffRouteNow,
        nowMs,
        deltaMeters,
        currentCoord: point,
        arrivedSummary,
      });

      if (arrivedNow) return;

      const candidateOffRouteSince = isOffRouteNow ? (snap.offRouteSinceMs ?? nowMs) : null;
      if (
        shouldTriggerReroute({
          isNavigating: snap.isNavigating,
          isDrawing: snap.isDrawing,
          isEditingPath: snap.isEditingPath,
          isMatching: snap.isMatching,
          isRerouting: snap.isRerouting,
          hasArrived: false,
          distanceToRouteMeters: progress.distanceToRouteMeters,
          offRouteSinceMs: candidateOffRouteSince,
          lastRerouteAtMs: snap.lastRerouteAtMs,
          nowMs,
        })
      ) {
        autoRerouteRef.current?.({
          currentCoord: point,
          distanceTraveledMeters: progress.distanceTraveledMeters,
        });
      }
    },
    [dispatch],
  );

  const routeProgress = useMemo(() => {
    if (!userLocation || userLocation.isCoarse || !snappedRoute) return null;
    return projectPointOnRoute(
      [userLocation.longitude, userLocation.latitude],
      snappedRoute.geometry.coordinates,
      snappedRoute.cumulativeDistances,
      { lastSegmentIndex: maxSegmentIndex },
    );
  }, [userLocation, snappedRoute, maxSegmentIndex]);

  const speedLimit = useMemo(() => {
    if (!snappedRoute?.maxSpeeds?.length || !routeProgress) return null;
    const totalSegments = Math.max(1, (snappedRoute.geometry?.coordinates?.length || 2) - 1);
    return getSpeedLimitAtSegment(
      snappedRoute.maxSpeeds,
      routeProgress.segmentIndex,
      totalSegments,
      unitSystem,
    );
  }, [snappedRoute, routeProgress, unitSystem]);

  const isOverSpeedLimit = useMemo(() => {
    if (!speedAlertEnabled || !speedLimit || !Number.isFinite(userLocation?.speed)) {
      return false;
    }
    const currentKmh = Math.max(0, userLocation.speed * 3.6);
    // 5 km/h hysteresis prevents jitter annoyance right on the boundary
    return currentKmh > speedLimit.kmh + 5;
  }, [speedAlertEnabled, speedLimit, userLocation]);

  const nextStepInfo = useMemo(() => {
    if (!snappedRoute?.steps?.length) return null;
    return getNextNavigationStep(
      snappedRoute.steps,
      routeProgress ? routeProgress.distanceTraveledMeters : 0,
      maxStepIndex,
    );
  }, [snappedRoute, routeProgress, maxStepIndex]);

  const hasArrived = useMemo(() => {
    if (!snappedRoute || !routeProgress) return false;
    return computeArrivalStatus({
      totalDistanceMeters: routeProgress.totalDistanceMeters,
      remainingDistanceMeters: routeProgress.remainingDistanceMeters,
      distanceToRouteMeters: routeProgress.distanceToRouteMeters,
      distanceTraveledMeters: routeProgress.distanceTraveledMeters,
      hasMovedFromStart,
    });
  }, [snappedRoute, routeProgress, hasMovedFromStart]);

  const rawUserCoord = useMemo(
    () => (userLocation ? [userLocation.longitude, userLocation.latitude] : null),
    [userLocation],
  );

  // Snap directional puck only when GPS accuracy is <= 100 m; > 100 m renders halo only
  const displayUserCoord = useMemo(() => {
    if (!userLocation || userLocation.isCoarse) return null;
    if (
      routeProgress &&
      routeProgress.distanceToRouteMeters <= SNAP_TO_ROUTE_THRESHOLD_METERS
    ) {
      return routeProgress.snappedPoint;
    }
    return [userLocation.longitude, userLocation.latitude];
  }, [userLocation, routeProgress]);

  const targetFollowCoord = displayUserCoord || rawUserCoord;

  const markManualPan = useCallback(() => {
    hasCenteredInitiallyRef.current = true;
    manualFlyUntilMsRef.current = 0;
  }, []);

  const updateUserOffScreen = useCallback(() => {
    const map = getMapInstance(mapRef);
    const livePos = positionRef?.current || userLocation;
    const coord =
      displayUserCoord || (livePos ? [livePos.longitude, livePos.latitude] : null);
    if (!map || !coord) {
      setIsUserOffScreen(false);
      return;
    }
    const nextOffScreen = isCoordOutsideMapBounds(map.getBounds?.(), coord);
    setIsUserOffScreen((prev) => (prev === nextOffScreen ? prev : nextOffScreen));
  }, [mapRef, positionRef, userLocation, displayUserCoord]);

  // Center map once on initial fix after map loads, and follow user with throttling
  useEffect(() => {
    const map = getMapInstance(mapRef);
    if (!isMapLoaded || !map || !userLocation || !targetFollowCoord) return;

    const nowMs = Date.now();
    if (nowMs < manualFlyUntilMsRef.current) {
      return;
    }

    const prevCamera = lastFollowCameraRef.current;
    const forceSync =
      prevCamera.followUser !== followUser ||
      prevCamera.headingUp !== headingUp ||
      prevCamera.isNavigating !== isNavigating;

    if (isTileRequestsPaused && map.isEasing?.()) {
      map.stop?.();
    }

    const decision = shouldUpdateFollowCamera({
      hasCenteredInitially: hasCenteredInitiallyRef.current,
      followUser,
      isDrawing,
      isEditingPath,
      isRateLimitPaused: isTileRequestsPaused,
      prevCameraCoord: prevCamera.coord,
      nextCoord: targetFollowCoord,
      prevUpdateAtMs: prevCamera.timeMs,
      nowMs,
      forceSync,
    });

    if (decision === 'initial_fly') {
      hasCenteredInitiallyRef.current = true;
      manualFlyUntilMsRef.current = nowMs + (prefersReducedMotion ? 0 : 950);
      lastFollowCameraRef.current = {
        coord: targetFollowCoord,
        timeMs: nowMs,
        followUser,
        headingUp,
        isNavigating,
      };
      map.flyTo({
        center: targetFollowCoord,
        zoom: Math.max(map.getZoom?.() ?? 0, userLocation.isCoarse ? 14 : 16),
        duration: prefersReducedMotion ? 0 : 900,
        essential: true,
      });
      return;
    }

    if (decision === 'ease') {
      lastFollowCameraRef.current = {
        coord: targetFollowCoord,
        timeMs: nowMs,
        followUser,
        headingUp,
        isNavigating,
      };
      map.easeTo({
        center: targetFollowCoord,
        bearing: headingUp ? userLocation.heading || 0 : 0,
        pitch: headingUp ? DEFAULT_MAX_PITCH : 0,
        zoom: headingUp ? Math.max(map.getZoom?.() ?? 0, 16.5) : map.getZoom?.(),
        duration: prefersReducedMotion ? 0 : 600,
        essential: true,
      });
      return;
    }

    // Keep mode flags synced when follow is disabled so re-enabling triggers immediate follow
    lastFollowCameraRef.current = {
      ...prevCamera,
      followUser,
      headingUp,
      isNavigating,
    };
  }, [
    isMapLoaded,
    mapRef,
    userLocation,
    targetFollowCoord,
    followUser,
    headingUp,
    isNavigating,
    isDrawing,
    isEditingPath,
    isTileRequestsPaused,
    prefersReducedMotion,
  ]);

  // Lite mode: restrict maxBounds to ~15 km only during active Start Nav (recompute >3 km); never clamp browsing/searching
  useEffect(() => {
    const map = mapRef.current?.getMap?.() || mapRef.current;
    if (!map || typeof map.setMaxBounds !== 'function') return;

    const shouldClamp =
      Boolean(isNavigating) &&
      Boolean(liteModeEnabled) &&
      !selectedPlace &&
      !isSearchBrowsing &&
      Boolean(userLocation);

    if (!shouldClamp) {
      if (liteBoundsCenterRef.current !== null) {
        liteBoundsCenterRef.current = null;
        map.setMaxBounds(null);
      }
      return;
    }

    const currentCoord = displayUserCoord || [userLocation.longitude, userLocation.latitude];
    if (shouldRecomputeLiteBounds(liteBoundsCenterRef.current, currentCoord)) {
      liteBoundsCenterRef.current = currentCoord;
      map.setMaxBounds(computeLiteBoundsAroundCoord(currentCoord));
    }
  }, [
    mapRef,
    isNavigating,
    liteModeEnabled,
    selectedPlace,
    isSearchBrowsing,
    userLocation,
    displayUserCoord,
  ]);

  const accuracyCircleGeoJson = useMemo(() => {
    if (!userLocation?.accuracy) return EMPTY_FEATURE_COLLECTION;
    return createAccuracyCircleGeoJSON(
      userLocation.longitude,
      userLocation.latitude,
      Math.min(userLocation.accuracy, MAX_HALO_RADIUS_METERS),
    );
  }, [userLocation]);

  const alternativeRoutesGeoJson = useMemo(() => {
    if (!Array.isArray(alternativeRoutes) || alternativeRoutes.length <= 1 || isNavigating) {
      return EMPTY_FEATURE_COLLECTION;
    }
    const features = alternativeRoutes
      .map((route, index) => ({ route, index }))
      .filter(({ index }) => index !== selectedRouteIndex)
      .map(({ route, index }) => ({
        type: 'Feature',
        properties: { alternativeIndex: index },
        geometry: route.geometry,
      }));
    return {
      type: 'FeatureCollection',
      features,
    };
  }, [alternativeRoutes, selectedRouteIndex, isNavigating]);

  const traveledRouteGeoJson = useMemo(() => {
    if (!routeProgress?.traveledCoordinates?.length) return EMPTY_FEATURE_COLLECTION;
    return {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: routeProgress.traveledCoordinates,
      },
    };
  }, [routeProgress]);

  const remainingRouteGeoJson = useMemo(() => {
    if (routeProgress?.remainingCoordinates?.length) {
      return {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: routeProgress.remainingCoordinates,
        },
      };
    }
    if (!snappedRoute) return EMPTY_FEATURE_COLLECTION;
    return {
      type: 'Feature',
      properties: {},
      geometry: snappedRoute.geometry,
    };
  }, [snappedRoute, routeProgress]);

  const failedSegmentsGeoJson = useMemo(() => {
    const gapFeatures = snappedRoute?.gapSegments || [];
    const features = [...(failedSegments || []), ...gapFeatures];
    if (features.length === 0) return EMPTY_FEATURE_COLLECTION;
    return {
      type: 'FeatureCollection',
      features,
    };
  }, [failedSegments, snappedRoute]);

  const routeEndpoints = useMemo(() => {
    const coords = snappedRoute?.geometry?.coordinates;
    if (!coords || coords.length < 2) return null;
    return {
      start: coords[0],
      end: coords[coords.length - 1],
    };
  }, [snappedRoute]);

  const handleFitRoute = useCallback(() => {
    hasCenteredInitiallyRef.current = true;
    const coords = snappedRoute?.geometry?.coordinates;
    fitBoundsForCoordinates(coords);
  }, [snappedRoute, fitBoundsForCoordinates]);

  const dismissFindMeNotice = useCallback(() => {
    setFindMeNotice(null);
  }, []);

  const flyToUserFix = useCallback(
    (fix, targetCoordOverride = null) => {
      const map = getMapInstance(mapRef);
      if (!fix || !map) return;

      const targetCoord = targetCoordOverride || [fix.longitude, fix.latitude];
      const nowMs = Date.now();
      const flyMs = prefersReducedMotion ? 0 : 900;

      hasCenteredInitiallyRef.current = true;
      manualFlyUntilMsRef.current = nowMs + flyMs + 50;
      lastFollowCameraRef.current = {
        coord: targetCoord,
        timeMs: nowMs,
        followUser: true,
        headingUp,
        isNavigating,
      };

      setIsUserOffScreen(false);
      setFindMeNotice(null);
      dispatch({ type: 'SET_FOLLOW_USER', payload: true });

      const currentZoom = map.getZoom?.() ?? 0;
      map.flyTo({
        center: targetCoord,
        zoom: Math.max(currentZoom, 16),
        bearing: headingUp ? fix.heading || 0 : 0,
        pitch: headingUp ? DEFAULT_MAX_PITCH : 0,
        duration: flyMs,
        essential: true,
      });
    },
    [mapRef, dispatch, headingUp, isNavigating, prefersReducedMotion],
  );

  const handleFindMe = useCallback(async () => {
    const map = getMapInstance(mapRef);
    const liveFix = positionRef?.current || userLocation;

    if (liveFix) {
      const snappedOrRaw =
        !liveFix.isCoarse && displayUserCoord
          ? displayUserCoord
          : [liveFix.longitude, liveFix.latitude];
      flyToUserFix(liveFix, snappedOrRaw);
      return;
    }

    setFindMeNotice(null);
    const resolvedFix = await requestLocation?.();
    const postRequestFix = resolvedFix || positionRef?.current;
    if (postRequestFix) {
      flyToUserFix(postRequestFix);
      return;
    }

    // Last resort: stay centered on the current map viewport with clear explanation
    const fallbackCenter = map?.getCenter?.();
    if (map && fallbackCenter) {
      map.flyTo({
        center: [fallbackCenter.lng, fallbackCenter.lat],
        zoom: Math.max(map.getZoom?.() ?? 4, 12),
        duration: prefersReducedMotion ? 0 : 500,
        essential: true,
      });
    }
    dispatch({ type: 'SET_FOLLOW_USER', payload: false });
    setFindMeNotice({
      message: 'Device GPS unavailable — centered on current map view as fallback.',
      retryable: geoStatus !== 'unavailable',
    });
  }, [
    mapRef,
    positionRef,
    userLocation,
    displayUserCoord,
    flyToUserFix,
    requestLocation,
    prefersReducedMotion,
    dispatch,
    geoStatus,
  ]);

  const handleToggleHeadingUp = useCallback(() => {
    const next = !headingUp;
    dispatch({ type: 'SET_HEADING_UP', payload: next });
    const map = getMapInstance(mapRef);
    const liveFix = positionRef?.current || userLocation;
    if (map && !isTileRequestsPaused) {
      map.easeTo({
        bearing: next ? liveFix?.heading || 0 : 0,
        pitch: next ? DEFAULT_MAX_PITCH : 0,
        duration: prefersReducedMotion ? 0 : 500,
        essential: true,
      });
    }
  }, [
    headingUp,
    dispatch,
    mapRef,
    positionRef,
    userLocation,
    prefersReducedMotion,
    isTileRequestsPaused,
  ]);

  const handleToggleNavigation = useCallback(() => {
    const map = getMapInstance(mapRef);
    const liveFix = positionRef?.current || userLocation;
    if (!state.isNavigating) {
      drawRef.current?.finishDrawing();
      hasCenteredInitiallyRef.current = true;
      dispatch({
        type: 'START_NAVIGATION',
        nowMs: Date.now(),
        startCoord: liveFix ? [liveFix.longitude, liveFix.latitude] : null,
      });
      const focusCoord =
        displayUserCoord || (liveFix ? [liveFix.longitude, liveFix.latitude] : null);
      if (focusCoord && map && !isTileRequestsPaused) {
        manualFlyUntilMsRef.current = Date.now() + (prefersReducedMotion ? 0 : 750);
        map.easeTo({
          center: focusCoord,
          zoom: 17,
          pitch: DEFAULT_MAX_PITCH,
          bearing: liveFix?.heading || 0,
          duration: prefersReducedMotion ? 0 : 700,
          essential: true,
        });
      }
    } else {
      dispatch({ type: 'STOP_NAVIGATION' });
      map?.easeTo({
        pitch: 0,
        bearing: 0,
        duration: prefersReducedMotion ? 0 : 500,
        essential: true,
      });
    }
  }, [
    state.isNavigating,
    drawRef,
    dispatch,
    displayUserCoord,
    mapRef,
    positionRef,
    userLocation,
    prefersReducedMotion,
    isTileRequestsPaused,
  ]);

  const handleSelectPlace = useCallback(
    (place) => {
      hasCenteredInitiallyRef.current = true;
      dispatch({ type: 'SET_SELECTED_PLACE', payload: place });
      dispatch({ type: 'SET_FOLLOW_USER', payload: false });
      const map = getMapInstance(mapRef);
      const currentZoom = map?.getZoom?.() ?? 15;
      map?.flyTo({
        center: place.coordinates,
        zoom: Math.max(currentZoom, 15.5),
        pitch: 0,
        bearing: 0,
        duration: prefersReducedMotion ? 0 : 850,
        essential: true,
      });
    },
    [dispatch, mapRef, prefersReducedMotion],
  );

  const handleResetNorth = useCallback(() => {
    dispatch({ type: 'SET_HEADING_UP', payload: false });
    const map = getMapInstance(mapRef);
    if (map) {
      map.easeTo({
        bearing: 0,
        pitch: state.isNavigating ? 30 : 0,
        duration: prefersReducedMotion ? 0 : 450,
        essential: true,
      });
    }
  }, [dispatch, mapRef, state.isNavigating, prefersReducedMotion]);

  return {
    handleValidLocationFix,
    routeProgress,
    speedLimit,
    isOverSpeedLimit,
    nextStepInfo,
    hasArrived,
    rawUserCoord,
    displayUserCoord,
    accuracyCircleGeoJson,
    alternativeRoutesGeoJson,
    traveledRouteGeoJson,
    remainingRouteGeoJson,
    failedSegmentsGeoJson,
    routeEndpoints,
    isUserOffScreen,
    findMeNotice,
    dismissFindMeNotice,
    markManualPan,
    updateUserOffScreen,
    handleFitRoute,
    handleFindMe,
    handleToggleHeadingUp,
    handleResetNorth,
    handleToggleNavigation,
    handleSelectPlace,
  };
}
