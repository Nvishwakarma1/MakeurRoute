import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { t } from '../utils/i18n.js';
import {
  encodeRouteToHash,
  exportRouteToGeoJson,
  exportRouteToGpx,
  importRouteFromGeoJson,
  importRouteFromGpx,
} from '../utils/routeIO.js';

function triggerDownload(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * Lazy-loaded modal for GPX & GeoJSON export/import plus local QR code & URL hash sharing.
 */
export default function ShareImportModal({
  isOpen,
  uiLanguage = 'en',
  routeName = 'Custom Bypass Route',
  routeSourceMode = 'matching',
  profile = 'driving',
  snappedRoute,
  rawCoordinates = [],
  pinnedStopIndices = [],
  onClose,
  onImportRoute,
}) {
  const [qrSvgDataUrl, setQrSvgDataUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const shareSourceCoords = useMemo(
    () =>
      snappedRoute?.geometry?.coordinates?.length >= 2
        ? snappedRoute.geometry.coordinates
        : rawCoordinates,
    [snappedRoute, rawCoordinates],
  );
  const hasRoute = shareSourceCoords.length >= 2;

  const { shareMeta, encodeError } = useMemo(() => {
    if (!isOpen || !hasRoute) return { shareMeta: null, encodeError: '' };
    try {
      const encoded = encodeRouteToHash({
        coordinates: shareSourceCoords,
        routeSourceMode,
        profile,
        name: routeName,
      });
      const baseHref = window.location.href.split('#')[0];
      return {
        shareMeta: {
          url: `${baseHref}${encoded.hash}`,
          wasSimplified: encoded.wasSimplified,
          pointCount: encoded.pointCount,
          originalCount: encoded.originalCount,
        },
        encodeError: '',
      };
    } catch (err) {
      return {
        shareMeta: null,
        encodeError: err.message || 'Unable to encode share URL.',
      };
    }
  }, [isOpen, hasRoute, shareSourceCoords, routeSourceMode, profile, routeName]);

  useEffect(() => {
    if (!isOpen || !shareMeta?.url) {
      return undefined;
    }

    let cancelled = false;
    QRCode.toString(shareMeta.url, {
      type: 'svg',
      margin: 1,
      width: 196,
      color: {
        dark: '#2dd4bf',
        light: '#090d16',
      },
    })
      .then((svgMarkup) => {
        if (!cancelled) {
          setQrSvgDataUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setErrorMsg('Could not render local QR code for this route.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, shareMeta]);

  const activeError = errorMsg || encodeError;

  if (!isOpen) return null;

  const handleCopyLink = async () => {
    if (!shareMeta?.url) return;
    try {
      await navigator.clipboard.writeText(shareMeta.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setErrorMsg('Clipboard access blocked. Copy the share URL manually below.');
    }
  };

  const handleExportGpx = () => {
    try {
      const gpx = exportRouteToGpx({
        name: routeName,
        snappedRoute,
        rawCoordinates,
        pinnedStopIndices,
      });
      triggerDownload('takeurroute-path.gpx', gpx, 'application/gpx+xml');
    } catch (err) {
      setErrorMsg(err.message);
    }
  };

  const handleExportGeoJson = () => {
    try {
      const geojson = exportRouteToGeoJson({
        name: routeName,
        snappedRoute,
        rawCoordinates,
        pinnedStopIndices,
      });
      triggerDownload('takeurroute-path.geojson', geojson, 'application/geo+json');
    } catch (err) {
      setErrorMsg(err.message);
    }
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      const lowerName = file.name.toLowerCase();
      const imported = lowerName.endsWith('.gpx') || text.trim().startsWith('<')
        ? importRouteFromGpx(text)
        : importRouteFromGeoJson(text);

      setErrorMsg('');
      onImportRoute(imported);
      onClose();
    } catch (err) {
      setErrorMsg(err.message || 'Could not import selected route file.');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t(uiLanguage, 'shareLinkTitle')}
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 p-3 backdrop-blur-md sm:items-center"
    >
      <div className="hud-surface flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-slate-700/80 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <h2 className="text-sm font-bold text-white">{t(uiLanguage, 'shareLinkTitle')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t(uiLanguage, 'close')}
            className="hud-focusable flex h-11 w-11 items-center justify-center rounded-xl text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="hud-scroll-y flex flex-col gap-4 overflow-y-auto p-4">
          {activeError && (
            <div
              role="alert"
              className="rounded-xl border border-rose-500/40 bg-rose-950/80 px-3 py-2 text-xs text-rose-100"
            >
              {activeError}
            </div>
          )}

          {hasRoute ? (
            <>
              <div className="flex flex-col items-center gap-2 rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
                {qrSvgDataUrl ? (
                  <img
                    src={qrSvgDataUrl}
                    alt="Route share QR code"
                    className="h-44 w-44 rounded-xl border border-slate-800"
                  />
                ) : (
                  <div className="flex h-44 w-44 items-center justify-center text-xs text-slate-400">
                    Generating QR...
                  </div>
                )}

                {shareMeta?.wasSimplified && (
                  <p className="text-center text-[11px] text-amber-300">
                    Link simplified from {shareMeta.originalCount} to {shareMeta.pointCount} points to fit QR/URL limits.
                  </p>
                )}

                {shareMeta?.url && (
                  <div className="mt-1 flex w-full gap-2">
                    <input
                      type="text"
                      readOnly
                      aria-label="Shareable route link"
                      value={shareMeta.url}
                      className="hud-focusable min-h-11 min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 text-[11px] text-slate-300"
                    />
                    <button
                      type="button"
                      onClick={handleCopyLink}
                      className="hud-focusable min-h-11 shrink-0 rounded-xl bg-teal-400 px-3.5 text-xs font-bold text-slate-950"
                    >
                      {copied ? t(uiLanguage, 'copied') : t(uiLanguage, 'copyLink')}
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleExportGpx}
                  className="hud-focusable min-h-11 rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs font-semibold text-white hover:border-teal-400/50"
                >
                  {t(uiLanguage, 'exportGpx')}
                </button>
                <button
                  type="button"
                  onClick={handleExportGeoJson}
                  className="hud-focusable min-h-11 rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs font-semibold text-white hover:border-teal-400/50"
                >
                  {t(uiLanguage, 'exportGeoJson')}
                </button>
              </div>
            </>
          ) : (
            <p className="rounded-xl border border-dashed border-slate-800 px-3 py-4 text-center text-xs text-slate-400">
              Draw or search a route first to export GPX/GeoJSON or generate a share QR code.
            </p>
          )}

          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
            <label
              htmlFor="route-file-import"
              className="mb-2 block text-xs font-bold text-slate-200"
            >
              {t(uiLanguage, 'importFile')}
            </label>
            <input
              id="route-file-import"
              type="file"
              accept=".gpx,.geojson,.json,application/gpx+xml,application/geo+json,application/json"
              onChange={handleFileChange}
              className="hud-focusable block min-h-11 w-full cursor-pointer rounded-xl border border-slate-700 bg-slate-900 p-2 text-xs text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-teal-400 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-slate-950"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
