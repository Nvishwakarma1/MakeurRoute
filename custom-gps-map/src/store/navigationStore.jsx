import { useMemo, useReducer } from 'react';
import {
  DEFAULT_PREFERENCES,
  loadSavedLastRoute,
  loadSavedPreferences,
  NavigationStoreContext,
  persistPreferences,
} from './navigationContext.js';

function createInitialState() {
  const prefs =
    typeof window !== 'undefined' ? loadSavedPreferences() : DEFAULT_PREFERENCES;

  return {
    rawCoordinates: [],
    pinnedStopIndices: [],
    routeSourceMode: 'matching',
    routeName: 'Custom Bypass Route',
    snappedRoute: null,
    alternativeRoutes: [],
    selectedRouteIndex: 0,
    isPreviewingRoute: false,
    failedSegments: [],
    routeError: null,
    routeNotice: null,
    isOfflineCachedRoute: false,
    hasSavedLastRoute: Boolean(typeof window !== 'undefined' && loadSavedLastRoute()),

    isDrawing: false,
    isEditingPath: false,
    liveDrawCoordinates: [],
    drawUndoPast: [],
    drawUndoFuture: [],
    isMatching: false,
    isRerouting: false,
    profile: 'driving',

    unitSystem: prefs.unitSystem,
    timeFormat: prefs.timeFormat,
    uiLanguage: prefs.uiLanguage,
    speedAlertEnabled: prefs.speedAlertEnabled,
    avoid: prefs.avoid,
    voiceMuted: prefs.voiceMuted,
    voiceLanguage: prefs.voiceLanguage,
    liteModeEnabled: prefs.liteModeEnabled,
    navLightStyleEnabled: prefs.navLightStyleEnabled,

    selectedPlace: null,
    mapTheme: prefs.mapTheme || 'satellite',
    preNavMapTheme: null,
    followUser: true,
    headingUp: false,
    isNavigating: false,

    maxStepIndex: 0,
    maxSegmentIndex: null,
    hasMovedFromStart: false,
    offRouteSinceMs: null,
    lastRerouteAtMs: 0,

    tripStartedAtMs: null,
    tripDistanceTraveledMeters: 0,
    tripLastCoord: null,
    tripSummary: null,
  };
}

function savePrefsFromState(state) {
  persistPreferences({
    unitSystem: state.unitSystem,
    timeFormat: state.timeFormat,
    uiLanguage: state.uiLanguage,
    // Keep the user's preferred style when temporarily switched during active nav
    mapTheme: state.preNavMapTheme || state.mapTheme,
    speedAlertEnabled: state.speedAlertEnabled,
    avoid: state.avoid,
    voiceMuted: state.voiceMuted,
    voiceLanguage: state.voiceLanguage,
    liteModeEnabled: state.liteModeEnabled,
    navLightStyleEnabled: state.navLightStyleEnabled,
  });
}

function navigationReducer(state, action) {
  switch (action.type) {
    case 'SET_PROFILE':
      return { ...state, profile: action.payload };
    case 'SET_UNIT_SYSTEM': {
      const nextState = {
        ...state,
        unitSystem: action.payload === 'imperial' ? 'imperial' : 'metric',
      };
      savePrefsFromState(nextState);
      return nextState;
    }
    case 'SET_TIME_FORMAT': {
      const nextState = {
        ...state,
        timeFormat: action.payload === '24h' ? '24h' : '12h',
      };
      savePrefsFromState(nextState);
      return nextState;
    }
    case 'TOGGLE_AVOID': {
      const key = action.payload;
      if (!key) return state;
      const nextState = {
        ...state,
        avoid: {
          ...state.avoid,
          [key]: !state.avoid[key],
        },
      };
      savePrefsFromState(nextState);
      return nextState;
    }
    case 'SET_VOICE_MUTED': {
      const nextState = {
        ...state,
        voiceMuted:
          typeof action.payload === 'function'
            ? action.payload(state.voiceMuted)
            : Boolean(action.payload),
      };
      savePrefsFromState(nextState);
      return nextState;
    }
    case 'SET_VOICE_LANGUAGE': {
      const nextState = {
        ...state,
        voiceLanguage: action.payload || 'en-US',
      };
      savePrefsFromState(nextState);
      return nextState;
    }
    case 'SET_UI_LANGUAGE': {
      const nextState = {
        ...state,
        uiLanguage: action.payload === 'hi' ? 'hi' : 'en',
      };
      savePrefsFromState(nextState);
      return nextState;
    }
    case 'SET_SPEED_ALERT_ENABLED': {
      const nextState = {
        ...state,
        speedAlertEnabled: Boolean(action.payload),
      };
      savePrefsFromState(nextState);
      return nextState;
    }
    case 'SET_LITE_MODE': {
      const nextValue =
        typeof action.payload === 'function'
          ? action.payload(state.liteModeEnabled)
          : Boolean(action.payload);
      const nextState = {
        ...state,
        liteModeEnabled: nextValue,
      };
      savePrefsFromState(nextState);
      return nextState;
    }
    case 'SET_NAV_LIGHT_STYLE': {
      const nextValue =
        typeof action.payload === 'function'
          ? action.payload(state.navLightStyleEnabled)
          : Boolean(action.payload);
      const restoredTheme =
        !nextValue && state.isNavigating && state.preNavMapTheme
          ? state.preNavMapTheme
          : state.isNavigating && nextValue && state.mapTheme === 'satellite'
            ? 'night'
            : state.mapTheme;
      const nextPreNavTheme =
        !nextValue
          ? null
          : state.isNavigating && state.mapTheme === 'satellite'
            ? state.mapTheme
            : state.preNavMapTheme;
      const nextState = {
        ...state,
        navLightStyleEnabled: nextValue,
        mapTheme: restoredTheme,
        preNavMapTheme: nextPreNavTheme,
      };
      savePrefsFromState(nextState);
      return nextState;
    }
    case 'SET_MAP_THEME': {
      const nextTheme =
        typeof action.payload === 'function' ? action.payload(state.mapTheme) : action.payload;
      const nextState = {
        ...state,
        mapTheme: nextTheme,
        preNavMapTheme: null,
      };
      savePrefsFromState(nextState);
      return nextState;
    }
    case 'SET_FOLLOW_USER':
      return {
        ...state,
        followUser:
          typeof action.payload === 'function'
            ? action.payload(state.followUser)
            : action.payload,
      };
    case 'SET_HEADING_UP':
      return {
        ...state,
        headingUp:
          typeof action.payload === 'function'
            ? action.payload(state.headingUp)
            : action.payload,
      };
    case 'SET_IS_DRAWING':
      return {
        ...state,
        isDrawing: action.payload,
        liveDrawCoordinates: action.payload ? state.liveDrawCoordinates : [],
      };
    case 'SET_LIVE_DRAW_COORDS':
      return {
        ...state,
        liveDrawCoordinates: Array.isArray(action.payload) ? action.payload : [],
      };
    case 'SET_IS_EDITING_PATH':
      return { ...state, isEditingPath: action.payload };
    case 'SET_SELECTED_PLACE':
      return { ...state, selectedPlace: action.payload };
    case 'SET_ROUTE_NAME':
      return { ...state, routeName: action.payload || 'Custom Bypass Route' };
    case 'COMMIT_ROUTE_PREVIEW':
      return { ...state, isPreviewingRoute: false };
    case 'SET_HAS_SAVED_LAST_ROUTE':
      return { ...state, hasSavedLastRoute: Boolean(action.payload) };
    case 'APPLY_UNDO_REDO':
      return {
        ...state,
        rawCoordinates: action.rawCoordinates,
        pinnedStopIndices: action.pinnedStopIndices,
        routeSourceMode: action.routeSourceMode,
        drawUndoPast: action.drawUndoPast,
        drawUndoFuture: action.drawUndoFuture,
        routeError: null,
        routeNotice: null,
        failedSegments: [],
        snappedRoute: null,
        alternativeRoutes: [],
        selectedRouteIndex: 0,
        isPreviewingRoute: false,
      };
    case 'SET_ROUTE_DRAFT': {
      const nextUndoPast =
        action.pushUndo && state.rawCoordinates.length >= 2
          ? [
              ...state.drawUndoPast.slice(-24),
              {
                rawCoordinates: state.rawCoordinates,
                pinnedStopIndices: state.pinnedStopIndices,
                routeSourceMode: state.routeSourceMode,
              },
            ]
          : state.drawUndoPast;

      return {
        ...state,
        rawCoordinates: action.rawCoordinates,
        pinnedStopIndices: action.pinnedStopIndices ?? state.pinnedStopIndices,
        routeSourceMode: action.routeSourceMode ?? state.routeSourceMode,
        routeName: action.routeName ?? state.routeName,
        drawUndoPast: nextUndoPast,
        drawUndoFuture: action.pushUndo ? [] : state.drawUndoFuture,
        isPreviewingRoute: Boolean(action.isPreviewingRoute),
        routeError: null,
        routeNotice: null,
        failedSegments: [],
        snappedRoute: action.clearSnapped ? null : state.snappedRoute,
        alternativeRoutes: action.clearSnapped ? [] : state.alternativeRoutes,
        selectedRouteIndex: 0,
        isOfflineCachedRoute: false,
        maxStepIndex: 0,
        maxSegmentIndex: null,
        hasMovedFromStart: false,
        offRouteSinceMs: null,
        tripSummary: null,
      };
    }
    case 'ROUTE_REQUEST_START':
      return {
        ...state,
        isMatching: true,
        routeError: null,
        routeNotice: null,
        failedSegments: action.clearFailed ? [] : state.failedSegments,
        snappedRoute: action.clearPreviousRoute ? null : state.snappedRoute,
        alternativeRoutes: action.clearPreviousRoute ? [] : state.alternativeRoutes,
        selectedRouteIndex: action.clearPreviousRoute ? 0 : state.selectedRouteIndex,
      };
    case 'ROUTE_REQUEST_SUCCESS': {
      const snappedRoute = action.route;
      const alternatives =
        Array.isArray(snappedRoute?.alternatives) && snappedRoute.alternatives.length > 0
          ? snappedRoute.alternatives
          : Array.isArray(action.alternativeRoutes) && action.alternativeRoutes.length > 0
            ? action.alternativeRoutes
            : [snappedRoute];
      const failedSegments = snappedRoute?.failedSegments || [];
      return {
        ...state,
        isMatching: false,
        isRerouting: false,
        snappedRoute,
        alternativeRoutes: alternatives,
        selectedRouteIndex: 0,
        isPreviewingRoute: Boolean(action.isPreviewing),
        failedSegments,
        routeError: null,
        routeNotice: snappedRoute?.warning || null,
        isOfflineCachedRoute: Boolean(action.isOfflineCached),
        hasSavedLastRoute: true,
        maxStepIndex: 0,
        maxSegmentIndex: null,
        hasMovedFromStart: false,
        offRouteSinceMs: null,
        tripSummary: null,
      };
    }
    case 'ROUTE_REQUEST_ERROR':
      return {
        ...state,
        isMatching: false,
        isRerouting: false,
        snappedRoute: action.clearPreviousRoute ? null : state.snappedRoute,
        alternativeRoutes: action.clearPreviousRoute ? [] : state.alternativeRoutes,
        selectedRouteIndex: action.clearPreviousRoute ? 0 : state.selectedRouteIndex,
        failedSegments: action.failedSegments || [],
        routeError: action.error,
        routeNotice: null,
      };
    case 'ROUTE_REQUEST_ABORTED':
      return {
        ...state,
        isMatching: false,
        isRerouting: false,
      };
    case 'SELECT_ALTERNATIVE_ROUTE': {
      const nextIndex = action.index;
      const candidate = state.alternativeRoutes[nextIndex];
      if (!candidate) return state;
      return {
        ...state,
        selectedRouteIndex: nextIndex,
        snappedRoute: candidate,
        routeNotice: candidate.warning || null,
        maxStepIndex: 0,
        maxSegmentIndex: null,
        hasMovedFromStart: false,
        offRouteSinceMs: null,
      };
    }
    case 'REROUTE_START':
      return {
        ...state,
        isRerouting: true,
        lastRerouteAtMs: action.nowMs || Date.now(),
      };
    case 'REROUTE_SUCCESS': {
      const snappedRoute = action.route;
      return {
        ...state,
        isRerouting: false,
        rawCoordinates: action.rawCoordinates ?? state.rawCoordinates,
        pinnedStopIndices: action.pinnedIndices ?? state.pinnedStopIndices,
        routeSourceMode: 'directions',
        snappedRoute,
        alternativeRoutes: [snappedRoute],
        selectedRouteIndex: 0,
        failedSegments: [],
        routeError: null,
        routeNotice: snappedRoute?.warning || null,
        maxStepIndex: 0,
        maxSegmentIndex: null,
        offRouteSinceMs: null,
      };
    }
    case 'REROUTE_FAILED':
      return {
        ...state,
        isRerouting: false,
        routeError: action.error || state.routeError,
      };
    case 'CLEAR_ROUTE_ERROR':
      return {
        ...state,
        routeError: null,
      };
    case 'CLEAR_ROUTE_NOTICE':
      return {
        ...state,
        routeNotice: null,
      };
    case 'CLEAR_ROUTE':
      return {
        ...state,
        rawCoordinates: [],
        pinnedStopIndices: [],
        routeName: 'Custom Bypass Route',
        snappedRoute: null,
        alternativeRoutes: [],
        selectedRouteIndex: 0,
        isPreviewingRoute: false,
        failedSegments: [],
        routeError: null,
        routeNotice: null,
        isMatching: false,
        isRerouting: false,
        isNavigating: false,
        mapTheme: state.preNavMapTheme || state.mapTheme,
        preNavMapTheme: null,
        isEditingPath: false,
        isDrawing: false,
        liveDrawCoordinates: [],
        drawUndoPast: [],
        drawUndoFuture: [],
        isOfflineCachedRoute: false,
        maxStepIndex: 0,
        maxSegmentIndex: null,
        hasMovedFromStart: false,
        offRouteSinceMs: null,
        tripStartedAtMs: null,
        tripDistanceTraveledMeters: 0,
        tripLastCoord: null,
        tripSummary: null,
      };
    case 'START_NAVIGATION': {
      const switchToLightNav = state.navLightStyleEnabled && state.mapTheme === 'satellite';
      return {
        ...state,
        isNavigating: true,
        isPreviewingRoute: false,
        selectedPlace: null,
        preNavMapTheme: switchToLightNav ? state.mapTheme : null,
        mapTheme: switchToLightNav ? 'night' : state.mapTheme,
        followUser: true,
        headingUp: true,
        maxStepIndex: 0,
        maxSegmentIndex: null,
        hasMovedFromStart: false,
        offRouteSinceMs: null,
        lastRerouteAtMs: 0,
        tripStartedAtMs: action.nowMs || Date.now(),
        tripDistanceTraveledMeters: 0,
        tripLastCoord: action.startCoord || null,
        tripSummary: null,
      };
    }
    case 'STOP_NAVIGATION':
      return {
        ...state,
        isNavigating: false,
        headingUp: false,
        isRerouting: false,
        offRouteSinceMs: null,
        mapTheme: state.preNavMapTheme || state.mapTheme,
        preNavMapTheme: null,
      };
    case 'ADVANCE_TRACKING': {
      const nextStepIdx = Math.max(state.maxStepIndex, action.stepIndex || 0);
      const nextSegIdx =
        action.segmentIndex != null
          ? state.maxSegmentIndex == null
            ? action.segmentIndex
            : Math.max(state.maxSegmentIndex, action.segmentIndex)
          : state.maxSegmentIndex;
      const nextMoved = state.hasMovedFromStart || Boolean(action.hasMovedFromStart);

      const nextOffRouteSinceMs = action.isOffRoute
        ? state.offRouteSinceMs ?? action.nowMs
        : null;

      const addedDistance = Number.isFinite(action.deltaMeters) ? action.deltaMeters : 0;
      const nextTripDistance = state.tripDistanceTraveledMeters + addedDistance;
      const nextTripLastCoord = action.currentCoord || state.tripLastCoord;

      if (action.arrivedSummary && state.isNavigating) {
        return {
          ...state,
          isNavigating: false,
          headingUp: false,
          isRerouting: false,
          mapTheme: state.preNavMapTheme || state.mapTheme,
          preNavMapTheme: null,
          maxStepIndex: nextStepIdx,
          maxSegmentIndex: nextSegIdx,
          hasMovedFromStart: nextMoved,
          offRouteSinceMs: null,
          tripDistanceTraveledMeters: nextTripDistance,
          tripLastCoord: nextTripLastCoord,
          tripSummary: action.arrivedSummary,
        };
      }

      if (
        nextStepIdx === state.maxStepIndex &&
        nextSegIdx === state.maxSegmentIndex &&
        nextMoved === state.hasMovedFromStart &&
        nextOffRouteSinceMs === state.offRouteSinceMs &&
        addedDistance === 0 &&
        nextTripLastCoord === state.tripLastCoord
      ) {
        return state;
      }

      return {
        ...state,
        maxStepIndex: nextStepIdx,
        maxSegmentIndex: nextSegIdx,
        hasMovedFromStart: nextMoved,
        offRouteSinceMs: nextOffRouteSinceMs,
        tripDistanceTraveledMeters: nextTripDistance,
        tripLastCoord: nextTripLastCoord,
      };
    }
    case 'DISMISS_TRIP_SUMMARY':
      return {
        ...state,
        tripSummary: null,
      };
    default:
      return state;
  }
}

export function NavigationProvider({ children }) {
  const [state, dispatch] = useReducer(navigationReducer, undefined, createInitialState);
  const value = useMemo(() => ({ state, dispatch }), [state]);

  return (
    <NavigationStoreContext.Provider value={value}>{children}</NavigationStoreContext.Provider>
  );
}
