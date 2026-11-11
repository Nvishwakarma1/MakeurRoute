import { openDB } from 'idb';

const DB_NAME = 'takeurroute-db';
const DB_VERSION = 1;
const MAX_RECENT_SEARCHES = 20;
const MAX_HISTORY_ROUTES = 25;

let dbPromise = null;

function isIndexedDbSupported() {
  return typeof globalThis.indexedDB !== 'undefined';
}

export function getNavDb() {
  if (!isIndexedDbSupported()) {
    return Promise.resolve(null);
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('places')) {
          const placesStore = db.createObjectStore('places', { keyPath: 'id' });
          placesStore.createIndex('byUpdatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('searches')) {
          const searchesStore = db.createObjectStore('searches', { keyPath: 'id' });
          searchesStore.createIndex('bySearchedAt', 'searchedAt');
        }
        if (!db.objectStoreNames.contains('routes')) {
          const routesStore = db.createObjectStore('routes', { keyPath: 'id' });
          routesStore.createIndex('byUpdatedAt', 'updatedAt');
        }
      },
    }).catch(() => {
      dbPromise = null;
      return null;
    });
  }
  return dbPromise;
}

function makePlaceSignature(place) {
  if (!place) return '';
  if (place.mapboxId) return `mb:${place.mapboxId}`;
  if (Array.isArray(place.coordinates) && place.coordinates.length >= 2) {
    return `${Number(place.coordinates[0]).toFixed(4)},${Number(place.coordinates[1]).toFixed(4)}`;
  }
  return String(place.name || '').toLowerCase();
}

function makeFavoriteId(place) {
  const sig = makePlaceSignature(place);
  return `fav_${sig || Date.now()}`;
}

export async function getSavedPlaces() {
  const db = await getNavDb();
  if (!db) return [];
  const all = await db.getAll('places');
  return all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function setSlotPlace(slot, place) {
  if (slot !== 'home' && slot !== 'work') return null;
  if (!place?.coordinates || place.coordinates.length < 2) return null;
  const db = await getNavDb();
  if (!db) return null;

  const now = Date.now();
  const entry = {
    id: `slot_${slot}`,
    slot,
    name: place.name || (slot === 'home' ? 'Home' : 'Work'),
    address: place.address || '',
    categoryLabel: place.categoryLabel || '',
    featureType: place.featureType || '',
    coordinates: [Number(place.coordinates[0]), Number(place.coordinates[1])],
    mapboxId: place.mapboxId || place.id || null,
    createdAt: now,
    updatedAt: now,
  };
  await db.put('places', entry);
  return entry;
}

export async function toggleFavoritePlace(place) {
  if (!place?.coordinates || place.coordinates.length < 2) return { added: false, entry: null };
  const db = await getNavDb();
  if (!db) return { added: false, entry: null };

  const favId = makeFavoriteId(place);
  const existing = await db.get('places', favId);
  if (existing) {
    await db.delete('places', favId);
    return { added: false, entry: null };
  }

  const now = Date.now();
  const entry = {
    id: favId,
    slot: 'favorite',
    name: place.name || 'Saved place',
    address: place.address || '',
    categoryLabel: place.categoryLabel || '',
    featureType: place.featureType || '',
    coordinates: [Number(place.coordinates[0]), Number(place.coordinates[1])],
    mapboxId: place.mapboxId || place.id || null,
    createdAt: now,
    updatedAt: now,
  };
  await db.put('places', entry);
  return { added: true, entry };
}

export function isPlaceFavorited(savedPlaces = [], place) {
  if (!place) return false;
  const targetId = makeFavoriteId(place);
  return savedPlaces.some((p) => p.slot === 'favorite' && p.id === targetId);
}

export async function deleteSavedPlace(id) {
  if (!id) return;
  const db = await getNavDb();
  if (!db) return;
  await db.delete('places', id);
}

export async function clearSavedPlaces() {
  const db = await getNavDb();
  if (!db) return;
  await db.clear('places');
}

export async function getRecentSearches() {
  const db = await getNavDb();
  if (!db) return [];
  const all = await db.getAll('searches');
  return all.sort((a, b) => (b.searchedAt || 0) - (a.searchedAt || 0));
}

export async function recordRecentSearch(place) {
  if (!place?.coordinates || place.coordinates.length < 2) return [];
  const db = await getNavDb();
  if (!db) return [];

  const sig = makePlaceSignature(place);
  const id = `srch_${sig || Date.now()}`;
  const entry = {
    id,
    name: place.name || 'Selected location',
    address: place.address || '',
    categoryLabel: place.categoryLabel || '',
    featureType: place.featureType || '',
    coordinates: [Number(place.coordinates[0]), Number(place.coordinates[1])],
    mapboxId: place.mapboxId || place.id || null,
    searchedAt: Date.now(),
  };

  await db.put('searches', entry);
  const sorted = (await db.getAll('searches')).sort(
    (a, b) => (b.searchedAt || 0) - (a.searchedAt || 0),
  );
  if (sorted.length > MAX_RECENT_SEARCHES) {
    const stale = sorted.slice(MAX_RECENT_SEARCHES);
    const tx = db.transaction('searches', 'readwrite');
    await Promise.all([...stale.map((item) => tx.store.delete(item.id)), tx.done]);
  }
  return sorted.slice(0, MAX_RECENT_SEARCHES);
}

export async function deleteRecentSearch(id) {
  if (!id) return;
  const db = await getNavDb();
  if (!db) return;
  await db.delete('searches', id);
}

export async function clearRecentSearches() {
  const db = await getNavDb();
  if (!db) return;
  await db.clear('searches');
}

function buildCompactRouteRecord({
  id,
  name,
  kind,
  rawCoordinates,
  pinnedStopIndices = [],
  routeSourceMode = 'matching',
  profile = 'driving',
  snappedRoute,
  createdAt,
}) {
  const now = Date.now();
  return {
    id,
    name: String(name || 'Custom Route').trim() || 'Custom Route',
    kind: kind === 'history' ? 'history' : 'saved',
    rawCoordinates: rawCoordinates || [],
    pinnedStopIndices: pinnedStopIndices || [],
    routeSourceMode,
    profile,
    snappedRoute: snappedRoute
      ? {
          geometry: snappedRoute.geometry,
          distance: snappedRoute.distance,
          duration: snappedRoute.duration,
          durationTypical: snappedRoute.durationTypical ?? null,
          confidence: snappedRoute.confidence ?? 1,
          steps: snappedRoute.steps || [],
          legsSummary: snappedRoute.legsSummary || [],
          cumulativeDistances: snappedRoute.cumulativeDistances || [],
          maxSpeeds: snappedRoute.maxSpeeds || [],
          subMatchCount: snappedRoute.subMatchCount ?? 1,
          warning: snappedRoute.warning ?? null,
          failedSegments: snappedRoute.failedSegments || [],
          gapSegments: snappedRoute.gapSegments || [],
          unmatchedPointCount: snappedRoute.unmatchedPointCount ?? 0,
        }
      : null,
    createdAt: createdAt || now,
    updatedAt: now,
  };
}

export async function getSavedRoutes() {
  const db = await getNavDb();
  if (!db) return [];
  const all = await db.getAll('routes');
  return all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function saveNamedRoute({
  name,
  rawCoordinates,
  pinnedStopIndices = [],
  routeSourceMode = 'matching',
  profile = 'driving',
  snappedRoute,
}) {
  const db = await getNavDb();
  if (!db || !snappedRoute?.geometry?.coordinates?.length) return null;

  const id = `rt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const entry = buildCompactRouteRecord({
    id,
    name,
    kind: 'saved',
    rawCoordinates,
    pinnedStopIndices,
    routeSourceMode,
    profile,
    snappedRoute,
  });
  await db.put('routes', entry);
  return entry;
}

export async function recordRouteHistory({
  name,
  rawCoordinates,
  pinnedStopIndices = [],
  routeSourceMode = 'matching',
  profile = 'driving',
  snappedRoute,
}) {
  const db = await getNavDb();
  if (!db || !snappedRoute?.geometry?.coordinates?.length) return null;

  const start = rawCoordinates?.[0];
  const end = rawCoordinates?.[rawCoordinates.length - 1];
  const sig =
    start && end
      ? `${start[0].toFixed(3)},${start[1].toFixed(3)}->${end[0].toFixed(3)},${end[1].toFixed(3)}:${routeSourceMode}`
      : `${Date.now()}`;
  const id = `hist_${sig}`;

  const existing = await db.get('routes', id);
  const entry = buildCompactRouteRecord({
    id,
    name: existing?.name || name || (routeSourceMode === 'matching' ? 'Bypass Route' : 'Route'),
    kind: 'history',
    rawCoordinates,
    pinnedStopIndices,
    routeSourceMode,
    profile,
    snappedRoute,
    createdAt: existing?.createdAt,
  });

  await db.put('routes', entry);

  const historyItems = (await db.getAll('routes'))
    .filter((r) => r.kind === 'history')
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  if (historyItems.length > MAX_HISTORY_ROUTES) {
    const stale = historyItems.slice(MAX_HISTORY_ROUTES);
    const tx = db.transaction('routes', 'readwrite');
    await Promise.all([...stale.map((item) => tx.store.delete(item.id)), tx.done]);
  }
  return entry;
}

export async function renameSavedRoute(id, newName) {
  const trimmed = String(newName || '').trim();
  if (!id || !trimmed) return null;
  const db = await getNavDb();
  if (!db) return null;
  const existing = await db.get('routes', id);
  if (!existing) return null;
  const updated = {
    ...existing,
    name: trimmed,
    kind: 'saved',
    updatedAt: Date.now(),
  };
  await db.put('routes', updated);
  return updated;
}

export async function deleteSavedRoute(id) {
  if (!id) return;
  const db = await getNavDb();
  if (!db) return;
  await db.delete('routes', id);
}

export async function clearSavedRoutes({ onlyHistory = false } = {}) {
  const db = await getNavDb();
  if (!db) return;
  if (!onlyHistory) {
    await db.clear('routes');
    return;
  }
  const all = await db.getAll('routes');
  const historyIds = all.filter((r) => r.kind === 'history').map((r) => r.id);
  if (historyIds.length === 0) return;
  const tx = db.transaction('routes', 'readwrite');
  await Promise.all([...historyIds.map((id) => tx.store.delete(id)), tx.done]);
}

export async function clearAllStoredNavData() {
  await Promise.all([clearSavedPlaces(), clearRecentSearches(), clearSavedRoutes()]);
}
