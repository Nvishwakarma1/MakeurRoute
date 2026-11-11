import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isAbortError, normalizeMapboxError } from '../services/apiClient.js';
import {
  createSessionToken,
  retrieveLocation,
  searchForwardLocations,
  searchLocations,
} from '../services/mapboxGeocoding.js';
import {
  formatDistance,
  haversineDistanceMeters,
  sortLocationsByDistance,
} from '../utils/geo.js';
import { t } from '../utils/i18n.js';

/**
 * Debounced Mapbox Search Box autocomplete (stores, POIs, addresses, cities),
 * Home/Work/Favorites/Recent quick-picks, distance sorting, and route-modification card.
 */
export default function LocationSearch({
  accessToken,
  userLocation,
  unitSystem = 'metric',
  uiLanguage = 'en',
  getSearchProximity,
  hasRoute,
  selectedPlace,
  homePlace = null,
  workPlace = null,
  favoritePlaces = [],
  recentSearches = [],
  isPlaceFavorited = false,
  onSelectPlace,
  onClearPlace,
  onRouteHere,
  onExtendRoute,
  onReplaceDestination,
  onAddStop,
  onRecordRecentSearch,
  onToggleFavorite,
  onSetSlotPlace,
  onOpenTokenModal,
  onSearchOpenChange,
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [sortByDistance, setSortByDistance] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [isOpen, setIsOpen] = useState(false);

  const containerRef = useRef(null);
  const abortRef = useRef(null);
  const debounceTimerRef = useRef(null);
  const sessionTokenRef = useRef(createSessionToken());
  const userLocationRef = useRef(userLocation);
  const getSearchProximityRef = useRef(getSearchProximity);
  const suppressedQueryRef = useRef(null);

  const clearDebounce = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    userLocationRef.current = userLocation;
    getSearchProximityRef.current = getSearchProximity;
  }, [userLocation, getSearchProximity]);

  useEffect(() => {
    onSearchOpenChange?.(isOpen);
  }, [isOpen, onSearchOpenChange]);

  // Close suggestions dropdown on outside tap/click
  useEffect(() => {
    const handleOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleOutside);
    return () => document.removeEventListener('pointerdown', handleOutside);
  }, []);

  const getProximityCoords = useCallback(() => {
    const dynamicCoords = getSearchProximityRef.current?.();
    if (Array.isArray(dynamicCoords) && dynamicCoords.length === 2) {
      return dynamicCoords;
    }
    const loc = userLocationRef.current;
    return loc ? [loc.longitude, loc.latitude] : undefined;
  }, []);

  const executeSuggestSearch = useCallback(
    async (trimmed) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsSearching(true);
      setSearchError(null);

      try {
        const places = await searchLocations({
          query: trimmed,
          accessToken,
          proximity: getProximityCoords(),
          limit: 8,
          sessionToken: sessionTokenRef.current,
          signal: controller.signal,
        });
        setResults(places);
        setIsOpen(places.length > 0);
      } catch (err) {
        if (isAbortError(err)) return;
        const normalized = normalizeMapboxError(err, 'Location Search');
        setSearchError({
          message: normalized.message,
          isAuthError: normalized.isAuthError,
          retryable: normalized.retryable,
          retrySpec: { type: 'suggest', query: trimmed },
        });
        setResults([]);
      } finally {
        if (abortRef.current === controller) {
          setIsSearching(false);
        }
      }
    },
    [accessToken, getProximityCoords],
  );

  // Debounced Search Box /suggest query (independent of 1 Hz GPS updates)
  useEffect(() => {
    if (suppressedQueryRef.current !== null && suppressedQueryRef.current === query) {
      suppressedQueryRef.current = null;
      return undefined;
    }
    suppressedQueryRef.current = null;

    const trimmed = query.trim();
    if (trimmed.length < 2) {
      clearDebounce();
      abortRef.current?.abort();
      return undefined;
    }

    clearDebounce();
    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null;
      executeSuggestSearch(trimmed);
    }, 280);

    return clearDebounce;
  }, [query, clearDebounce, executeSuggestSearch]);

  useEffect(() => {
    return () => {
      clearDebounce();
      abortRef.current?.abort();
    };
  }, [clearDebounce]);

  const finalizeSelection = (place) => {
    clearDebounce();
    suppressedQueryRef.current = place.name === query ? null : place.name;
    sessionTokenRef.current = createSessionToken();
    setQuery(place.name);
    setIsOpen(false);
    setResults([]);
    setSearchError(null);
    onRecordRecentSearch?.(place);
    onSelectPlace(place);
  };

  const handleChooseResult = async (place) => {
    if (!place) return;
    clearDebounce();
    if (!place.needsRetrieve && Array.isArray(place.coordinates)) {
      finalizeSelection(place);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsSearching(true);
    setSearchError(null);

    try {
      const resolved = await retrieveLocation({
        mapboxId: place.mapboxId,
        sessionToken: place.sessionToken || sessionTokenRef.current,
        accessToken,
        signal: controller.signal,
      });
      if (!resolved) {
        throw new Error('Could not resolve coordinates for that location.');
      }
      finalizeSelection(resolved);
    } catch (err) {
      if (isAbortError(err)) return;
      const normalized = normalizeMapboxError(err, 'Place Details');
      setSearchError({
        message: normalized.message,
        isAuthError: normalized.isAuthError,
        retryable: normalized.retryable,
        retrySpec: { type: 'retrieve', place },
      });
    } finally {
      if (abortRef.current === controller) {
        setIsSearching(false);
      }
    }
  };

  const runForwardSearch = async (trimmed) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsSearching(true);
    setSearchError(null);

    try {
      const matches = await searchForwardLocations({
        query: trimmed,
        accessToken,
        proximity: getProximityCoords(),
        limit: 5,
        signal: controller.signal,
      });
      if (matches.length === 0) {
        setSearchError({
          message: 'No matching stores, addresses, or places found.',
          isAuthError: false,
          retryable: false,
          retrySpec: null,
        });
        return;
      }
      if (matches.length === 1) {
        finalizeSelection(matches[0]);
      } else {
        setResults(matches);
        setIsOpen(true);
      }
    } catch (err) {
      if (isAbortError(err)) return;
      const normalized = normalizeMapboxError(err, 'Location Search');
      setSearchError({
        message: normalized.message,
        isAuthError: normalized.isAuthError,
        retryable: normalized.retryable,
        retrySpec: { type: 'forward', query: trimmed },
      });
    } finally {
      if (abortRef.current === controller) {
        setIsSearching(false);
      }
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    clearDebounce();
    const trimmed = query.trim();
    if (trimmed.length < 2) return;

    if (results.length > 0) {
      await handleChooseResult(results[0]);
      return;
    }

    await runForwardSearch(trimmed);
  };

  const handleRetrySearch = () => {
    const spec = searchError?.retrySpec;
    if (!spec) return;
    if (spec.type === 'suggest') {
      executeSuggestSearch(spec.query);
    } else if (spec.type === 'retrieve') {
      handleChooseResult(spec.place);
    } else if (spec.type === 'forward') {
      runForwardSearch(spec.query);
    }
  };

  const handleClearInput = () => {
    clearDebounce();
    suppressedQueryRef.current = null;
    abortRef.current?.abort();
    sessionTokenRef.current = createSessionToken();
    setQuery('');
    setResults([]);
    setSearchError(null);
    setIsOpen(false);
    onClearPlace();
  };

  const distanceToSelected =
    selectedPlace && userLocation
      ? haversineDistanceMeters(
          [userLocation.longitude, userLocation.latitude],
          selectedPlace.coordinates,
        )
      : null;

  const displayResults = useMemo(() => {
    if (!sortByDistance) return results;
    const refCoord = userLocation ? [userLocation.longitude, userLocation.latitude] : null;
    return sortLocationsByDistance(results, refCoord);
  }, [results, sortByDistance, userLocation]);

  const hasSavedQuickItems =
    Boolean(homePlace || workPlace) || favoritePlaces.length > 0 || recentSearches.length > 0;

  return (
    <div ref={containerRef} className="hud-surface pointer-events-auto relative flex flex-col gap-2">
      {/* Search Bar */}
      <form
        onSubmit={handleSubmit}
        role="search"
        className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-700/80 bg-slate-950/90 pl-3 pr-1 shadow-xl backdrop-blur-md focus-within:border-teal-400/80"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 shrink-0 text-slate-400"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path strokeLinecap="round" d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          aria-label={t(uiLanguage, 'searchPlaceholder')}
          enterKeyHint="search"
          value={query}
          onFocus={() => {
            if (results.length > 0 || (query.trim().length < 2 && hasSavedQuickItems)) {
              setIsOpen(true);
            }
          }}
          onChange={(e) => {
            const nextVal = e.target.value;
            setQuery(nextVal);
            if (nextVal.trim().length < 2) {
              abortRef.current?.abort();
              setResults([]);
              setIsSearching(false);
              setSearchError(null);
              setIsOpen(hasSavedQuickItems);
            }
          }}
          placeholder={t(uiLanguage, 'searchPlaceholder')}
          className="hud-focusable min-h-11 min-w-0 flex-1 bg-transparent text-sm text-white placeholder-slate-400 focus:outline-none"
        />
        {isSearching && (
          <span
            aria-label="Searching"
            className="mr-1 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-teal-300 border-t-transparent"
          />
        )}
        {(query || selectedPlace) && (
          <button
            type="button"
            onClick={handleClearInput}
            aria-label={t(uiLanguage, 'clear')}
            className="hud-focusable flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            ✕
          </button>
        )}
      </form>

      {/* Saved Places & Recent Searches Quick Dropdown when query empty */}
      {isOpen && query.trim().length < 2 && results.length === 0 && hasSavedQuickItems && (
        <div
          aria-label="Saved places and recent searches"
          className="hud-scroll-y max-h-64 overflow-y-auto rounded-xl border border-slate-700/80 bg-slate-950/95 p-2 shadow-2xl backdrop-blur-md"
        >
          {(homePlace || workPlace) && (
            <div className="mb-2 grid grid-cols-2 gap-1.5">
              {homePlace && (
                <button
                  type="button"
                  onClick={() => finalizeSelection(homePlace)}
                  className="hud-focusable flex min-h-11 items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/90 px-2.5 text-left text-xs text-white hover:border-teal-400/50"
                >
                  <span className="shrink-0 font-bold text-teal-300">{t(uiLanguage, 'home')}</span>
                  <span className="truncate text-slate-300">{homePlace.name}</span>
                </button>
              )}
              {workPlace && (
                <button
                  type="button"
                  onClick={() => finalizeSelection(workPlace)}
                  className="hud-focusable flex min-h-11 items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/90 px-2.5 text-left text-xs text-white hover:border-sky-400/50"
                >
                  <span className="shrink-0 font-bold text-sky-300">{t(uiLanguage, 'work')}</span>
                  <span className="truncate text-slate-300">{workPlace.name}</span>
                </button>
              )}
            </div>
          )}

          {favoritePlaces.length > 0 && (
            <div className="mb-2">
              <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {t(uiLanguage, 'favorites')}
              </p>
              {favoritePlaces.slice(0, 4).map((fav) => (
                <button
                  key={fav.id}
                  type="button"
                  onClick={() => finalizeSelection(fav)}
                  className="hud-focusable flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-slate-800/70"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-amber-200">{fav.name}</p>
                    {fav.address && <p className="truncate text-[11px] text-slate-400">{fav.address}</p>}
                  </div>
                </button>
              ))}
            </div>
          )}

          {recentSearches.length > 0 && (
            <div>
              <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {t(uiLanguage, 'recentSearches')}
              </p>
              {recentSearches.slice(0, 6).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => finalizeSelection(item)}
                  className="hud-focusable flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-slate-800/70"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-white">{item.name}</p>
                    {item.address && <p className="truncate text-[11px] text-slate-400">{item.address}</p>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Suggestions Dropdown */}
      {isOpen && displayResults.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-700/80 bg-slate-950/95 shadow-2xl backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-slate-800/90 px-3 py-1.5">
            <span className="text-[11px] font-medium text-slate-400">
              {displayResults.length} results
            </span>
            <button
              type="button"
              onClick={() => setSortByDistance((v) => !v)}
              className={`hud-focusable min-h-9 rounded-lg border px-2.5 text-[11px] font-semibold transition ${
                sortByDistance
                  ? 'border-teal-400/60 bg-teal-400/15 text-teal-200'
                  : 'border-slate-700 bg-slate-900 text-slate-300'
              }`}
            >
              {sortByDistance ? t(uiLanguage, 'sortDistance') : t(uiLanguage, 'sortRelevance')}
            </button>
          </div>
          <ul
            role="listbox"
            aria-label="Location suggestions"
            className="hud-scroll-y max-h-60 overflow-y-auto"
          >
            {displayResults.map((place) => {
              const dist =
                place.computedDistanceMeters ??
                (userLocation && Array.isArray(place.coordinates)
                  ? haversineDistanceMeters(
                      [userLocation.longitude, userLocation.latitude],
                      place.coordinates,
                    )
                  : place.distanceMeters);
              const kindLabel = place.categoryLabel || place.featureType;
              return (
                <li key={place.id} className="border-b border-slate-800/80 last:border-b-0">
                  <button
                    type="button"
                    role="option"
                    aria-selected={selectedPlace?.id === place.id}
                    onClick={() => handleChooseResult(place)}
                    className="hud-focusable flex min-h-11 w-full items-start justify-between gap-3 px-3.5 py-2.5 text-left transition hover:bg-slate-800/70 active:bg-slate-800"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-sm font-semibold text-white">{place.name}</p>
                        {kindLabel && (
                          <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium capitalize text-slate-300">
                            {kindLabel}
                          </span>
                        )}
                      </div>
                      {place.address && (
                        <p className="truncate text-xs text-slate-400">{place.address}</p>
                      )}
                    </div>
                    {dist != null && (
                      <span className="shrink-0 pt-0.5 text-[11px] font-medium text-teal-300">
                        {formatDistance(dist, unitSystem)}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {searchError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-500/40 bg-rose-950/92 px-3 py-2 text-xs text-rose-100 shadow-lg backdrop-blur-md"
        >
          <span className="min-w-0 flex-1 leading-relaxed">{searchError.message}</span>
          <div className="flex items-center gap-1.5">
            {searchError.isAuthError && onOpenTokenModal && (
              <button
                type="button"
                onClick={onOpenTokenModal}
                className="hud-focusable min-h-11 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-teal-300 hover:bg-slate-800"
              >
                Token
              </button>
            )}
            {searchError.retryable && searchError.retrySpec && (
              <button
                type="button"
                onClick={handleRetrySearch}
                className="hud-focusable min-h-11 rounded-lg bg-rose-800/80 px-3 text-xs font-semibold text-white hover:bg-rose-700"
              >
                Retry
              </button>
            )}
            <button
              type="button"
              onClick={() => setSearchError(null)}
              aria-label="Dismiss search error"
              className="hud-focusable flex h-11 w-11 items-center justify-center rounded-lg text-rose-200 hover:bg-rose-800/60"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Selected Location Actions */}
      {selectedPlace && !isOpen && (
        <div className="flex flex-col gap-2.5 rounded-2xl border border-violet-400/40 bg-slate-950/92 p-3 shadow-2xl backdrop-blur-md">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-violet-400" />
                <p className="truncate text-sm font-bold text-white">{selectedPlace.name}</p>
                {(selectedPlace.categoryLabel || selectedPlace.featureType) && (
                  <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium capitalize text-slate-300">
                    {selectedPlace.categoryLabel || selectedPlace.featureType}
                  </span>
                )}
                {typeof selectedPlace.openNow === 'boolean' && (
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      selectedPlace.openNow
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-rose-500/20 text-rose-300'
                    }`}
                  >
                    {selectedPlace.openNow ? 'Open now' : 'Closed'}
                  </span>
                )}
                {distanceToSelected != null && (
                  <span className="shrink-0 text-[11px] font-semibold text-violet-300">
                    {formatDistance(distanceToSelected, unitSystem)}
                  </span>
                )}
              </div>
              {selectedPlace.address && (
                <p className="mt-0.5 truncate pl-4 text-xs text-slate-400">
                  {selectedPlace.address}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClearPlace}
              aria-label={t(uiLanguage, 'close')}
              className="hud-focusable flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              ✕
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {onToggleFavorite && (
              <button
                type="button"
                onClick={() => onToggleFavorite(selectedPlace)}
                className={`hud-focusable min-h-9 rounded-lg border px-2.5 text-[11px] font-semibold transition ${
                  isPlaceFavorited
                    ? 'border-amber-400/60 bg-amber-400/20 text-amber-200'
                    : 'border-slate-700 bg-slate-900 text-slate-200 hover:border-amber-400/40'
                }`}
              >
                {isPlaceFavorited
                  ? `★ ${t(uiLanguage, 'savedFavorite')}`
                  : `☆ ${t(uiLanguage, 'saveFavorite')}`}
              </button>
            )}
            {onSetSlotPlace && (
              <>
                <button
                  type="button"
                  onClick={() => onSetSlotPlace('home', selectedPlace)}
                  className="hud-focusable min-h-9 rounded-lg border border-slate-700 bg-slate-900 px-2.5 text-[11px] font-semibold text-teal-200 hover:border-teal-400/50"
                >
                  {t(uiLanguage, 'setHome')}
                </button>
                <button
                  type="button"
                  onClick={() => onSetSlotPlace('work', selectedPlace)}
                  className="hud-focusable min-h-9 rounded-lg border border-slate-700 bg-slate-900 px-2.5 text-[11px] font-semibold text-sky-200 hover:border-sky-400/50"
                >
                  {t(uiLanguage, 'setWork')}
                </button>
              </>
            )}
          </div>

          {hasRoute ? (
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => onExtendRoute(selectedPlace)}
                className="hud-focusable min-h-11 rounded-xl bg-teal-400 px-2 py-2 text-xs font-bold text-slate-950 active:scale-95"
              >
                {t(uiLanguage, 'extendEnd')}
              </button>
              <button
                type="button"
                onClick={() => onReplaceDestination(selectedPlace)}
                className="hud-focusable min-h-11 rounded-xl border border-slate-700 bg-slate-900 px-2 py-2 text-xs font-semibold text-slate-100 active:scale-95"
              >
                {t(uiLanguage, 'newEnd')}
              </button>
              <button
                type="button"
                onClick={() => onAddStop(selectedPlace)}
                className="hud-focusable min-h-11 rounded-xl border border-slate-700 bg-slate-900 px-2 py-2 text-xs font-semibold text-violet-300 active:scale-95"
              >
                {t(uiLanguage, 'addStop')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onRouteHere(selectedPlace)}
              className="hud-focusable min-h-11 w-full rounded-xl bg-teal-400 py-2 text-xs font-bold text-slate-950 active:scale-[0.98]"
            >
              {t(uiLanguage, 'routeHere')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
