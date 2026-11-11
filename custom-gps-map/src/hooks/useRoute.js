import { useCallback, useEffect, useRef } from 'react';
import { isAbortError, normalizeMapboxError } from '../services/apiClient.js';
import { getDirectionsRoute } from '../services/mapboxDirections.js';
import { snapRouteToRoads } from '../services/mapboxMatching.js';
import { recordRouteHistory } from '../services/storageDb.js';
import {
  loadSavedLastRoute,
  persistLastRoute,
  useNavigationStore,
} from '../store/navigationContext.js';
import { getCoordinatesBounds } from '../utils/geo.js';
import { buildRemainingWaypointsForReroute } from '../utils/reroute.js';
import {
  removeWaypointAtIndex,
  reorderWaypointList,
  toggleRoundTripWaypoints,
} from '../utils/routePlanner.js';

/**
 * Orchestrates custom freehand bypass drawing, vertex editing, Map Matching,
 * Directions multi-stop modifications, alternatives selection, avoid preferences,
 * debounced abortable auto-reroute, and retries.
 */
export function useRoute({
  accessToken,
  mapRef,
  drawRef,
  userLocation,
  prefersReducedMotion,
}) {
  const { state, dispatch } = useNavigationStore();
  const routeAbortRef = useRef(null);
  const rerouteAbortRef = useRef(null);
  const lastAttemptRef = useRef(null);

  useEffect(() => {
    return () => {
      routeAbortRef.current?.abort();
      rerouteAbortRef.current?.abort();
    };
  }, []);

  const fitBoundsForCoordinates = useCallback(
    (coords) => {
      const bounds = getCoordinatesBounds(coords);
      if (!bounds || !mapRef.current) return;
      dispatch({ type: 'SET_FOLLOW_USER', payload: false });
      mapRef.current.fitBounds(bounds, {
        padding: { top: 145, bottom: 235, left: 56, right: 56 },
        pitch: 0,
        bearing: 0,
        duration: prefersReducedMotion ? 0 : 800,
        essential: true,
      });
    },
    [dispatch, mapRef, prefersReducedMotion],
  );

  const calculateRoute = useCallback(
    async (
      coords,
      activeProfile,
      mode = 'matching',
      {
        fitBounds = false,
        pinnedIndices = [],
        clearPreviousRoute = true,
        avoidOverrides = null,
        isPreviewing = false,
        routeNameOverride = null,
      } = {},
    ) => {
      if (!coords || coords.length < 2) return;

      rerouteAbortRef.current?.abort();
      routeAbortRef.current?.abort();
      const controller = new AbortController();
      routeAbortRef.current = controller;

      const activeAvoid = avoidOverrides ?? state.avoid;
      lastAttemptRef.current = {
        coords,
        profile: activeProfile,
        mode,
        fitBounds,
        pinnedIndices,
        avoid: activeAvoid,
        isPreviewing,
      };

      dispatch({
        type: 'ROUTE_REQUEST_START',
        clearFailed: true,
        clearPreviousRoute,
      });

      try {
        const resolvedRoute =
          mode === 'directions'
            ? await getDirectionsRoute({
                waypoints: coords,
                accessToken,
                profile: activeProfile,
                pinnedIndices,
                avoid: activeAvoid,
                includeAlternatives: true,
                signal: controller.signal,
              })
            : await snapRouteToRoads({
                coordinates: coords,
                accessToken,
                profile: activeProfile,
                signal: controller.signal,
              });

        dispatch({ type: 'ROUTE_REQUEST_SUCCESS', route: resolvedRoute, isPreviewing });
        persistLastRoute({
          rawCoordinates: coords,
          pinnedStopIndices: pinnedIndices,
          routeSourceMode: mode,
          profile: activeProfile,
          snappedRoute: resolvedRoute,
          alternativeRoutes: resolvedRoute.alternatives || [resolvedRoute],
        });

        if (!isPreviewing) {
          recordRouteHistory({
            name: routeNameOverride || state.routeName,
            rawCoordinates: coords,
            pinnedStopIndices: pinnedIndices,
            routeSourceMode: mode,
            profile: activeProfile,
            snappedRoute: resolvedRoute,
          }).catch(() => {});
        }

        if (fitBounds) {
          fitBoundsForCoordinates(resolvedRoute.geometry.coordinates);
        }
      } catch (err) {
        if (isAbortError(err)) {
          if (routeAbortRef.current === controller) {
            dispatch({ type: 'ROUTE_REQUEST_ABORTED' });
          }
          return;
        }

        const normalized = normalizeMapboxError(
          err,
          mode === 'directions' ? 'Directions' : 'Map Matching',
        );
        const failedSegments = Array.isArray(err?.details?.failedSegments)
          ? err.details.failedSegments
          : [];

        dispatch({
          type: 'ROUTE_REQUEST_ERROR',
          clearPreviousRoute,
          failedSegments,
          error: {
            message: normalized.message,
            code: normalized.code,
            isAuthError: normalized.isAuthError,
            retryable: normalized.retryable,
          },
        });
      }
    },
    [accessToken, state.avoid, state.routeName, dispatch, fitBoundsForCoordinates],
  );

  const retryRoute = useCallback(() => {
    const attempt = lastAttemptRef.current;
    if (!attempt) return;
    calculateRoute(attempt.coords, state.profile || attempt.profile, attempt.mode, {
      fitBounds: attempt.fitBounds,
      pinnedIndices: attempt.pinnedIndices,
      clearPreviousRoute: true,
      avoidOverrides: state.avoid,
      isPreviewing: attempt.isPreviewing,
    });
  }, [calculateRoute, state.profile, state.avoid]);

  const cancelReroute = useCallback(() => {
    rerouteAbortRef.current?.abort();
    dispatch({ type: 'ROUTE_REQUEST_ABORTED' });
  }, [dispatch]);

  const triggerAutoReroute = useCallback(
    async ({ currentCoord, distanceTraveledMeters = 0 }) => {
      const { waypoints, pinnedIndices } = buildRemainingWaypointsForReroute({
        currentCoord,
        rawCoordinates: state.rawCoordinates,
        snappedRoute: state.snappedRoute,
        pinnedStopIndices: state.pinnedStopIndices,
        distanceTraveledMeters,
        routeSourceMode: state.routeSourceMode,
      });

      if (waypoints.length < 2) return;

      rerouteAbortRef.current?.abort();
      const controller = new AbortController();
      rerouteAbortRef.current = controller;

      dispatch({ type: 'REROUTE_START', nowMs: Date.now() });

      try {
        const rerouted = await getDirectionsRoute({
          waypoints,
          pinnedIndices,
          accessToken,
          profile: state.profile,
          avoid: state.avoid,
          includeAlternatives: false,
          signal: controller.signal,
        });

        drawRef.current?.setLineCoordinates(waypoints);
        dispatch({
          type: 'REROUTE_SUCCESS',
          route: rerouted,
          rawCoordinates: waypoints,
          pinnedIndices,
        });
        persistLastRoute({
          rawCoordinates: waypoints,
          pinnedStopIndices: pinnedIndices,
          routeSourceMode: 'directions',
          profile: state.profile,
          snappedRoute: rerouted,
          alternativeRoutes: [rerouted],
        });
      } catch (err) {
        if (isAbortError(err)) {
          if (rerouteAbortRef.current === controller) {
            dispatch({ type: 'ROUTE_REQUEST_ABORTED' });
          }
          return;
        }
        const normalized = normalizeMapboxError(err, 'Reroute');
        dispatch({
          type: 'REROUTE_FAILED',
          error: {
            message: `Auto-reroute failed: ${normalized.message}`,
            code: normalized.code,
            isAuthError: normalized.isAuthError,
            retryable: normalized.retryable,
          },
        });
      }
    },
    [
      state.rawCoordinates,
      state.snappedRoute,
      state.pinnedStopIndices,
      state.routeSourceMode,
      state.profile,
      state.avoid,
      accessToken,
      drawRef,
      dispatch,
    ],
  );

  const selectAlternativeRoute = useCallback(
    (index) => {
      const chosen = state.alternativeRoutes[index];
      if (!chosen) return;
      dispatch({ type: 'SELECT_ALTERNATIVE_ROUTE', index });
      persistLastRoute({
        rawCoordinates: state.rawCoordinates,
        pinnedStopIndices: state.pinnedStopIndices,
        routeSourceMode: state.routeSourceMode,
        profile: state.profile,
        snappedRoute: chosen,
        alternativeRoutes: state.alternativeRoutes,
      });
    },
    [
      state.alternativeRoutes,
      state.rawCoordinates,
      state.pinnedStopIndices,
      state.routeSourceMode,
      state.profile,
      dispatch,
    ],
  );

  const handleToggleAvoid = useCallback(
    (avoidKey) => {
      const nextAvoid = {
        ...state.avoid,
        [avoidKey]: !state.avoid[avoidKey],
      };
      dispatch({ type: 'TOGGLE_AVOID', payload: avoidKey });

      if (state.rawCoordinates.length >= 2 && state.routeSourceMode === 'directions') {
        calculateRoute(state.rawCoordinates, state.profile, 'directions', {
          pinnedIndices: state.pinnedStopIndices,
          clearPreviousRoute: false,
          avoidOverrides: nextAvoid,
        });
      }
    },
    [
      state.avoid,
      state.rawCoordinates,
      state.routeSourceMode,
      state.profile,
      state.pinnedStopIndices,
      dispatch,
      calculateRoute,
    ],
  );

  const handleDrawCreate = useCallback(
    (event, draw) => {
      const created = event?.features?.[0];
      if (!created) return;

      // Keep only the newest custom bypass route so stale drafts never accumulate
      if (draw) {
        const staleIds = draw
          .getAll()
          .features.filter((f) => f.id !== created.id)
          .map((f) => f.id);
        if (staleIds.length > 0) {
          draw.delete(staleIds);
        }
      }

      if (created.geometry?.type === 'LineString') {
        const coords = created.geometry.coordinates;
        dispatch({
          type: 'SET_ROUTE_DRAFT',
          rawCoordinates: coords,
          pinnedStopIndices: [],
          routeSourceMode: 'matching',
          routeName: 'Custom Bypass Route',
          pushUndo: true,
          clearSnapped: true,
        });
        calculateRoute(coords, state.profile, 'matching', {
          clearPreviousRoute: true,
          isPreviewing: true,
        });
      }
    },
    [dispatch, state.profile, calculateRoute],
  );

  const handleDrawUpdate = useCallback(
    (event) => {
      const updated = event?.features?.[0];
      if (updated?.geometry?.type === 'LineString') {
        const coords = updated.geometry.coordinates;
        dispatch({
          type: 'SET_ROUTE_DRAFT',
          rawCoordinates: coords,
          pinnedStopIndices: state.routeSourceMode === 'directions' ? state.pinnedStopIndices : [],
          routeSourceMode: state.routeSourceMode,
          pushUndo: true,
          clearSnapped: true,
        });
        calculateRoute(coords, state.profile, state.routeSourceMode, {
          pinnedIndices: state.routeSourceMode === 'directions' ? state.pinnedStopIndices : [],
          clearPreviousRoute: true,
          isPreviewing: state.isPreviewingRoute,
        });
      }
    },
    [
      dispatch,
      state.profile,
      state.routeSourceMode,
      state.pinnedStopIndices,
      state.isPreviewingRoute,
      calculateRoute,
    ],
  );

  const handleDrawDelete = useCallback(
    (_event, draw) => {
      if (draw && draw.getAll().features.length > 0) return;
      routeAbortRef.current?.abort();
      rerouteAbortRef.current?.abort();
      lastAttemptRef.current = null;
      dispatch({ type: 'CLEAR_ROUTE' });
    },
    [dispatch],
  );

  const handleDrawModeChange = useCallback(
    (event) => {
      dispatch({ type: 'SET_IS_DRAWING', payload: event?.mode === 'draw_line_string' });
      dispatch({ type: 'SET_IS_EDITING_PATH', payload: event?.mode === 'direct_select' });
    },
    [dispatch],
  );

  const handleDrawProgress = useCallback(
    (coords) => {
      dispatch({ type: 'SET_LIVE_DRAW_COORDS', payload: coords });
    },
    [dispatch],
  );

  const applyWaypointsToRoute = useCallback(
    (nextCoords, nextPinnedIndices = [], { routeName } = {}) => {
      if (!nextCoords || nextCoords.length < 2) return;
      rerouteAbortRef.current?.abort();
      dispatch({ type: 'STOP_NAVIGATION' });
      dispatch({
        type: 'SET_ROUTE_DRAFT',
        rawCoordinates: nextCoords,
        pinnedStopIndices: nextPinnedIndices,
        routeSourceMode: 'directions',
        routeName,
        pushUndo: true,
        clearSnapped: true,
      });
      dispatch({ type: 'SET_SELECTED_PLACE', payload: null });
      drawRef.current?.setLineCoordinates(nextCoords);
      calculateRoute(nextCoords, state.profile, 'directions', {
        fitBounds: true,
        pinnedIndices: nextPinnedIndices,
        clearPreviousRoute: true,
        routeNameOverride: routeName,
      });
    },
    [dispatch, drawRef, state.profile, calculateRoute],
  );

  const handleRouteHere = useCallback(
    (place) => {
      const center = mapRef.current?.getCenter?.();
      const origin = userLocation
        ? [userLocation.longitude, userLocation.latitude]
        : center
          ? [center.lng, center.lat]
          : null;

      if (!origin) {
        dispatch({
          type: 'ROUTE_REQUEST_ERROR',
          clearPreviousRoute: false,
          error: {
            message: 'Wait for GPS or map center initialization before routing.',
            code: 'NO_ORIGIN',
            isAuthError: false,
            retryable: false,
          },
        });
        return;
      }

      applyWaypointsToRoute([origin, place.coordinates], [0, 1], {
        routeName: place.name ? `To ${place.name}` : undefined,
      });
    },
    [mapRef, userLocation, dispatch, applyWaypointsToRoute],
  );

  const handleExtendRoute = useCallback(
    (place) => {
      if (state.rawCoordinates.length < 2) {
        handleRouteHere(place);
        return;
      }
      const nextCoords = [...state.rawCoordinates, place.coordinates];
      const basePinned =
        state.pinnedStopIndices.length > 0
          ? state.pinnedStopIndices
          : [0, state.rawCoordinates.length - 1];
      const nextPinned = Array.from(new Set([...basePinned, nextCoords.length - 1]));
      applyWaypointsToRoute(nextCoords, nextPinned);
    },
    [state.rawCoordinates, state.pinnedStopIndices, handleRouteHere, applyWaypointsToRoute],
  );

  const handleReplaceDestination = useCallback(
    (place) => {
      if (state.rawCoordinates.length < 2) {
        handleRouteHere(place);
        return;
      }
      const nextCoords = [...state.rawCoordinates.slice(0, -1), place.coordinates];
      const prevEnd = state.rawCoordinates.length - 1;
      const nextPinned = Array.from(
        new Set([
          ...state.pinnedStopIndices.filter((idx) => idx < prevEnd),
          nextCoords.length - 1,
        ]),
      );
      applyWaypointsToRoute(nextCoords, nextPinned);
    },
    [state.rawCoordinates, state.pinnedStopIndices, handleRouteHere, applyWaypointsToRoute],
  );

  const handleAddStop = useCallback(
    (place) => {
      if (state.rawCoordinates.length < 2) {
        handleRouteHere(place);
        return;
      }
      const lastIdx = state.rawCoordinates.length - 1;
      const nextCoords = [
        ...state.rawCoordinates.slice(0, -1),
        place.coordinates,
        state.rawCoordinates[lastIdx],
      ];
      const shiftedPinned = state.pinnedStopIndices.map((idx) =>
        idx === lastIdx ? lastIdx + 1 : idx,
      );
      const nextPinned = Array.from(
        new Set([0, ...shiftedPinned, nextCoords.length - 2, nextCoords.length - 1]),
      );
      applyWaypointsToRoute(nextCoords, nextPinned);
    },
    [state.rawCoordinates, state.pinnedStopIndices, handleRouteHere, applyWaypointsToRoute],
  );

  const handleStartDrawing = useCallback(() => {
    rerouteAbortRef.current?.abort();
    dispatch({ type: 'STOP_NAVIGATION' });
    dispatch({ type: 'SET_FOLLOW_USER', payload: false });
    dispatch({ type: 'CLEAR_ROUTE_ERROR' });
    dispatch({ type: 'SET_SELECTED_PLACE', payload: null });
    drawRef.current?.startLineDrawing();
  }, [dispatch, drawRef]);

  const handleFinishDrawing = useCallback(() => {
    drawRef.current?.finishDrawing();
  }, [drawRef]);

  const handleEditPath = useCallback(() => {
    rerouteAbortRef.current?.abort();
    dispatch({ type: 'STOP_NAVIGATION' });
    dispatch({ type: 'SET_FOLLOW_USER', payload: false });
    dispatch({ type: 'SET_SELECTED_PLACE', payload: null });
    const entered = drawRef.current?.editCurrentLine();
    if (!entered && state.rawCoordinates.length >= 2) {
      drawRef.current?.setLineCoordinates(state.rawCoordinates);
      drawRef.current?.editCurrentLine();
    }
  }, [dispatch, drawRef, state.rawCoordinates]);

  const handleClearRoute = useCallback(() => {
    drawRef.current?.clearAll();
    handleDrawDelete();
  }, [drawRef, handleDrawDelete]);

  const commitRoutePreview = useCallback(() => {
    dispatch({ type: 'COMMIT_ROUTE_PREVIEW' });
    if (state.snappedRoute && state.rawCoordinates.length >= 2) {
      recordRouteHistory({
        name: state.routeName,
        rawCoordinates: state.rawCoordinates,
        pinnedStopIndices: state.pinnedStopIndices,
        routeSourceMode: state.routeSourceMode,
        profile: state.profile,
        snappedRoute: state.snappedRoute,
      }).catch(() => {});
    }
  }, [
    dispatch,
    state.snappedRoute,
    state.rawCoordinates,
    state.routeName,
    state.pinnedStopIndices,
    state.routeSourceMode,
    state.profile,
  ]);

  const dropLastDrawPoint = useCallback(() => {
    if (state.isDrawing) {
      drawRef.current?.dropLastDrawingPoint();
      return;
    }
    if (state.rawCoordinates.length > 2) {
      const nextCoords = state.rawCoordinates.slice(0, -1);
      const nextPinned =
        state.routeSourceMode === 'directions' ? nextCoords.map((_, idx) => idx) : [];
      dispatch({
        type: 'SET_ROUTE_DRAFT',
        rawCoordinates: nextCoords,
        pinnedStopIndices: nextPinned,
        routeSourceMode: state.routeSourceMode,
        pushUndo: true,
        clearSnapped: true,
      });
      drawRef.current?.setLineCoordinates(nextCoords);
      calculateRoute(nextCoords, state.profile, state.routeSourceMode, {
        pinnedIndices: nextPinned,
        clearPreviousRoute: true,
      });
    }
  }, [
    state.isDrawing,
    state.rawCoordinates,
    state.routeSourceMode,
    state.profile,
    drawRef,
    dispatch,
    calculateRoute,
  ]);

  const undoRouteEdit = useCallback(() => {
    if (state.isDrawing) {
      drawRef.current?.dropLastDrawingPoint();
      return;
    }
    if (state.drawUndoPast.length === 0) return;
    const prev = state.drawUndoPast[state.drawUndoPast.length - 1];
    const nextPast = state.drawUndoPast.slice(0, -1);
    const currentSnap = {
      rawCoordinates: state.rawCoordinates,
      pinnedStopIndices: state.pinnedStopIndices,
      routeSourceMode: state.routeSourceMode,
    };
    dispatch({
      type: 'APPLY_UNDO_REDO',
      rawCoordinates: prev.rawCoordinates,
      pinnedStopIndices: prev.pinnedStopIndices,
      routeSourceMode: prev.routeSourceMode,
      drawUndoPast: nextPast,
      drawUndoFuture: [currentSnap, ...state.drawUndoFuture.slice(0, 24)],
    });
    drawRef.current?.setLineCoordinates(prev.rawCoordinates);
    calculateRoute(prev.rawCoordinates, state.profile, prev.routeSourceMode, {
      pinnedIndices: prev.pinnedStopIndices,
      clearPreviousRoute: true,
    });
  }, [
    state.isDrawing,
    state.drawUndoPast,
    state.drawUndoFuture,
    state.rawCoordinates,
    state.pinnedStopIndices,
    state.routeSourceMode,
    state.profile,
    drawRef,
    dispatch,
    calculateRoute,
  ]);

  const redoRouteEdit = useCallback(() => {
    if (state.drawUndoFuture.length === 0) return;
    const next = state.drawUndoFuture[0];
    const remainingFuture = state.drawUndoFuture.slice(1);
    const currentSnap = {
      rawCoordinates: state.rawCoordinates,
      pinnedStopIndices: state.pinnedStopIndices,
      routeSourceMode: state.routeSourceMode,
    };
    dispatch({
      type: 'APPLY_UNDO_REDO',
      rawCoordinates: next.rawCoordinates,
      pinnedStopIndices: next.pinnedStopIndices,
      routeSourceMode: next.routeSourceMode,
      drawUndoPast: [...state.drawUndoPast.slice(-24), currentSnap],
      drawUndoFuture: remainingFuture,
    });
    drawRef.current?.setLineCoordinates(next.rawCoordinates);
    calculateRoute(next.rawCoordinates, state.profile, next.routeSourceMode, {
      pinnedIndices: next.pinnedStopIndices,
      clearPreviousRoute: true,
    });
  }, [
    state.drawUndoFuture,
    state.drawUndoPast,
    state.rawCoordinates,
    state.pinnedStopIndices,
    state.routeSourceMode,
    state.profile,
    drawRef,
    dispatch,
    calculateRoute,
  ]);

  const reorderWaypoints = useCallback(
    (fromIdx, toIdx) => {
      const { coordinates, pinnedStopIndices } = reorderWaypointList(
        state.rawCoordinates,
        state.pinnedStopIndices,
        fromIdx,
        toIdx,
      );
      if (coordinates === state.rawCoordinates) return;
      applyWaypointsToRoute(coordinates, pinnedStopIndices);
    },
    [state.rawCoordinates, state.pinnedStopIndices, applyWaypointsToRoute],
  );

  const removeWaypoint = useCallback(
    (removeIdx) => {
      const next = removeWaypointAtIndex(state.rawCoordinates, removeIdx);
      if (!next) return;
      applyWaypointsToRoute(next.coordinates, next.pinnedStopIndices);
    },
    [state.rawCoordinates, applyWaypointsToRoute],
  );

  const toggleRoundTrip = useCallback(() => {
    const next = toggleRoundTripWaypoints(state.rawCoordinates);
    if (!next.coordinates || next.coordinates.length < 2) return;
    applyWaypointsToRoute(next.coordinates, next.pinnedStopIndices);
  }, [state.rawCoordinates, applyWaypointsToRoute]);

  const loadExternalRoute = useCallback(
    ({
      name,
      coordinates,
      pinnedStopIndices = [],
      routeSourceMode = 'matching',
      profile,
      snappedRoute = null,
    }) => {
      if (!Array.isArray(coordinates) || coordinates.length < 2) return;
      rerouteAbortRef.current?.abort();
      dispatch({ type: 'STOP_NAVIGATION' });
      const activeProfile = profile || state.profile;
      if (profile) {
        dispatch({ type: 'SET_PROFILE', payload: profile });
      }
      dispatch({
        type: 'SET_ROUTE_DRAFT',
        rawCoordinates: coordinates,
        pinnedStopIndices,
        routeSourceMode,
        routeName: name || 'Loaded Route',
        pushUndo: true,
        clearSnapped: !snappedRoute,
      });
      drawRef.current?.setLineCoordinates(coordinates);

      if (snappedRoute?.geometry?.coordinates?.length >= 2) {
        dispatch({
          type: 'ROUTE_REQUEST_SUCCESS',
          route: snappedRoute,
          alternativeRoutes: [snappedRoute],
          isOfflineCached: typeof navigator !== 'undefined' && !navigator.onLine,
        });
        fitBoundsForCoordinates(snappedRoute.geometry.coordinates);
        return;
      }

      calculateRoute(coordinates, activeProfile, routeSourceMode, {
        fitBounds: true,
        pinnedIndices: pinnedStopIndices,
        clearPreviousRoute: true,
        routeNameOverride: name || 'Loaded Route',
      });
    },
    [state.profile, drawRef, dispatch, fitBoundsForCoordinates, calculateRoute],
  );

  const handleChangeProfile = useCallback(
    (nextProfile) => {
      dispatch({ type: 'SET_PROFILE', payload: nextProfile });
      if (state.rawCoordinates.length >= 2) {
        calculateRoute(state.rawCoordinates, nextProfile, state.routeSourceMode, {
          pinnedIndices: state.routeSourceMode === 'directions' ? state.pinnedStopIndices : [],
          clearPreviousRoute: false,
        });
      }
    },
    [dispatch, state.rawCoordinates, state.routeSourceMode, state.pinnedStopIndices, calculateRoute],
  );

  const restoreLastSavedRoute = useCallback(() => {
    const saved = loadSavedLastRoute();
    if (!saved) return;
    dispatch({
      type: 'SET_ROUTE_DRAFT',
      rawCoordinates: saved.rawCoordinates,
      pinnedStopIndices: saved.pinnedStopIndices || [],
      routeSourceMode: saved.routeSourceMode || 'matching',
      clearSnapped: false,
    });
    if (saved.profile) {
      dispatch({ type: 'SET_PROFILE', payload: saved.profile });
    }
    drawRef.current?.setLineCoordinates(saved.rawCoordinates);
    dispatch({
      type: 'ROUTE_REQUEST_SUCCESS',
      route: saved.snappedRoute,
      alternativeRoutes: saved.alternativeRoutes || [saved.snappedRoute],
      isOfflineCached: true,
    });
    fitBoundsForCoordinates(saved.snappedRoute.geometry.coordinates);
  }, [dispatch, drawRef, fitBoundsForCoordinates]);

  const dismissRouteError = useCallback(() => {
    dispatch({ type: 'CLEAR_ROUTE_ERROR' });
  }, [dispatch]);

  const dismissRouteNotice = useCallback(() => {
    dispatch({ type: 'CLEAR_ROUTE_NOTICE' });
  }, [dispatch]);

  return {
    fitBoundsForCoordinates,
    retryRoute,
    cancelReroute,
    triggerAutoReroute,
    selectAlternativeRoute,
    handleToggleAvoid,
    handleDrawCreate,
    handleDrawUpdate,
    handleDrawDelete,
    handleDrawModeChange,
    handleDrawProgress,
    commitRoutePreview,
    undoRouteEdit,
    redoRouteEdit,
    dropLastDrawPoint,
    reorderWaypoints,
    removeWaypoint,
    toggleRoundTrip,
    loadExternalRoute,
    handleRouteHere,
    handleExtendRoute,
    handleReplaceDestination,
    handleAddStop,
    handleStartDrawing,
    handleFinishDrawing,
    handleEditPath,
    handleClearRoute,
    handleChangeProfile,
    restoreLastSavedRoute,
    dismissRouteError,
    dismissRouteNotice,
  };
}
