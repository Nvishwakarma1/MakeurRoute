import { useEffect, useRef } from 'react';
import {
  evaluateVoiceAnnouncement,
  getReroutingSpeechText,
  getSpeedLimitSpeechText,
  isSpeechSynthesisSupported,
  speakUtterance,
} from '../utils/voice.js';

const SPEED_ALERT_COOLDOWN_MS = 30000;

/**
 * Announces distance-gated turn cues (500 m, 200 m, now), reroutes, arrival,
 * and speed limit alerts via the Web Speech API (SpeechSynthesis).
 */
export function useVoiceGuidance({
  isNavigating,
  voiceMuted,
  voiceLanguage,
  unitSystem,
  snappedRoute,
  nextStepInfo,
  hasArrived,
  tripSummary,
  isRerouting,
  isOverSpeedLimit = false,
  speedLimit = null,
}) {
  const spokenCueKeysRef = useRef(new Set());
  const lastRouteRef = useRef(snappedRoute);
  const wasReroutingRef = useRef(false);
  const wasActiveSessionRef = useRef(false);
  const lastSpeedAlertAtRef = useRef(0);

  useEffect(() => {
    if (lastRouteRef.current !== snappedRoute) {
      spokenCueKeysRef.current.clear();
      lastRouteRef.current = snappedRoute;
    }
  }, [snappedRoute]);

  useEffect(() => {
    const activeSession = isNavigating || Boolean(tripSummary);

    if (!activeSession) {
      if (wasActiveSessionRef.current) {
        spokenCueKeysRef.current.clear();
        if (isSpeechSynthesisSupported()) {
          window.speechSynthesis.cancel();
        }
      }
      wasActiveSessionRef.current = false;
      wasReroutingRef.current = false;
      return;
    }

    wasActiveSessionRef.current = true;

    if (voiceMuted || !isSpeechSynthesisSupported()) {
      if (voiceMuted && isSpeechSynthesisSupported()) {
        window.speechSynthesis.cancel();
      }
      wasReroutingRef.current = isRerouting;
      return;
    }

    if (isRerouting && !wasReroutingRef.current) {
      wasReroutingRef.current = true;
      speakUtterance(getReroutingSpeechText(voiceLanguage), voiceLanguage);
      return;
    }
    wasReroutingRef.current = isRerouting;

    if (isRerouting) return;

    const cue = evaluateVoiceAnnouncement({
      nextStepInfo,
      hasArrived: hasArrived || Boolean(tripSummary),
      spokenCueKeys: spokenCueKeysRef.current,
      unitSystem,
      language: voiceLanguage,
    });

    if (cue) {
      spokenCueKeysRef.current.add(cue.key);
      speakUtterance(cue.text, voiceLanguage);
      return;
    }

    if (isOverSpeedLimit && speedLimit) {
      const nowMs = Date.now();
      if (nowMs - lastSpeedAlertAtRef.current >= SPEED_ALERT_COOLDOWN_MS) {
        const speedText = getSpeedLimitSpeechText(speedLimit, voiceLanguage);
        if (speedText) {
          lastSpeedAlertAtRef.current = nowMs;
          speakUtterance(speedText, voiceLanguage);
        }
      }
    }
  }, [
    isNavigating,
    voiceMuted,
    voiceLanguage,
    unitSystem,
    nextStepInfo,
    hasArrived,
    tripSummary,
    isRerouting,
    isOverSpeedLimit,
    speedLimit,
  ]);

  useEffect(() => {
    return () => {
      if (isSpeechSynthesisSupported()) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);
}
