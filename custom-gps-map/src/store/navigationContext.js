import { createContext, useContext } from 'react';

export const TOKEN_STORAGE_KEY = 'takeurroute_mapbox_token';
export const PLACEHOLDER_MAPBOX_TOKEN = 'YOUR_MAPBOX_ACCESS_TOKEN';
export const LAST_ROUTE_STORAGE_KEY = 'takeurroute_last_route';
export const PREFERENCES_STORAGE_KEY = 'takeurroute_preferences';

export const DEFAULT_PREFERENCES = {
  unitSystem: 'metric',
  timeFormat: '12h',
  uiLanguage: 'en',
  mapTheme: 'satellite',
  speedAlertEnabled: true,
  avoid: {
    tolls: false,
    highways: false,
    ferries: false,
  },
  voiceMuted: false,
  voiceLanguage: 'en-US',
  liteModeEnabled: true,
  navLightStyleEnabled: false,
};

export function loadSavedPreferences() {
  try {
    const raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw);
    const validThemes = ['satellite', 'night', 'day'];
    return {
      unitSystem: parsed?.unitSystem === 'imperial' ? 'imperial' : 'metric',
      timeFormat: parsed?.timeFormat === '24h' ? '24h' : '12h',
      uiLanguage: parsed?.uiLanguage === 'hi' ? 'hi' : 'en',
      mapTheme: validThemes.includes(parsed?.mapTheme) ? parsed.mapTheme : 'satellite',
      speedAlertEnabled:
        typeof parsed?.speedAlertEnabled === 'boolean' ? parsed.speedAlertEnabled : true,
      avoid: {
        tolls: Boolean(parsed?.avoid?.tolls),
        highways: Boolean(parsed?.avoid?.highways),
        ferries: Boolean(parsed?.avoid?.ferries),
      },
      voiceMuted: Boolean(parsed?.voiceMuted),
      voiceLanguage:
        typeof parsed?.voiceLanguage === 'string' && parsed.voiceLanguage.trim()
          ? parsed.voiceLanguage.trim()
          : 'en-US',
      liteModeEnabled:
        typeof parsed?.liteModeEnabled === 'boolean' ? parsed.liteModeEnabled : true,
      navLightStyleEnabled: Boolean(parsed?.navLightStyleEnabled),
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function persistPreferences(prefs) {
  try {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage quota or private mode restrictions
  }
}

export function isValidMapboxToken(token) {
  return Boolean(
    typeof token === 'string' &&
      token.trim().length > 10 &&
      token.trim() !== PLACEHOLDER_MAPBOX_TOKEN,
  );
}

export function getInitialToken() {
  try {
    const stored = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    if (isValidMapboxToken(stored)) {
      return stored.trim();
    }
  } catch {
    // Ignore storage read restrictions in private mode
  }

  const envToken = import.meta.env.VITE_MAPBOX_TOKEN;
  if (isValidMapboxToken(envToken)) {
    return envToken.trim();
  }

  return '';
}

export function persistTokenToStorage(token) {
  try {
    if (isValidMapboxToken(token)) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token.trim());
    } else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage quota or private mode restrictions
  }
}

export function hasStoredTokenOverride() {
  try {
    return isValidMapboxToken(window.localStorage.getItem(TOKEN_STORAGE_KEY));
  } catch {
    return false;
  }
}

export function loadSavedLastRoute() {
  try {
    const raw = window.localStorage.getItem(LAST_ROUTE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed?.snappedRoute?.geometry?.coordinates?.length >= 2 &&
      Array.isArray(parsed.rawCoordinates)
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function persistLastRoute(snapshot) {
  try {
    if (!snapshot?.snappedRoute?.geometry?.coordinates?.length) return;
    window.localStorage.setItem(
      LAST_ROUTE_STORAGE_KEY,
      JSON.stringify({
        rawCoordinates: snapshot.rawCoordinates,
        pinnedStopIndices: snapshot.pinnedStopIndices || [],
        routeSourceMode: snapshot.routeSourceMode || 'matching',
        profile: snapshot.profile || 'driving',
        snappedRoute: snapshot.snappedRoute,
        alternativeRoutes: snapshot.alternativeRoutes || [snapshot.snappedRoute],
        savedAt: Date.now(),
      }),
    );
  } catch {
    // Ignore storage quota errors cleanly
  }
}

export function clearSavedLastRoute() {
  try {
    window.localStorage.removeItem(LAST_ROUTE_STORAGE_KEY);
  } catch {
    // Ignore storage restrictions
  }
}

export const NavigationStoreContext = createContext(null);

export function useNavigationStore() {
  const ctx = useContext(NavigationStoreContext);
  if (!ctx) {
    throw new Error('useNavigationStore must be used inside NavigationProvider');
  }
  return ctx;
}
