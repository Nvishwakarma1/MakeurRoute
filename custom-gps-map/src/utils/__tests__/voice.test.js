import { describe, expect, it } from 'vitest';
import { evaluateVoiceAnnouncement } from '../voice.js';

describe('voice guidance cues', () => {
  const sampleStep = {
    stepIndex: 2,
    distanceToManeuverMeters: 490,
    step: {
      name: 'Market St',
      maneuver: { type: 'turn', modifier: 'right', instruction: 'Turn right onto Market St' },
    },
  };

  it('fires 500m, 200m, and now cues at most once per tier', () => {
    const spoken = new Set();

    const cue500 = evaluateVoiceAnnouncement({
      nextStepInfo: sampleStep,
      spokenCueKeys: spoken,
      unitSystem: 'metric',
      language: 'en-US',
    });
    expect(cue500?.text).toBe('In 500 meters, Turn right onto Market St');
    spoken.add(cue500.key);

    // Duplicate call in same tier returns null
    expect(
      evaluateVoiceAnnouncement({
        nextStepInfo: { ...sampleStep, distanceToManeuverMeters: 450 },
        spokenCueKeys: spoken,
        unitSystem: 'metric',
        language: 'en-US',
      }),
    ).toBeNull();

    // Entering 200m window emits 200m cue
    const cue200 = evaluateVoiceAnnouncement({
      nextStepInfo: { ...sampleStep, distanceToManeuverMeters: 180 },
      spokenCueKeys: spoken,
      unitSystem: 'metric',
      language: 'en-US',
    });
    expect(cue200?.text).toBe('In 200 meters, Turn right onto Market St');
    spoken.add(cue200.key);

    // Entering now window (<= 45m) emits final action cue
    const cueNow = evaluateVoiceAnnouncement({
      nextStepInfo: { ...sampleStep, distanceToManeuverMeters: 25 },
      spokenCueKeys: spoken,
      unitSystem: 'metric',
      language: 'en-US',
    });
    expect(cueNow?.text).toBe('Now, Turn right onto Market St');
  });

  it('adapts to imperial units, selected language, and arrival announcement', () => {
    const spoken = new Set();

    const imperialCue = evaluateVoiceAnnouncement({
      nextStepInfo: sampleStep,
      spokenCueKeys: spoken,
      unitSystem: 'imperial',
      language: 'en-US',
    });
    expect(imperialCue?.text).toContain('miles');

    const hindiArrive = evaluateVoiceAnnouncement({
      nextStepInfo: sampleStep,
      hasArrived: true,
      spokenCueKeys: spoken,
      unitSystem: 'metric',
      language: 'hi-IN',
    });
    expect(hindiArrive?.key).toBe('arrive');
    expect(hindiArrive?.text).toContain('गंतव्य');
  });
});
