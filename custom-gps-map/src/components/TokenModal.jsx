import { useEffect } from 'react';

const SCOPE_HINT = 'styles:tiles, styles:read, fonts:read, datasets:read';

/**
 * Token setup screen (when no valid token is configured) and accessible modal dialog
 * for updating or clearing the locally saved Mapbox access token.
 */
export function TokenSetupScreen({ tokenDraft, onTokenDraftChange, onSaveToken }) {
  return (
    <div className="flex h-full w-full items-center justify-center p-5">
      <form
        onSubmit={onSaveToken}
        className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900/95 p-6 shadow-2xl"
      >
        <h1 className="text-lg font-bold text-white">Mapbox Access Token Required</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          Set <code className="rounded bg-slate-800 px-1.5 py-0.5 text-teal-300">VITE_MAPBOX_TOKEN</code>{' '}
          in your <code className="rounded bg-slate-800 px-1.5 py-0.5">.env.local</code> file or
          paste a scoped public <code className="rounded bg-slate-800 px-1.5 py-0.5">pk.*</code> token
          below.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          Recommended public scopes: <span className="text-slate-200">{SCOPE_HINT}</span>. Configure
          URL restrictions in your Mapbox dashboard for production deployments.
        </p>

        <label htmlFor="initial-mapbox-token" className="mt-4 block text-xs font-semibold text-slate-300">
          Public Access Token (pk.*)
        </label>
        <input
          id="initial-mapbox-token"
          type="text"
          value={tokenDraft}
          onChange={(e) => onTokenDraftChange(e.target.value)}
          placeholder="pk.eyJ1Ijo..."
          autoComplete="off"
          spellCheck={false}
          className="hud-focusable mt-1.5 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-teal-400 focus:outline-none"
        />

        <button
          type="submit"
          className="hud-focusable mt-4 min-h-11 w-full rounded-xl bg-teal-400 py-2.5 text-sm font-bold text-slate-950 active:scale-[0.98]"
        >
          Load Map &amp; GPS Navigator
        </button>
      </form>
    </div>
  );
}

export default function TokenModal({
  isOpen,
  tokenDraft,
  hasStoredTokenOverride = false,
  onTokenDraftChange,
  onSaveToken,
  onClearStoredToken,
  onClose,
}) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="mapbox-token-modal-title"
        onSubmit={onSaveToken}
        className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id="mapbox-token-modal-title" className="text-base font-bold text-white">
            Update Mapbox Token
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close token settings"
            className="hud-focusable flex h-11 w-11 items-center justify-center rounded-lg text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            ✕
          </button>
        </div>

        <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
          Use a public <code className="text-teal-300">pk.*</code> token with scopes:{' '}
          <span className="text-slate-300">{SCOPE_HINT}</span>. Configure URL restrictions in your
          Mapbox dashboard if restricting origins.
        </p>

        {hasStoredTokenOverride && (
          <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-950/40 px-2.5 py-1.5 text-[11px] text-amber-200">
            Using saved browser token (<code className="text-amber-100">localStorage</code>), which
            overrides <code className="text-amber-100">VITE_MAPBOX_TOKEN</code> until reset.
          </p>
        )}

        <label htmlFor="modal-mapbox-token" className="sr-only">
          Mapbox public access token
        </label>
        <input
          id="modal-mapbox-token"
          type="text"
          value={tokenDraft}
          onChange={(e) => onTokenDraftChange(e.target.value)}
          placeholder="pk.eyJ1Ijo..."
          autoComplete="off"
          spellCheck={false}
          className="hud-focusable mt-3 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-teal-400 focus:outline-none"
        />

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          {onClearStoredToken && (
            <button
              type="button"
              onClick={onClearStoredToken}
              className="hud-focusable min-h-11 rounded-xl border border-rose-500/40 px-3 text-xs font-semibold text-rose-300 hover:bg-rose-950/50"
            >
              Reset Saved
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="hud-focusable min-h-11 rounded-xl border border-slate-700 px-4 text-xs font-semibold text-slate-200 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="hud-focusable min-h-11 rounded-xl bg-teal-400 px-4 text-xs font-bold text-slate-950"
            >
              Save Token
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
