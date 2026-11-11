import { useState } from 'react';
import { formatDistance, formatDuration } from '../utils/geo.js';
import { t } from '../utils/i18n.js';
import { isRoundTripCoordinates } from '../utils/routePlanner.js';

/**
 * Lazy-loaded Multi-Stop Route Planner modal supporting drag-and-drop & accessible
 * button reordering, stop removal, per-leg distance/duration breakdown, and Round Trip toggle.
 */
export default function RoutePlannerSheet({
  isOpen,
  uiLanguage = 'en',
  unitSystem = 'metric',
  rawCoordinates = [],
  snappedRoute = null,
  routeSourceMode = 'matching',
  onClose,
  onReorderWaypoints,
  onRemoveWaypoint,
  onToggleRoundTrip,
}) {
  const [dragIndex, setDragIndex] = useState(null);

  if (!isOpen) return null;

  const isRoundTrip = isRoundTripCoordinates(rawCoordinates);
  const legs = snappedRoute?.legsSummary || [];
  const canReorder = rawCoordinates.length >= 2;
  const canRemove = rawCoordinates.length > 2;

  const getStopLabel = (index) => {
    if (index === 0) return 'Start';
    if (index === rawCoordinates.length - 1) return isRoundTrip ? 'Return to Start' : 'Destination';
    return `Stop ${index}`;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t(uiLanguage, 'legsAndStops')}
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 p-3 backdrop-blur-md sm:items-center"
    >
      <div className="hud-surface flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-slate-700/80 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <div>
            <h2 className="text-sm font-bold text-white">{t(uiLanguage, 'legsAndStops')}</h2>
            <p className="text-[11px] text-slate-400">
              {rawCoordinates.length} points ·{' '}
              {routeSourceMode === 'directions' ? 'Turn-by-turn stops' : 'Custom bypass path'}
            </p>
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

        <div className="hud-scroll-y flex flex-col gap-3 overflow-y-auto p-4">
          {canReorder && (
            <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/80 px-3.5 py-2.5">
              <div>
                <p className="text-xs font-bold text-white">{t(uiLanguage, 'roundTrip')}</p>
                <p className="text-[11px] text-slate-400">Return cleanly to start origin</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={isRoundTrip}
                onClick={onToggleRoundTrip}
                className={`hud-focusable min-h-11 rounded-xl border px-3.5 text-xs font-bold transition ${
                  isRoundTrip
                    ? 'border-teal-400 bg-teal-400 text-slate-950'
                    : 'border-slate-700 bg-slate-900 text-slate-200 hover:border-teal-400/50'
                }`}
              >
                {isRoundTrip ? 'Enabled' : 'Off'}
              </button>
            </div>
          )}

          {rawCoordinates.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-800 px-3 py-6 text-center text-xs text-slate-500">
              Search a location or draw a route to manage stops and legs.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {rawCoordinates.map((coord, index) => {
                const leg = legs[index];
                return (
                  <li key={`${coord[0].toFixed(5)}-${coord[1].toFixed(5)}-${index}`}>
                    <div
                      draggable={canReorder}
                      onDragStart={() => setDragIndex(index)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (dragIndex !== null && dragIndex !== index) {
                          onReorderWaypoints(dragIndex, index);
                        }
                        setDragIndex(null);
                      }}
                      onDragEnd={() => setDragIndex(null)}
                      className={`flex items-center justify-between gap-2 rounded-2xl border px-3 py-2 transition ${
                        dragIndex === index
                          ? 'border-teal-400 bg-teal-950/30'
                          : 'border-slate-800 bg-slate-950/75'
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span
                          aria-hidden="true"
                          className="cursor-grab text-xs text-slate-500 select-none"
                          title="Drag to reorder"
                        >
                          ⋮⋮
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-xs font-bold text-white">
                            {getStopLabel(index)}
                          </p>
                          <p className="font-mono text-[10px] text-slate-400">
                            {coord[1].toFixed(4)}, {coord[0].toFixed(4)}
                          </p>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => onReorderWaypoints(index, index - 1)}
                          aria-label={`Move ${getStopLabel(index)} up`}
                          className="hud-focusable flex h-11 w-10 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 text-xs text-slate-200 disabled:opacity-35"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={index === rawCoordinates.length - 1}
                          onClick={() => onReorderWaypoints(index, index + 1)}
                          aria-label={`Move ${getStopLabel(index)} down`}
                          className="hud-focusable flex h-11 w-10 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 text-xs text-slate-200 disabled:opacity-35"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          disabled={!canRemove}
                          onClick={() => onRemoveWaypoint(index)}
                          aria-label={`Remove ${getStopLabel(index)}`}
                          className="hud-focusable flex h-11 w-10 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 text-xs text-rose-300 disabled:opacity-35"
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    {leg && index < rawCoordinates.length - 1 && (
                      <div className="ml-6 mt-1 flex items-center gap-2 border-l border-teal-400/35 pl-3 text-[11px] text-slate-400">
                        <span className="font-semibold text-teal-300">
                          Leg {index + 1}: {formatDistance(leg.distance, unitSystem)}
                        </span>
                        <span>· {formatDuration(leg.duration)}</span>
                        {leg.summary && <span className="truncate text-slate-500">via {leg.summary}</span>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
