import { useEffect } from 'react';
import {
  formatDistance,
  formatDuration,
  formatEtaClock,
  formatSpeed,
} from '../utils/geo.js';

/**
 * Displays completed navigation metrics (distance, trip time, average speed,
 * and arrival time) upon reaching the destination.
 */
export default function TripSummaryModal({
  summary,
  unitSystem,
  timeFormat,
  onDismiss,
  onClearAndClose,
}) {
  useEffect(() => {
    if (!summary) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onDismiss();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [summary, onDismiss]);

  if (!summary) return null;

  const avgSpeed = formatSpeed(summary.averageSpeedMps, unitSystem);
  const arrivalTime = formatEtaClock(0, timeFormat, summary.arrivedAtMs);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 p-4 backdrop-blur-sm sm:items-center"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="trip-summary-title"
        className="hud-surface w-full max-w-md rounded-2xl border border-emerald-400/40 bg-slate-900/95 p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
              </svg>
            </div>
            <div>
              <h2 id="trip-summary-title" className="text-base font-bold text-white">
                Destination Reached
              </h2>
              <p className="text-xs text-slate-400">Arrived at {arrivalTime}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onDismiss}
            aria-label="Close trip summary"
            className="hud-focusable flex h-11 w-11 items-center justify-center rounded-lg text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-slate-800 bg-slate-950/90 p-3 text-center">
            <p className="text-[11px] font-medium text-slate-400">Distance</p>
            <p className="mt-1 text-base font-bold text-white">
              {formatDistance(summary.distanceMeters, unitSystem)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/90 p-3 text-center">
            <p className="text-[11px] font-medium text-slate-400">Time</p>
            <p className="mt-1 text-base font-bold text-teal-300">
              {formatDuration(summary.durationSeconds)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/90 p-3 text-center">
            <p className="text-[11px] font-medium text-slate-400">Avg Speed</p>
            <p className="mt-1 text-base font-bold text-slate-100">
              {avgSpeed.value} <span className="text-xs font-normal text-slate-400">{avgSpeed.unit}</span>
            </p>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className="hud-focusable min-h-11 flex-1 rounded-xl border border-slate-700 bg-slate-800/80 px-3 text-xs font-semibold text-slate-200 hover:bg-slate-800"
          >
            Keep Route
          </button>
          <button
            type="button"
            onClick={onClearAndClose}
            className="hud-focusable min-h-11 flex-1 rounded-xl bg-teal-400 px-3 text-xs font-bold text-slate-950 active:scale-[0.98]"
          >
            Finish &amp; Clear
          </button>
        </div>
      </div>
    </div>
  );
}
