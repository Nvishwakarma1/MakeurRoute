import { useState } from 'react';
import { formatDistance, formatDuration } from '../utils/geo.js';
import { t } from '../utils/i18n.js';

/**
 * Lazy-loaded IndexedDB hub for Home/Work/Favorites places and Saved Routes / History.
 */
export default function SavedHubModal({
  isOpen,
  initialTab = 'places',
  uiLanguage = 'en',
  unitSystem = 'metric',
  homePlace,
  workPlace,
  favoritePlaces = [],
  recentSearches = [],
  savedRoutes = [],
  hasActiveRoute,
  defaultRouteName = 'Custom Bypass Route',
  onClose,
  onSelectPlace,
  onDeletePlace,
  onDeleteRecentSearch,
  onSaveCurrentRoute,
  onLoadRoute,
  onRenameRoute,
  onDeleteRoute,
}) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [routeNameDraft, setRouteNameDraft] = useState(defaultRouteName);
  const [editingRouteId, setEditingRouteId] = useState(null);
  const [editingNameDraft, setEditingNameDraft] = useState('');
  const [statusFeedback, setStatusFeedback] = useState('');

  if (!isOpen) return null;

  const savedOnly = savedRoutes.filter((r) => r.kind === 'saved');
  const historyOnly = savedRoutes.filter((r) => r.kind === 'history');

  const handleSaveSubmit = async (e) => {
    e.preventDefault();
    const cleaned = routeNameDraft.trim() || defaultRouteName;
    await onSaveCurrentRoute(cleaned);
    setStatusFeedback(`Saved "${cleaned}" for offline access.`);
  };

  const handleRenameSubmit = async (id) => {
    const cleaned = editingNameDraft.trim();
    if (!cleaned) return;
    await onRenameRoute(id, cleaned);
    setEditingRouteId(null);
    setEditingNameDraft('');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Saved places and routes"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 p-3 backdrop-blur-md sm:items-center"
    >
      <div className="hud-surface flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-slate-700/80 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setActiveTab('places')}
              className={`hud-focusable min-h-11 rounded-xl px-3.5 text-xs font-bold transition ${
                activeTab === 'places'
                  ? 'bg-teal-400 text-slate-950'
                  : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
            >
              {t(uiLanguage, 'savedPlaces')} ({favoritePlaces.length + (homePlace ? 1 : 0) + (workPlace ? 1 : 0)})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('routes')}
              className={`hud-focusable min-h-11 rounded-xl px-3.5 text-xs font-bold transition ${
                activeTab === 'routes'
                  ? 'bg-teal-400 text-slate-950'
                  : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
            >
              {t(uiLanguage, 'savedRoutes')} ({savedRoutes.length})
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t(uiLanguage, 'close')}
            className="hud-focusable flex h-11 w-11 items-center justify-center rounded-xl text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="hud-scroll-y flex flex-col gap-3 overflow-y-auto p-4">
          {activeTab === 'places' ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-teal-300">
                    {t(uiLanguage, 'home')}
                  </p>
                  {homePlace ? (
                    <div className="mt-1 flex flex-col gap-2">
                      <p className="truncate text-xs font-semibold text-white">{homePlace.name}</p>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            onSelectPlace(homePlace);
                            onClose();
                          }}
                          className="hud-focusable min-h-9 flex-1 rounded-lg bg-teal-400 px-2 text-[11px] font-bold text-slate-950"
                        >
                          Select
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeletePlace(homePlace.id)}
                          aria-label="Remove Home"
                          className="hud-focusable min-h-9 rounded-lg border border-slate-700 px-2 text-[11px] text-slate-300"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-1 text-[11px] text-slate-500">
                      Search any address and tap Set Home
                    </p>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-sky-300">
                    {t(uiLanguage, 'work')}
                  </p>
                  {workPlace ? (
                    <div className="mt-1 flex flex-col gap-2">
                      <p className="truncate text-xs font-semibold text-white">{workPlace.name}</p>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            onSelectPlace(workPlace);
                            onClose();
                          }}
                          className="hud-focusable min-h-9 flex-1 rounded-lg bg-sky-400 px-2 text-[11px] font-bold text-slate-950"
                        >
                          Select
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeletePlace(workPlace.id)}
                          aria-label="Remove Work"
                          className="hud-focusable min-h-9 rounded-lg border border-slate-700 px-2 text-[11px] text-slate-300"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-1 text-[11px] text-slate-500">
                      Search any address and tap Set Work
                    </p>
                  )}
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  {t(uiLanguage, 'favorites')}
                </p>
                {favoritePlaces.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-800 px-3 py-4 text-center text-xs text-slate-500">
                    No favorites saved yet.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {favoritePlaces.map((place) => (
                      <li
                        key={place.id}
                        className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onSelectPlace(place);
                            onClose();
                          }}
                          className="hud-focusable min-h-11 min-w-0 flex-1 text-left"
                        >
                          <p className="truncate text-xs font-semibold text-white">{place.name}</p>
                          {place.address && (
                            <p className="truncate text-[11px] text-slate-400">{place.address}</p>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeletePlace(place.id)}
                          aria-label={`Delete ${place.name}`}
                          className="hud-focusable flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-rose-300"
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {recentSearches.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    {t(uiLanguage, 'recentSearches')}
                  </p>
                  <ul className="flex flex-col gap-1.5">
                    {recentSearches.slice(0, 10).map((item) => (
                      <li
                        key={item.id}
                        className="flex items-center justify-between gap-2 rounded-xl border border-slate-800/80 bg-slate-950/50 px-3 py-1.5"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onSelectPlace(item);
                            onClose();
                          }}
                          className="hud-focusable min-h-11 min-w-0 flex-1 text-left"
                        >
                          <p className="truncate text-xs font-medium text-slate-100">{item.name}</p>
                          {item.address && (
                            <p className="truncate text-[11px] text-slate-500">{item.address}</p>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteRecentSearch(item.id)}
                          aria-label={`Remove ${item.name}`}
                          className="hud-focusable flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:text-rose-300"
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <>
              {hasActiveRoute && (
                <form
                  onSubmit={handleSaveSubmit}
                  className="flex flex-col gap-2 rounded-2xl border border-teal-400/30 bg-teal-950/20 p-3"
                >
                  <label
                    htmlFor="save-route-name-input"
                    className="text-[11px] font-bold uppercase tracking-wider text-teal-200"
                  >
                    {t(uiLanguage, 'saveRoutePrompt')}
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="save-route-name-input"
                      type="text"
                      value={routeNameDraft}
                      onChange={(e) => setRouteNameDraft(e.target.value)}
                      placeholder="Morning Bypass"
                      className="hud-focusable min-h-11 min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs text-white focus:border-teal-400 focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="hud-focusable min-h-11 shrink-0 rounded-xl bg-teal-400 px-3.5 text-xs font-bold text-slate-950"
                    >
                      {t(uiLanguage, 'saveRoute')}
                    </button>
                  </div>
                  {statusFeedback && (
                    <p className="text-[11px] font-medium text-emerald-300">{statusFeedback}</p>
                  )}
                </form>
              )}

              {[
                { title: 'Saved Routes', list: savedOnly },
                { title: 'Recent Route History', list: historyOnly },
              ].map(
                (section) =>
                  section.list.length > 0 && (
                    <div key={section.title}>
                      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        {section.title}
                      </p>
                      <ul className="flex flex-col gap-2">
                        {section.list.map((rt) => (
                          <li
                            key={rt.id}
                            className="flex flex-col gap-2 rounded-2xl border border-slate-800 bg-slate-950/80 p-3"
                          >
                            {editingRouteId === rt.id ? (
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  value={editingNameDraft}
                                  onChange={(e) => setEditingNameDraft(e.target.value)}
                                  className="hud-focusable min-h-11 flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 text-xs text-white"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleRenameSubmit(rt.id)}
                                  className="hud-focusable min-h-11 rounded-xl bg-teal-400 px-3 text-xs font-bold text-slate-950"
                                >
                                  Save
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-bold text-white">{rt.name}</p>
                                  <p className="text-[11px] text-slate-400">
                                    {formatDistance(rt.snappedRoute?.distance, unitSystem)} ·{' '}
                                    {formatDuration(rt.snappedRoute?.duration)} ·{' '}
                                    <span className="capitalize">{rt.profile}</span>
                                  </p>
                                </div>
                                <span className="shrink-0 rounded bg-slate-800 px-2 py-0.5 text-[10px] font-semibold uppercase text-teal-300">
                                  {rt.routeSourceMode === 'directions' ? 'Nav' : 'Bypass'}
                                </span>
                              </div>
                            )}

                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  onLoadRoute({
                                    name: rt.name,
                                    coordinates: rt.rawCoordinates,
                                    pinnedStopIndices: rt.pinnedStopIndices,
                                    routeSourceMode: rt.routeSourceMode,
                                    profile: rt.profile,
                                    snappedRoute: rt.snappedRoute,
                                  });
                                  onClose();
                                }}
                                className="hud-focusable min-h-11 flex-1 rounded-xl bg-teal-400 px-3 text-xs font-bold text-slate-950"
                              >
                                Load Route
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingRouteId(rt.id);
                                  setEditingNameDraft(rt.name);
                                }}
                                className="hud-focusable min-h-11 rounded-xl border border-slate-700 bg-slate-900 px-3 text-xs font-semibold text-slate-200"
                              >
                                Rename
                              </button>
                              <button
                                type="button"
                                onClick={() => onDeleteRoute(rt.id)}
                                aria-label={`Delete ${rt.name}`}
                                className="hud-focusable flex h-11 w-11 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-slate-400 hover:text-rose-300"
                              >
                                ✕
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ),
              )}

              {savedRoutes.length === 0 && (
                <p className="rounded-xl border border-dashed border-slate-800 px-3 py-6 text-center text-xs text-slate-500">
                  No saved routes or history yet.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
