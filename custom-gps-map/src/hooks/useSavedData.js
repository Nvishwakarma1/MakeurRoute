import { useCallback, useEffect, useState } from 'react';
import {
  clearAllStoredNavData,
  clearRecentSearches,
  clearSavedRoutes,
  deleteRecentSearch,
  deleteSavedPlace,
  deleteSavedRoute,
  getRecentSearches,
  getSavedPlaces,
  getSavedRoutes,
  isPlaceFavorited,
  recordRecentSearch,
  renameSavedRoute,
  saveNamedRoute,
  setSlotPlace,
  toggleFavoritePlace,
} from '../services/storageDb.js';

/**
 * React binding for IndexedDB saved places (Home, Work, Favorites), recent searches,
 * and saved/history routes.
 */
export function useSavedData() {
  const [savedPlaces, setSavedPlaces] = useState([]);
  const [recentSearches, setRecentSearches] = useState([]);
  const [savedRoutes, setSavedRoutes] = useState([]);
  const [isLoaded, setIsLoaded] = useState(false);

  const reloadAll = useCallback(async () => {
    try {
      const [places, searches, routes] = await Promise.all([
        getSavedPlaces(),
        getRecentSearches(),
        getSavedRoutes(),
      ]);
      setSavedPlaces(places);
      setRecentSearches(searches);
      setSavedRoutes(routes);
    } finally {
      setIsLoaded(true);
    }
  }, []);

  useEffect(() => {
    reloadAll();
  }, [reloadAll]);

  const homePlace = savedPlaces.find((p) => p.slot === 'home') || null;
  const workPlace = savedPlaces.find((p) => p.slot === 'work') || null;
  const favoritePlaces = savedPlaces.filter((p) => p.slot === 'favorite');

  const handleSetHomeOrWork = useCallback(
    async (slot, place) => {
      await setSlotPlace(slot, place);
      await reloadAll();
    },
    [reloadAll],
  );

  const handleToggleFavorite = useCallback(
    async (place) => {
      const result = await toggleFavoritePlace(place);
      await reloadAll();
      return result;
    },
    [reloadAll],
  );

  const handleDeletePlace = useCallback(
    async (id) => {
      await deleteSavedPlace(id);
      await reloadAll();
    },
    [reloadAll],
  );

  const handleRecordSearch = useCallback(async (place) => {
    const next = await recordRecentSearch(place);
    if (Array.isArray(next)) {
      setRecentSearches(next);
    }
  }, []);

  const handleDeleteRecentSearch = useCallback(async (id) => {
    await deleteRecentSearch(id);
    setRecentSearches((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const handleSaveCurrentRoute = useCallback(
    async (payload) => {
      const entry = await saveNamedRoute(payload);
      await reloadAll();
      return entry;
    },
    [reloadAll],
  );

  const handleRenameSavedRoute = useCallback(
    async (id, newName) => {
      const updated = await renameSavedRoute(id, newName);
      if (updated) {
        setSavedRoutes((prev) => prev.map((r) => (r.id === id ? updated : r)));
      }
      return updated;
    },
    [],
  );

  const handleDeleteSavedRoute = useCallback(async (id) => {
    await deleteSavedRoute(id);
    setSavedRoutes((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const handleClearRecentSearches = useCallback(async () => {
    await clearRecentSearches();
    setRecentSearches([]);
  }, []);

  const handleClearRouteHistory = useCallback(async () => {
    await clearSavedRoutes({ onlyHistory: true });
    await reloadAll();
  }, [reloadAll]);

  const handleClearAllData = useCallback(async () => {
    await clearAllStoredNavData();
    setSavedPlaces([]);
    setRecentSearches([]);
    setSavedRoutes([]);
  }, []);

  return {
    isLoaded,
    savedPlaces,
    homePlace,
    workPlace,
    favoritePlaces,
    recentSearches,
    savedRoutes,
    reloadAll,
    isPlaceFavorited: (place) => isPlaceFavorited(savedPlaces, place),
    setHomeOrWork: handleSetHomeOrWork,
    toggleFavorite: handleToggleFavorite,
    deletePlace: handleDeletePlace,
    recordSearch: handleRecordSearch,
    deleteRecentSearch: handleDeleteRecentSearch,
    saveCurrentRoute: handleSaveCurrentRoute,
    renameSavedRoute: handleRenameSavedRoute,
    deleteSavedRoute: handleDeleteSavedRoute,
    clearRecentSearches: handleClearRecentSearches,
    clearRouteHistory: handleClearRouteHistory,
    clearAllData: handleClearAllData,
  };
}
