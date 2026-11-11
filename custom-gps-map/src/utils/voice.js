export const VOICE_LANGUAGES = [
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-IN', label: 'English (India)' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'hi-IN', label: 'Hindi (हिन्दी)' },
  { code: 'es-ES', label: 'Spanish (Español)' },
  { code: 'fr-FR', label: 'French (Français)' },
  { code: 'de-DE', label: 'German (Deutsch)' },
];

const DISTANCE_PHRASE_TEMPLATES = {
  hi: {
    inDist: (d) => `${d} के बाद`,
    now: 'अब',
    arrived: 'आप अपने गंतव्य पर पहुँच गए हैं।',
    rerouting: 'नया मार्ग खोजा जा रहा है।',
  },
  es: {
    inDist: (d) => `En ${d},`,
    now: 'Ahora,',
    arrived: 'Has llegado a tu destino.',
    rerouting: 'Recalculando ruta.',
  },
  fr: {
    inDist: (d) => `Dans ${d},`,
    now: 'Maintenant,',
    arrived: 'Vous êtes arrivé à destination.',
    rerouting: 'Recalcul de l’itinéraire.',
  },
  de: {
    inDist: (d) => `In ${d},`,
    now: 'Jetzt,',
    arrived: 'Sie haben Ihr Ziel erreicht.',
    rerouting: 'Route wird neu berechnet.',
  },
  en: {
    inDist: (d) => `In ${d},`,
    now: 'Now,',
    arrived: 'You have arrived at your destination.',
    rerouting: 'Rerouting.',
  },
};

function getTemplateSet(language = 'en-US') {
  const prefix = String(language || 'en-US').toLowerCase().split('-')[0];
  return DISTANCE_PHRASE_TEMPLATES[prefix] || DISTANCE_PHRASE_TEMPLATES.en;
}

export function formatDistanceForSpeech(meters, unitSystem = 'metric', language = 'en-US') {
  const prefix = String(language || 'en-US').toLowerCase().split('-')[0];

  if (unitSystem === 'imperial') {
    const feet = Math.round((meters * 3.28084) / 50) * 50;
    const miles = meters / 1609.344;
    if (miles >= 0.2) {
      const rounded = miles < 1 ? miles.toFixed(1) : Math.round(miles * 10) / 10;
      const unitWord = prefix === 'es' ? 'millas' : prefix === 'fr' ? 'miles' : 'miles';
      return `${rounded} ${unitWord}`;
    }
    const safeFeet = Math.max(100, feet);
    const ftWord = prefix === 'es' ? 'pies' : 'feet';
    return `${safeFeet} ${ftWord}`;
  }

  if (meters >= 1000) {
    const km = meters < 3000 ? (meters / 1000).toFixed(1) : Math.round(meters / 1000);
    return `${km} ${prefix === 'hi' ? 'किलोमीटर' : 'kilometers'}`;
  }

  const roundedMeters = meters >= 350 ? 500 : 200;
  return `${roundedMeters} ${prefix === 'hi' ? 'मीटर' : prefix === 'es' ? 'metros' : prefix === 'fr' ? 'mètres' : prefix === 'de' ? 'Metern' : 'meters'}`;
}

export function getVoiceCueTier(distanceToManeuverMeters) {
  if (!Number.isFinite(distanceToManeuverMeters)) return null;
  if (distanceToManeuverMeters <= 45) return 'now';
  if (distanceToManeuverMeters <= 240) return '200m';
  if (distanceToManeuverMeters <= 550) return '500m';
  return null;
}

/**
 * Determines whether a distance-based turn announcement or arrival announcement should fire.
 * Mutates nothing; callers track emitted cue keys cleanly.
 */
export function evaluateVoiceAnnouncement({
  nextStepInfo,
  hasArrived = false,
  spokenCueKeys,
  unitSystem = 'metric',
  language = 'en-US',
}) {
  const templates = getTemplateSet(language);
  const keySet = spokenCueKeys || new Set();

  if (hasArrived) {
    const arrivalKey = 'arrive';
    if (keySet.has(arrivalKey)) return null;
    return {
      key: arrivalKey,
      text: templates.arrived,
    };
  }

  if (!nextStepInfo?.step) return null;

  const instruction =
    nextStepInfo.step?.maneuver?.instruction || nextStepInfo.step?.name || 'continue straight';
  const tier = getVoiceCueTier(nextStepInfo.distanceToManeuverMeters);
  if (!tier) return null;

  const cueKey = `${nextStepInfo.stepIndex}:${instruction}:${tier}`;
  if (keySet.has(cueKey)) return null;

  if (tier === 'now') {
    return {
      key: cueKey,
      text: `${templates.now} ${instruction}`,
    };
  }

  const distancePhrase = formatDistanceForSpeech(
    tier === '500m' ? 500 : 200,
    unitSystem,
    language,
  );

  return {
    key: cueKey,
    text: `${templates.inDist(distancePhrase)} ${instruction}`,
  };
}

export function getReroutingSpeechText(language = 'en-US') {
  return getTemplateSet(language).rerouting;
}

export function getSpeedLimitSpeechText(speedLimit, language = 'en-US') {
  if (!speedLimit?.value) return null;
  const prefix = String(language || 'en-US').toLowerCase().split('-')[0];
  if (prefix === 'hi') {
    return `गति सीमा ${speedLimit.value} ${speedLimit.unit === 'mph' ? 'मील प्रति घंटा' : 'किलोमीटर प्रति घंटा'} से अधिक।`;
  }
  return `Speed limit ${speedLimit.value} ${speedLimit.unit === 'mph' ? 'miles per hour' : 'kilometers per hour'}.`;
}

export function isSpeechSynthesisSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
}

export function speakUtterance(text, language = 'en-US') {
  if (!text || !isSpeechSynthesisSupported()) return false;
  try {
    window.speechSynthesis.cancel();
    const utterance = new window.SpeechSynthesisUtterance(text);
    utterance.lang = language || 'en-US';
    utterance.rate = 1.02;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
    return true;
  } catch {
    return false;
  }
}
