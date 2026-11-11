import { useState } from 'react';
import { AVOID_OPTIONS } from '../services/mapboxDirections.js';
import { t, UI_LANGUAGES } from '../utils/i18n.js';
import { VOICE_LANGUAGES } from '../utils/voice.js';

/**
 * Lazy-loaded consolidated Settings & Privacy modal covering map theme, units,
 * clock format, language (EN/HI), voice & speed alerts, avoid preferences,
 * Mapbox ToS-compliant offline storage status, data clearing, and token setup.
 */
export default function SettingsModal({
  isOpen,
  uiLanguage = 'en',
  mapTheme = 'satellite',
  unitSystem = 'metric',
  timeFormat = '12h',
  voiceMuted = false,
  voiceLanguage = 'en-US',
  speedAlertEnabled = true,
  liteModeEnabled = true,
  navLightStyleEnabled = false,
  avoid = {},
  savedRoutesCount = 0,
  savedPlacesCount = 0,
  onClose,
  onChangeUiLanguage,
  onChangeMapTheme,
  onChangeUnitSystem,
  onChangeTimeFormat,
  onToggleVoiceMute,
  onChangeVoiceLanguage,
  onToggleSpeedAlert,
  onToggleLiteMode,
  onToggleNavLightStyle,
  onToggleAvoid,
  onClearRecentSearches,
  onClearRouteHistory,
  onClearAllData,
  onOpenTokenModal,
}) {
  const [confirmEraseAll, setConfirmEraseAll] = useState(false);
  const [privacyStatus, setPrivacyStatus] = useState('');

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t(uiLanguage, 'preferencesTitle')}
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 p-3 backdrop-blur-md sm:items-center"
    >
      <div className="hud-surface flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-slate-700/80 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <h2 className="text-sm font-bold text-white">{t(uiLanguage, 'preferencesTitle')}</h2>
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
          {/* Language & Units */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                {t(uiLanguage, 'unitsLabel')}
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {['metric', 'imperial'].map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => onChangeUnitSystem(u)}
                    className={`hud-focusable min-h-11 rounded-xl border text-xs font-bold ${
                      unitSystem === u
                        ? 'border-teal-400 bg-teal-400 text-slate-950'
                        : 'border-slate-700 bg-slate-950 text-slate-200'
                    }`}
                  >
                    {u === 'metric' ? 'km' : 'mi'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                {t(uiLanguage, 'clockLabel')}
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {['12h', '24h'].map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => onChangeTimeFormat(fmt)}
                    className={`hud-focusable min-h-11 rounded-xl border text-xs font-bold ${
                      timeFormat === fmt
                        ? 'border-teal-400 bg-teal-400 text-slate-950'
                        : 'border-slate-700 bg-slate-950 text-slate-200'
                    }`}
                  >
                    {fmt}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Map Style & Interface Language */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                {t(uiLanguage, 'themeLabel')}
              </span>
              <div className="grid grid-cols-3 gap-1">
                {['satellite', 'night', 'day'].map((theme) => (
                  <button
                    key={theme}
                    type="button"
                    onClick={() => onChangeMapTheme(theme)}
                    className={`hud-focusable min-h-11 rounded-xl border text-[11px] font-bold capitalize ${
                      mapTheme === theme
                        ? 'border-teal-400 bg-teal-400 text-slate-950'
                        : 'border-slate-700 bg-slate-950 text-slate-200'
                    }`}
                  >
                    {theme === 'satellite' ? 'Sat' : theme}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label
                htmlFor="settings-ui-lang"
                className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-400"
              >
                {t(uiLanguage, 'languageLabel')}
              </label>
              <select
                id="settings-ui-lang"
                value={uiLanguage}
                onChange={(e) => onChangeUiLanguage(e.target.value)}
                className="hud-focusable min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-2.5 text-xs font-semibold text-white"
              >
                {UI_LANGUAGES.map((lang) => (
                  <option key={lang.id} value={lang.id}>
                    {lang.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Voice Guidance & Speed Limit Alert */}
          <div className="flex flex-col gap-2.5 rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white">{t(uiLanguage, 'voiceLabel')}</span>
              <button
                type="button"
                role="switch"
                aria-checked={!voiceMuted}
                onClick={onToggleVoiceMute}
                className={`hud-focusable min-h-11 rounded-xl border px-3 text-xs font-bold ${
                  !voiceMuted
                    ? 'border-teal-400/60 bg-teal-400/20 text-teal-200'
                    : 'border-slate-700 bg-slate-900 text-slate-400'
                }`}
              >
                {voiceMuted ? t(uiLanguage, 'voiceMute') : t(uiLanguage, 'voiceUnmute')}
              </button>
            </div>

            <div className="flex items-center justify-between gap-2">
              <label htmlFor="settings-voice-lang" className="text-xs font-medium text-slate-300">
                {t(uiLanguage, 'voiceLangLabel')}
              </label>
              <select
                id="settings-voice-lang"
                value={voiceLanguage}
                onChange={(e) => onChangeVoiceLanguage(e.target.value)}
                className="hud-focusable min-h-11 rounded-xl border border-slate-700 bg-slate-900 px-2.5 text-xs text-white"
              >
                {VOICE_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-300">
                {t(uiLanguage, 'speedAlertLabel')}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={speedAlertEnabled}
                onClick={onToggleSpeedAlert}
                className={`hud-focusable min-h-11 rounded-xl border px-3 text-xs font-bold ${
                  speedAlertEnabled
                    ? 'border-amber-400/60 bg-amber-400/20 text-amber-200'
                    : 'border-slate-700 bg-slate-900 text-slate-400'
                }`}
              >
                {speedAlertEnabled ? 'On' : 'Off'}
              </button>
            </div>
          </div>

          {/* Tile Budget & Data Saver Controls */}
          <div className="flex flex-col gap-2.5 rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-white">{t(uiLanguage, 'liteModeLabel')}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-slate-400">
                  {t(uiLanguage, 'liteModeDesc')}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={liteModeEnabled}
                onClick={onToggleLiteMode}
                className={`hud-focusable min-h-11 shrink-0 rounded-xl border px-3 text-xs font-bold ${
                  liteModeEnabled
                    ? 'border-teal-400/60 bg-teal-400/20 text-teal-200'
                    : 'border-slate-700 bg-slate-900 text-slate-400'
                }`}
              >
                {liteModeEnabled ? 'On' : 'Off'}
              </button>
            </div>

            <div className="flex items-start justify-between gap-2 border-t border-slate-800/80 pt-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-white">
                  {t(uiLanguage, 'navLightStyleLabel')}
                </p>
                <p className="mt-0.5 text-[11px] leading-snug text-slate-400">
                  {t(uiLanguage, 'navLightStyleDesc')}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={navLightStyleEnabled}
                onClick={onToggleNavLightStyle}
                className={`hud-focusable min-h-11 shrink-0 rounded-xl border px-3 text-xs font-bold ${
                  navLightStyleEnabled
                    ? 'border-teal-400/60 bg-teal-400/20 text-teal-200'
                    : 'border-slate-700 bg-slate-900 text-slate-400'
                }`}
              >
                {navLightStyleEnabled ? 'On' : 'Off'}
              </button>
            </div>
          </div>

          {/* Route Avoids */}
          <div>
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-400">
              {t(uiLanguage, 'avoidLabel')}
            </span>
            <div className="flex flex-wrap gap-2">
              {AVOID_OPTIONS.map((opt) => {
                const active = Boolean(avoid[opt.id]);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onToggleAvoid(opt.id)}
                    className={`hud-focusable min-h-11 rounded-xl border px-3.5 text-xs font-bold ${
                      active
                        ? 'border-amber-400/70 bg-amber-400/20 text-amber-200'
                        : 'border-slate-700 bg-slate-950 text-slate-200'
                    }`}
                  >
                    {active ? `✓ ${opt.label}` : opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Offline Cache & Mapbox ToS Info */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-teal-300">{t(uiLanguage, 'offlineNoticeTitle')}</p>
              <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">
                {savedRoutesCount} routes · {savedPlacesCount} places
              </span>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
              {t(uiLanguage, 'offlineNoticeBody')}
            </p>
          </div>

          {/* Privacy, Stored Data & Token Management */}
          <div className="flex flex-col gap-2 rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
            <p className="text-xs font-bold text-slate-200">{t(uiLanguage, 'dataPrivacyTitle')}</p>
            <p className="text-[11px] text-slate-400">
              GPS location stays 100% on-device. Zero third-party analytics.
            </p>
            {privacyStatus && (
              <p className="text-[11px] font-semibold text-emerald-300">{privacyStatus}</p>
            )}
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={async () => {
                  await onClearRecentSearches();
                  setPrivacyStatus('Recent searches cleared.');
                }}
                className="hud-focusable min-h-11 rounded-xl border border-slate-700 bg-slate-900 px-2.5 text-[11px] font-semibold text-slate-200"
              >
                {t(uiLanguage, 'clearRecentsBtn')}
              </button>
              <button
                type="button"
                onClick={async () => {
                  await onClearRouteHistory();
                  setPrivacyStatus('Route history cleared.');
                }}
                className="hud-focusable min-h-11 rounded-xl border border-slate-700 bg-slate-900 px-2.5 text-[11px] font-semibold text-slate-200"
              >
                {t(uiLanguage, 'clearHistoryBtn')}
              </button>
            </div>

            {!confirmEraseAll ? (
              <button
                type="button"
                onClick={() => setConfirmEraseAll(true)}
                className="hud-focusable min-h-11 rounded-xl border border-rose-500/40 bg-rose-950/40 px-3 text-xs font-semibold text-rose-200"
              >
                {t(uiLanguage, 'clearAllDataBtn')}
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await onClearAllData();
                    setConfirmEraseAll(false);
                    setPrivacyStatus('All local places, searches, and routes erased.');
                  }}
                  className="hud-focusable min-h-11 flex-1 rounded-xl bg-rose-500 px-3 text-xs font-bold text-white"
                >
                  Confirm Erase All
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmEraseAll(false)}
                  className="hud-focusable min-h-11 rounded-xl border border-slate-700 px-3 text-xs text-slate-300"
                >
                  {t(uiLanguage, 'cancel')}
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenTokenModal();
              }}
              className="hud-focusable mt-1 min-h-11 rounded-xl border border-teal-400/40 bg-slate-900 px-3 text-xs font-bold text-teal-300"
            >
              {t(uiLanguage, 'tokenManageBtn')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
