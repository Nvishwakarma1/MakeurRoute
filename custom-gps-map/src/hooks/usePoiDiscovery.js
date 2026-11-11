import { useCallback, useEffect, useRef, useState } from 'react';
import { isAbortError, normalizeMapboxError } from '../services/apiClient.js';
import { searchAlongRoutePOIs, searchCategoryPOIs } from '../services/mapboxGeocoding.js';

/**
 * Manages category-based nearby POI discovery and along-route corridor search
 * with isolated error/retry state and request cancellation.
 */
export function usePoiDiscovery({ accessToken, mapRef, userLocation, routeCoordinates = null }) {
  const [activePoiCategory, setActivePoiCategory] = useState(null);
  const [alongRouteOnly, setAlongRouteOnly] = useState(false);
  const [poiPlaces, setPoiPlaces] = useState([]);
  const [isLoadingPois, setIsLoadingPois] = useState(false);
  const [poiAreaDirty, setPoiAreaDirty] = useState(false);
  const [poiError, setPoiError] = useState(null);

  const poiAbortRef = useRef(null);

  useEffect(() => {
    return () => {
      poiAbortRef.current?.abort();
    };
  }, []);

  const loadPoisForCategory = useCallback(
    async (categoryId, useAlongRoute = alongRouteOnly) => {
      if (!categoryId) return;
      poiAbortRef.current?.abort();
      const controller = new AbortController();
      poiAbortRef.current = controller;

      setActivePoiCategory(categoryId);
      setIsLoadingPois(true);
      setPoiAreaDirty(false);
      setPoiError(null);

      try {
        let places = [];
        if (useAlongRoute && Array.isArray(routeCoordinates) && routeCoordinates.length >= 2) {
          places = await searchAlongRoutePOIs({
            categoryId,
            routeCoordinates,
            accessToken,
            maxCorridorMeters: 800,
            signal: controller.signal,
          });
        } else {
          const map = mapRef.current;
          const center = map?.getCenter?.();
          const bounds = map?.getBounds?.();
          const proximity = center
            ? [center.lng, center.lat]
            : userLocation
              ? [userLocation.longitude, userLocation.latitude]
              : undefined;
          const bbox = bounds
            ? [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]
            : undefined;

          places = await searchCategoryPOIs({
            categoryId,
            accessToken,
            proximity,
            bbox,
            limit: 25,
            signal: controller.signal,
          });
        }
        setPoiPlaces(places);
      } catch (err) {
        if (isAbortError(err)) return;
        const normalized = normalizeMapboxError(err, 'Nearby Places');
        setPoiError({
          message: normalized.message,
          code: normalized.code,
          isAuthError: normalized.isAuthError,
          retryable: normalized.retryable,
        });
        setPoiPlaces([]);
      } finally {
        if (poiAbortRef.current === controller) {
          setIsLoadingPois(false);
        }
      }
    },
    [accessToken, mapRef, userLocation, alongRouteOnly, routeCoordinates],
  );

  const clearPois = useCallback(() => {
    poiAbortRef.current?.abort();
    setActivePoiCategory(null);
    setPoiPlaces([]);
    setIsLoadingPois(false);
    setPoiAreaDirty(false);
    setPoiError(null);
  }, []);

  const togglePoiCategory = useCallback(
    (categoryId) => {
      if (activePoiCategory === categoryId) {
        clearPois();
        return;
      }
      loadPoisForCategory(categoryId, alongRouteOnly);
    },
    [activePoiCategory, clearPois, loadPoisForCategory, alongRouteOnly],
  );

  const toggleAlongRouteMode = useCallback(() => {
    setAlongRouteOnly((prev) => {
      const next = !prev;
      if (activePoiCategory) {
        loadPoisForCategory(activePoiCategory, next);
      }
      return next;
    });
  }, [activePoiCategory, loadPoisForCategory]);

  const refreshPois = useCallback(() => {
    if (activePoiCategory) {
      loadPoisForCategory(activePoiCategory, alongRouteOnly);
    }
  }, [activePoiCategory, loadPoisForCategory, alongRouteOnly]);

  const markPoiAreaDirtyIfActive = useCallback(() => {
    if (activePoiCategory && !alongRouteOnly) {
      setPoiAreaDirty(true);
    }
  }, [activePoiCategory, alongRouteOnly]);

  const dismissPoiError = useCallback(() => {
    setPoiError(null);
  }, []);

  return {
    activePoiCategory,
    alongRouteOnly,
    poiPlaces,
    isLoadingPois,
    poiAreaDirty,
    poiError,
    togglePoiCategory,
    toggleAlongRouteMode,
    refreshPois,
    clearPois,
    markPoiAreaDirtyIfActive,
    dismissPoiError,
  };
}
