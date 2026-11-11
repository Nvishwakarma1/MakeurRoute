import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Map, { Layer, Marker, Source } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import DrawControl from './components/DrawControl.jsx';
import NavigationHUD from './components/NavigationHUD.jsx';
import TokenModal, { TokenSetupScreen } from './components/TokenModal.jsx';
import TripSummaryModal from './components/TripSummaryModal.jsx';
import { useGeolocation } from './hooks/useGeolocation.js';
import { useMapStyle } from './hooks/useMapStyle.js';
import { useNavigation } from './hooks/useNavigation.js';
import { usePoiDiscovery } from './hooks/usePoiDiscovery.js';
import { usePrefersReducedMotion } from './hooks/usePrefersReducedMotion.js';
import { useRoute } from './hooks/useRoute.js';
import { useSavedData } from './hooks/useSavedData.js';
import { useVoiceGuidance } from './hooks/useVoiceGuidance.js';
import { useWakeLock } from './hooks/useWakeLock.js';
import { POI_CATEGORIES } from './services/mapboxGeocoding.js';
import {
  clearSavedLastRoute,
  getInitialToken,
  hasStoredTokenOverride,
  isValidMapboxToken,
  persistTokenToStorage,
  useNavigationStore,
} from './store/navigationContext.js';
import { NavigationProvider } from './store/navigationStore.jsx';
import {
  DEFAULT_FADE_DURATION,
  DEFAULT_MAX_PITCH,
  DEFAULT_MAX_TILE_CACHE_SIZE,
} from './utils/mapOptimization.js';
import { decodeRouteFromHash } from './utils/routeIO.js';

const SavedHubModal = lazy(() => import('./components/SavedHubModal.jsx'));
const ShareImportModal = lazy(() => import('./components/ShareImportModal.jsx'));
const RoutePlannerSheet = lazy(() => import('./components/RoutePlannerSheet.jsx'));
const SettingsModal = lazy(() => import('./components/SettingsModal.jsx'));

const POI_COLOR_MAP = Object.fromEntries(POI_CATEGORIES.map((c) => [c.id, c.color]));
const DEFAULT_CENTER = { longitude: -98.5795, latitude: 39.8283, zoom: 4 };

function NavigatorShell() {
  const [mapboxToken, setMapboxToken] = useState(getInitialToken);
  const [tokenDraft, setTokenDraft] = useState('');
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [savedHubTab, setSavedHubTab] = useState(null);
  const [showShareImport, setShowShareImport] = useState(false);
  const [showPlanner, setShowPlanner] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [openNowOnly, setOpenNowOnly] = useState(false);
  const [isSearchBrowsing, setIsSearchBrowsing] = useState(false);
  const [mapBearing, setMapBearing] = useState(0);
  const [isMapLoaded, setIsMapLoaded] = useState(false);

  const mapRef = useRef(null);
  const drawRef = useRef(null);
  const userMovedMapRef = useRef(false);
  const fixHandlerRef = useRef(null);
  const consumedShareHashRef = useRef('');

  const { state, dispatch } = useNavigationStore();
  const prefersReducedMotion = usePrefersReducedMotion();
  const hasValidToken = isValidMapboxToken(mapboxToken);

  const {
    savedPlaces,
    homePlace,
    workPlace,
    favoritePlaces,
    recentSearches,
    savedRoutes,
    isPlaceFavorited,
    setHomeOrWork,
    toggleFavorite,
    deletePlace,
    recordSearch,
    deleteRecentSearch,
    saveCurrentRoute,
    renameSavedRoute,
    deleteSavedRoute,
    clearRecentSearches,
    clearRouteHistory,
    clearAllData,
  } = useSavedData();

  const stableLocationFixCallback = useCallback((fix) => {
    fixHandlerRef.current?.(fix);
  }, []);

  const {
    status: geoStatus,
    positionRef,
    userLocation,
    weakAccuracyMeters,
    isLocating,
    geoError,
    requestLocation,
    retryGeolocation,
    dismissGeoError,
  } = useGeolocation({
    onValidLocationFix: stableLocationFixCallback,
    enabled: hasValidToken,
  });

  const { wakeLockNotice, dismissWakeLockNotice } = useWakeLock(state.isNavigating);

  const {
    mapStyleUrl,
    useStandardSlots,
    isStyleReady,
    styleGeneration,
    satelliteFallbackActive,
    satelliteNotice,
    dismissSatelliteNotice,
    retryStandardSatellite,
    mapRetryNonce,
    tileError,
    isTileRequestsPaused,
    dismissTileError,
    retryTiles,
    cycleMapTheme,
    handleMapLoad,
    handleMapStyleData,
    handleMapError,
    handleMapIdle,
  } = useMapStyle({
    mapTheme: state.mapTheme,
    dispatch,
    mapRef,
  });

  const {
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
  } = usePoiDiscovery({
    accessToken: mapboxToken,
    mapRef,
    userLocation,
    routeCoordinates: state.snappedRoute?.geometry?.coordinates || null,
  });

  const {
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
  } = useRoute({
    accessToken: mapboxToken,
    mapRef,
    drawRef,
    userLocation,
    prefersReducedMotion,
  });

  const {
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
  } = useNavigation({
    userLocation,
    positionRef,
    geoStatus,
    requestLocation,
    mapRef,
    isMapLoaded,
    drawRef,
    fitBoundsForCoordinates,
    prefersReducedMotion,
    onAutoReroute: triggerAutoReroute,
    isTileRequestsPaused,
    isSearchBrowsing,
  });

  const handleRetryTiles = useCallback(() => {
    setIsMapLoaded(false);
    retryTiles();
  }, [retryTiles]);

  useVoiceGuidance({
    isNavigating: state.isNavigating,
    voiceMuted: state.voiceMuted,
    voiceLanguage: state.voiceLanguage,
    unitSystem: state.unitSystem,
    snappedRoute: state.snappedRoute,
    nextStepInfo,
    hasArrived,
    tripSummary: state.tripSummary,
    isRerouting: state.isRerouting,
    isOverSpeedLimit,
    speedLimit,
  });

  // Auto-load shared `#route=...` hash links on startup once a token is configured
  useEffect(() => {
    if (!hasValidToken || typeof window === 'undefined') return;
    const rawHash = window.location.hash || '';
    if (!rawHash.startsWith('#route=') || consumedShareHashRef.current === rawHash) return;
    const decoded = decodeRouteFromHash(rawHash);
    if (decoded) {
      consumedShareHashRef.current = rawHash;
      loadExternalRoute(decoded);
    }
  }, [hasValidToken, loadExternalRoute]);

  const visiblePoiPlaces = useMemo(() => {
    if (!openNowOnly) return poiPlaces;
    return poiPlaces.filter((poi) => poi.openNow === true);
  }, [poiPlaces, openNowOnly]);

  // Sync latest monotonic tracker into stable geolocation fix callback
  useEffect(() => {
    fixHandlerRef.current = handleValidLocationFix;
  }, [handleValidLocationFix]);

  const getSearchProximity = useCallback(() => {
    const center = mapRef.current?.getCenter?.();
    if (center && Number.isFinite(center.lng) && Number.isFinite(center.lat)) {
      return [center.lng, center.lat];
    }
    if (userLocation) {
      return [userLocation.longitude, userLocation.latitude];
    }
    return undefined;
  }, [userLocation]);

  const handleSaveToken = useCallback(
    (event) => {
      event.preventDefault();
      const trimmed = tokenDraft.trim();
      if (!isValidMapboxToken(trimmed)) return;
      persistTokenToStorage(trimmed);
      setMapboxToken(trimmed);
      setShowTokenModal(false);
      dismissRouteError();
      dismissTileError();
      dismissPoiError();
    },
    [tokenDraft, dismissRouteError, dismissTileError, dismissPoiError],
  );

  const handleClearStoredToken = useCallback(() => {
    persistTokenToStorage('');
    const envFallback = getInitialToken();
    setMapboxToken(envFallback);
    setTokenDraft(envFallback);
    setShowTokenModal(false);
  }, []);

  const handleOpenTokenModal = useCallback(() => {
    setTokenDraft(hasValidToken ? mapboxToken : '');
    setShowTokenModal(true);
  }, [hasValidToken, mapboxToken]);

  const accuracyLayerSlot = useStandardSlots ? { slot: 'bottom' } : {};
  const routeLayerSlot = useStandardSlots ? { slot: 'middle' } : {};
  const storedTokenOverride = hasStoredTokenOverride();

  return (
    <div className="relative h-dvh w-screen overflow-hidden bg-[#090d16]">
      {hasValidToken ? (
        <Map
          key={`${mapboxToken}-${mapRetryNonce}`}
          ref={mapRef}
          initialViewState={DEFAULT_CENTER}
          mapboxAccessToken={mapboxToken}
          mapStyle={mapStyleUrl}
          maxPitch={DEFAULT_MAX_PITCH}
          fadeDuration={DEFAULT_FADE_DURATION}
          maxTileCacheSize={DEFAULT_MAX_TILE_CACHE_SIZE}
          style={{ width: '100%', height: '100%' }}
          interactiveLayerIds={
            alternativeRoutesGeoJson.features.length > 0 ? ['alternative-routes-line'] : []
          }
          onClick={(e) => {
            const altIdx = e.features?.[0]?.properties?.alternativeIndex;
            if (typeof altIdx === 'number') {
              selectAlternativeRoute(altIdx);
            }
          }}
          onLoad={(e) => {
            setIsMapLoaded(true);
            handleMapLoad(e);
            updateUserOffScreen();
          }}
          onStyleData={handleMapStyleData}
          onError={handleMapError}
          onIdle={handleMapIdle}
          onMove={(e) => {
            const nextBearing = Math.round(e.viewState?.bearing || 0);
            setMapBearing((prev) => (prev === nextBearing ? prev : nextBearing));
            updateUserOffScreen();
          }}
          onMoveStart={(e) => {
            if (e.originalEvent) {
              dispatch({ type: 'SET_FOLLOW_USER', payload: false });
              markManualPan();
              userMovedMapRef.current = true;
            }
          }}
          onMoveEnd={() => {
            updateUserOffScreen();
            if (userMovedMapRef.current) {
              userMovedMapRef.current = false;
              markPoiAreaDirtyIfActive();
            }
          }}
        >
          <DrawControl
            ref={drawRef}
            position="top-left"
            onCreate={handleDrawCreate}
            onUpdate={handleDrawUpdate}
            onDelete={handleDrawDelete}
            onModeChange={handleDrawModeChange}
            onDrawProgress={handleDrawProgress}
          />

          {isStyleReady && (
            <Fragment key={styleGeneration}>
              {/* GPS accuracy radius */}
              <Source id="gps-accuracy-source" type="geojson" data={accuracyCircleGeoJson}>
                <Layer
                  id="gps-accuracy-fill"
                  type="fill"
                  {...accuracyLayerSlot}
                  paint={{
                    'fill-color': '#2dd4bf',
                    'fill-opacity': userLocation?.isCoarse ? 0.16 : 0.14,
                  }}
                />
                <Layer
                  id="gps-accuracy-ring"
                  type="line"
                  {...accuracyLayerSlot}
                  paint={{
                    'line-color': '#2dd4bf',
                    'line-width': 1.5,
                    'line-opacity': userLocation?.isCoarse ? 0.6 : 0.4,
                  }}
                />
              </Source>

              {/* Alternative routes (tappable below the selected teal route) */}
              <Source id="alternative-routes-source" type="geojson" data={alternativeRoutesGeoJson}>
                <Layer
                  id="alternative-routes-line"
                  type="line"
                  {...routeLayerSlot}
                  layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                  paint={{
                    'line-color': '#64748b',
                    'line-width': 6,
                    'line-opacity': 0.65,
                  }}
                />
              </Source>

              {/* Snapped route casing & split traveled/remaining geometry */}
              <Source id="snapped-remaining-source" type="geojson" data={remainingRouteGeoJson}>
                <Layer
                  id="snapped-route-casing"
                  type="line"
                  {...routeLayerSlot}
                  layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                  paint={{
                    'line-color': '#042f2e',
                    'line-width': 10,
                    'line-opacity': 0.85,
                  }}
                />
                <Layer
                  id="snapped-route-remaining"
                  type="line"
                  {...routeLayerSlot}
                  layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                  paint={{
                    'line-color': state.isPreviewingRoute ? '#38bdf8' : '#2dd4bf',
                    'line-width': 6,
                    'line-opacity': state.isPreviewingRoute ? 0.85 : 1,
                  }}
                />
              </Source>

              <Source id="snapped-traveled-source" type="geojson" data={traveledRouteGeoJson}>
                <Layer
                  id="snapped-route-traveled"
                  type="line"
                  {...routeLayerSlot}
                  layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                  paint={{
                    'line-color': '#64748b',
                    'line-width': 5,
                    'line-opacity': 0.75,
                  }}
                />
              </Source>

              {/* Unmatched off-road stretches (NoSegment/tracepoints) or multi-sub-match gaps */}
              <Source id="failed-segments-source" type="geojson" data={failedSegmentsGeoJson}>
                <Layer
                  id="failed-segments-line"
                  type="line"
                  {...routeLayerSlot}
                  layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                  paint={{
                    'line-color': '#fb7185',
                    'line-width': 5,
                    'line-dasharray': [2, 2],
                    'line-opacity': 0.95,
                  }}
                />
              </Source>
            </Fragment>
          )}

          {/* Start & Destination markers for the active route */}
          {routeEndpoints && (
            <>
              <Marker longitude={routeEndpoints.start[0]} latitude={routeEndpoints.start[1]} anchor="center">
                <div className="h-4 w-4 rounded-full border-2 border-white bg-emerald-400 shadow-lg" />
              </Marker>
              <Marker longitude={routeEndpoints.end[0]} latitude={routeEndpoints.end[1]} anchor="center">
                <div className="h-4 w-4 rounded-full border-2 border-white bg-rose-500 shadow-lg" />
              </Marker>
            </>
          )}

          {/* Category POI pins (stores, restaurants, cafes, fuel, etc.) */}
          {visiblePoiPlaces
            .filter((poi) => poi.id !== state.selectedPlace?.id)
            .map((poi) => {
              const pinColor = POI_COLOR_MAP[poi.categoryId] || '#f59e0b';
              const disableInteraction = state.isDrawing || state.isEditingPath;
              return (
                <Marker
                  key={poi.id}
                  longitude={poi.coordinates[0]}
                  latitude={poi.coordinates[1]}
                  anchor="bottom"
                  style={{ zIndex: 5 }}
                  onClick={(e) => {
                    if (disableInteraction) return;
                    e.originalEvent?.stopPropagation();
                    handleSelectPlace(poi);
                  }}
                >
                  <button
                    type="button"
                    disabled={disableInteraction}
                    aria-label={poi.name}
                    className={`hud-focusable flex flex-col items-center transition-transform ${
                      disableInteraction
                        ? 'pointer-events-none opacity-45'
                        : 'cursor-pointer hover:scale-105 active:scale-95'
                    }`}
                  >
                    <span className="mb-0.5 max-w-[116px] truncate rounded-md border border-white/15 bg-slate-950/90 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-md backdrop-blur-sm">
                      {poi.name}
                    </span>
                    <span
                      className="h-3.5 w-3.5 rounded-full border-2 border-white shadow-md"
                      style={{ backgroundColor: pinColor }}
                    />
                  </button>
                </Marker>
              );
            })}

          {/* Searched or tapped location pin */}
          {state.selectedPlace && (
            <Marker
              longitude={state.selectedPlace.coordinates[0]}
              latitude={state.selectedPlace.coordinates[1]}
              anchor="bottom"
              style={{ zIndex: 15 }}
            >
              <div className="flex flex-col items-center">
                <span className="mb-1 max-w-[160px] truncate rounded-lg border border-violet-400/50 bg-slate-950/90 px-2 py-0.5 text-[11px] font-semibold text-violet-200 shadow-lg">
                  {state.selectedPlace.name}
                </span>
                <div className="h-4 w-4 rounded-full border-2 border-white bg-violet-500 shadow-[0_0_12px_rgba(139,92,246,0.9)]" />
              </div>
            </Marker>
          )}

          {/* Coarse (>100m) halo center indicator (un-snapped desktop / weak signal) */}
          {!displayUserCoord && rawUserCoord && userLocation?.isCoarse && (
            <Marker
              longitude={rawUserCoord[0]}
              latitude={rawUserCoord[1]}
              anchor="center"
              style={{ zIndex: 18 }}
            >
              <div
                aria-label="Approximate location"
                className="relative flex h-6 w-6 items-center justify-center"
              >
                <span className="absolute h-6 w-6 animate-ping rounded-full bg-amber-300/35" />
                <span className="relative h-3 w-3 rounded-full border-2 border-white bg-amber-400 shadow-md" />
              </div>
            </Marker>
          )}

          {/* Live directional GPS puck */}
          {displayUserCoord && (
            <Marker
              longitude={displayUserCoord[0]}
              latitude={displayUserCoord[1]}
              anchor="center"
              style={{ zIndex: 20 }}
              rotation={userLocation?.heading || 0}
              rotationAlignment="map"
              pitchAlignment="map"
            >
              <div className="relative flex h-9 w-9 items-center justify-center">
                <span className="absolute h-9 w-9 animate-ping rounded-full bg-teal-400/25" />
                <svg
                  viewBox="0 0 32 32"
                  className="relative h-8 w-8 drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)]"
                  aria-hidden="true"
                >
                  <circle cx="16" cy="16" r="13" fill="#0f172a" stroke="#2dd4bf" strokeWidth="2.5" />
                  <path d="M16 6 L22.5 22 L16 18.5 L9.5 22 Z" fill="#2dd4bf" />
                </svg>
              </div>
            </Marker>
          )}
        </Map>
      ) : (
        <TokenSetupScreen
          tokenDraft={tokenDraft}
          onTokenDraftChange={setTokenDraft}
          onSaveToken={handleSaveToken}
        />
      )}

      {hasValidToken && (
        <NavigationHUD
          accessToken={mapboxToken}
          userLocation={userLocation}
          geoStatus={geoStatus}
          weakAccuracyMeters={weakAccuracyMeters}
          isLocating={isLocating}
          isUserOffScreen={isUserOffScreen}
          getSearchProximity={getSearchProximity}
          geoError={geoError}
          findMeNotice={findMeNotice}
          routeError={state.routeError}
          routeNotice={state.routeNotice}
          satelliteNotice={satelliteNotice}
          satelliteFallbackActive={satelliteFallbackActive}
          tileError={tileError}
          poiError={poiError}
          wakeLockNotice={wakeLockNotice}
          onRetryGeo={retryGeolocation}
          onDismissGeoError={dismissGeoError}
          onDismissFindMeNotice={dismissFindMeNotice}
          onRetryRoute={retryRoute}
          onDismissRouteError={dismissRouteError}
          onDismissRouteNotice={dismissRouteNotice}
          onDismissSatelliteNotice={dismissSatelliteNotice}
          onRetryStandardSatellite={retryStandardSatellite}
          onRetryTiles={handleRetryTiles}
          onDismissTileError={dismissTileError}
          onRetryPois={refreshPois}
          onDismissPoiError={dismissPoiError}
          onDismissWakeLockNotice={dismissWakeLockNotice}
          isDrawing={state.isDrawing}
          isEditingPath={state.isEditingPath}
          isMatching={state.isMatching}
          isRerouting={state.isRerouting}
          onCancelReroute={cancelReroute}
          snappedRoute={state.snappedRoute}
          alternativeRoutes={state.alternativeRoutes}
          selectedRouteIndex={state.selectedRouteIndex}
          onSelectAlternativeRoute={selectAlternativeRoute}
          isOfflineCachedRoute={state.isOfflineCachedRoute}
          hasSavedLastRoute={state.hasSavedLastRoute}
          onRestoreLastRoute={restoreLastSavedRoute}
          routeProgress={routeProgress}
          speedLimit={speedLimit}
          isOverSpeedLimit={isOverSpeedLimit}
          mapBearing={mapBearing}
          nextStepInfo={nextStepInfo}
          hasArrived={hasArrived}
          isNavigating={state.isNavigating}
          followUser={state.followUser}
          headingUp={state.headingUp}
          profile={state.profile}
          mapTheme={state.mapTheme}
          unitSystem={state.unitSystem}
          timeFormat={state.timeFormat}
          uiLanguage={state.uiLanguage}
          voiceMuted={state.voiceMuted}
          onToggleVoiceMuted={() =>
            dispatch({ type: 'SET_VOICE_MUTED', payload: (prev) => !prev })
          }
          isPreviewingRoute={state.isPreviewingRoute}
          liveDrawCoordinates={state.liveDrawCoordinates}
          canUndo={state.drawUndoPast.length > 0 || (state.isDrawing && state.liveDrawCoordinates.length > 0)}
          canRedo={state.drawUndoFuture.length > 0}
          rawWaypointCount={state.rawCoordinates.length}
          onCommitRoutePreview={commitRoutePreview}
          onUndoRouteEdit={undoRouteEdit}
          onRedoRouteEdit={redoRouteEdit}
          onDropLastDrawPoint={dropLastDrawPoint}
          selectedPlace={state.selectedPlace}
          homePlace={homePlace}
          workPlace={workPlace}
          favoritePlaces={favoritePlaces}
          recentSearches={recentSearches}
          isSelectedPlaceFavorited={isPlaceFavorited(state.selectedPlace)}
          onRecordRecentSearch={recordSearch}
          onToggleFavoritePlace={toggleFavorite}
          onSetSlotPlace={setHomeOrWork}
          activePoiCategory={activePoiCategory}
          alongRouteOnly={alongRouteOnly}
          openNowOnly={openNowOnly}
          poiCount={visiblePoiPlaces.length}
          isLoadingPois={isLoadingPois}
          poiAreaDirty={poiAreaDirty}
          onTogglePoiCategory={togglePoiCategory}
          onToggleAlongRoute={toggleAlongRouteMode}
          onToggleOpenNowOnly={() => setOpenNowOnly((v) => !v)}
          onRefreshPois={refreshPois}
          onClearPois={clearPois}
          onSelectPlace={handleSelectPlace}
          onClearPlace={() => dispatch({ type: 'SET_SELECTED_PLACE', payload: null })}
          onRouteHere={handleRouteHere}
          onExtendRoute={handleExtendRoute}
          onReplaceDestination={handleReplaceDestination}
          onAddStop={handleAddStop}
          onStartDrawing={handleStartDrawing}
          onFinishDrawing={handleFinishDrawing}
          onEditPath={handleEditPath}
          onClearRoute={handleClearRoute}
          onFitRoute={handleFitRoute}
          onFindMe={handleFindMe}
          onToggleHeadingUp={handleToggleHeadingUp}
          onResetNorth={handleResetNorth}
          onToggleNavigation={handleToggleNavigation}
          onChangeProfile={handleChangeProfile}
          onCycleMapTheme={cycleMapTheme}
          onOpenSavedHub={(tab) => setSavedHubTab(tab || 'places')}
          onOpenPlanner={() => setShowPlanner(true)}
          onOpenShareImport={() => setShowShareImport(true)}
          onOpenSettings={() => setShowSettings(true)}
          onOpenTokenModal={handleOpenTokenModal}
          onSearchOpenChange={setIsSearchBrowsing}
          liteModeEnabled={state.liteModeEnabled}
          onToggleLiteMode={() =>
            dispatch({ type: 'SET_LITE_MODE', payload: (prev) => !prev })
          }
        />
      )}

      <Suspense fallback={null}>
        {savedHubTab && (
          <SavedHubModal
            isOpen
            initialTab={savedHubTab}
            uiLanguage={state.uiLanguage}
            unitSystem={state.unitSystem}
            homePlace={homePlace}
            workPlace={workPlace}
            favoritePlaces={favoritePlaces}
            recentSearches={recentSearches}
            savedRoutes={savedRoutes}
            hasActiveRoute={Boolean(state.snappedRoute)}
            defaultRouteName={state.routeName}
            onClose={() => setSavedHubTab(null)}
            onSelectPlace={handleSelectPlace}
            onDeletePlace={deletePlace}
            onDeleteRecentSearch={deleteRecentSearch}
            onSaveCurrentRoute={async (name) => {
              dispatch({ type: 'SET_ROUTE_NAME', payload: name });
              await saveCurrentRoute({
                name,
                rawCoordinates: state.rawCoordinates,
                pinnedStopIndices: state.pinnedStopIndices,
                routeSourceMode: state.routeSourceMode,
                profile: state.profile,
                snappedRoute: state.snappedRoute,
              });
            }}
            onLoadRoute={loadExternalRoute}
            onRenameRoute={renameSavedRoute}
            onDeleteRoute={deleteSavedRoute}
          />
        )}

        {showShareImport && (
          <ShareImportModal
            isOpen
            uiLanguage={state.uiLanguage}
            routeName={state.routeName}
            routeSourceMode={state.routeSourceMode}
            profile={state.profile}
            snappedRoute={state.snappedRoute}
            rawCoordinates={state.rawCoordinates}
            pinnedStopIndices={state.pinnedStopIndices}
            onClose={() => setShowShareImport(false)}
            onImportRoute={(imported) => loadExternalRoute(imported)}
          />
        )}

        {showPlanner && (
          <RoutePlannerSheet
            isOpen
            uiLanguage={state.uiLanguage}
            unitSystem={state.unitSystem}
            rawCoordinates={state.rawCoordinates}
            snappedRoute={state.snappedRoute}
            routeSourceMode={state.routeSourceMode}
            onClose={() => setShowPlanner(false)}
            onReorderWaypoints={reorderWaypoints}
            onRemoveWaypoint={removeWaypoint}
            onToggleRoundTrip={toggleRoundTrip}
          />
        )}

        {showSettings && (
          <SettingsModal
            isOpen
            uiLanguage={state.uiLanguage}
            mapTheme={state.mapTheme}
            unitSystem={state.unitSystem}
            timeFormat={state.timeFormat}
            voiceMuted={state.voiceMuted}
            voiceLanguage={state.voiceLanguage}
            speedAlertEnabled={state.speedAlertEnabled}
            liteModeEnabled={state.liteModeEnabled}
            navLightStyleEnabled={state.navLightStyleEnabled}
            avoid={state.avoid}
            savedRoutesCount={savedRoutes.length}
            savedPlacesCount={savedPlaces.length}
            onClose={() => setShowSettings(false)}
            onChangeUiLanguage={(lang) => dispatch({ type: 'SET_UI_LANGUAGE', payload: lang })}
            onChangeMapTheme={(theme) => dispatch({ type: 'SET_MAP_THEME', payload: theme })}
            onChangeUnitSystem={(unit) => dispatch({ type: 'SET_UNIT_SYSTEM', payload: unit })}
            onChangeTimeFormat={(fmt) => dispatch({ type: 'SET_TIME_FORMAT', payload: fmt })}
            onToggleVoiceMute={() =>
              dispatch({ type: 'SET_VOICE_MUTED', payload: (prev) => !prev })
            }
            onChangeVoiceLanguage={(lang) =>
              dispatch({ type: 'SET_VOICE_LANGUAGE', payload: lang })
            }
            onToggleSpeedAlert={() =>
              dispatch({
                type: 'SET_SPEED_ALERT_ENABLED',
                payload: !state.speedAlertEnabled,
              })
            }
            onToggleLiteMode={() =>
              dispatch({ type: 'SET_LITE_MODE', payload: (prev) => !prev })
            }
            onToggleNavLightStyle={() =>
              dispatch({ type: 'SET_NAV_LIGHT_STYLE', payload: (prev) => !prev })
            }
            onToggleAvoid={handleToggleAvoid}
            onClearRecentSearches={clearRecentSearches}
            onClearRouteHistory={clearRouteHistory}
            onClearAllData={async () => {
              await clearAllData();
              clearSavedLastRoute();
              dispatch({ type: 'SET_HAS_SAVED_LAST_ROUTE', payload: false });
            }}
            onOpenTokenModal={handleOpenTokenModal}
          />
        )}
      </Suspense>

      <TripSummaryModal
        summary={state.tripSummary}
        unitSystem={state.unitSystem}
        timeFormat={state.timeFormat}
        onDismiss={() => dispatch({ type: 'DISMISS_TRIP_SUMMARY' })}
        onClearAndClose={() => {
          dispatch({ type: 'DISMISS_TRIP_SUMMARY' });
          handleClearRoute();
        }}
      />

      <TokenModal
        isOpen={showTokenModal}
        tokenDraft={tokenDraft}
        hasStoredTokenOverride={storedTokenOverride}
        onTokenDraftChange={setTokenDraft}
        onSaveToken={handleSaveToken}
        onClearStoredToken={handleClearStoredToken}
        onClose={() => setShowTokenModal(false)}
      />
    </div>
  );
}

export default function App() {
  return (
    <NavigationProvider>
      <NavigatorShell />
    </NavigationProvider>
  );
}
