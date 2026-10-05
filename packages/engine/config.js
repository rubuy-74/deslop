/**
 * ALL tunables for the anti-slop engine live here. Version this file:
 * every prompt/threshold change should be a separate commit so eval
 * results can be correlated with the config that produced them.
 */

export const WORKER_URL = 'http://localhost:8787/analyze';

export const EXTRACTION = {
  // Fractions of min(duration, WINDOW_CAP_S) at which frames are sampled.
  // 3 frames: probe matrix (eval 2026-10-02) showed identical accuracy to 4
  // frames at ~25% less extraction time and vision tokens.
  fractions: [0.15, 0.50, 0.90],
  windowCapS: 2.0,
  // 270x480: probe showed identical accuracy to 360x640 at ~32% smaller payload.
  canvasWidth: 270,
  canvasHeight: 480, // 9:16 letterbox target
  mimeType: 'image/webp',
  fallbackMimeType: 'image/jpeg',
  quality: 0.65,
  // Per-frame byte budget: noisy/high-detail frames balloon Clef's pre-flight
  // token estimate past its 65k context limit (observed: AiError 5021).
  // Step quality down this ladder until the frame fits.
  maxFrameBytes: 45000,
  qualityLadder: [0.65, 0.55, 0.45, 0.35],
  seekTimeoutMs: 1000,
};

export const ANALYZE = {
  // Interactive hold-then-warn flow: past this, holding the video costs more
  // UX than letting it play unjudged (fail-open).
  fetchTimeoutMs: 4000,
  // Eval runs: let slow Clef calls complete so timeouts don't hide real verdicts.
  evalFetchTimeoutMs: 8000,
};

export const CLEF_CONFIG = {
  model: 'clef-flash', // overridable via ?model=clef (eval comparisons)
  threshold: 0.80, // flag when 1 - P(organic) >= threshold
  state:
    'Four chronological frames sampled across the first 2 seconds ' +
    'of a short-form mobile video. Judge the visual content.',
  questions: {
    slop_category: {
      // PRIMARY signal: flag = 1 - P(organic) >= threshold
      type: 'choice',
      instructions:
        'Which category best describes this video? Judge by visual signatures, not topic.',
      criteria: {
        organic:
          'Real camera footage, human-made animation, gameplay, or standard creator content with natural optics and motion',
        absurdist_ai:
          'Synthetic rendering artifacts (plastic textures, impossible physics or speculars, distorted micro-details); e.g. anthropomorphic objects or foods acting out dramas',
        synthetic_parody:
          'Real public-figure faces mapped onto incongruous bodies; facial boundary artifacts, frozen gaze, ear/jaw blending between frames',
        static_ai_slideshow:
          'Sequence of static generative illustrations with no organic camera motion and oversized automated captions',
        other_ai:
          'AI-generated or synthetic content not matching the other categories: smeared or hallucinated detail, generative artifacts of any kind',
      },
    },
    is_slop: {
      // SECOND OPINION: logged as cross-check, never gates the flag.
      type: 'noul',
      instructions: 'Is this video AI-generated slop or low-effort synthetic content?',
      criteria: {
        true: 'Any synthetic generation, face-swap, or automated slideshow content',
        false: 'Genuinely filmed or human-crafted content, even if filtered or edited',
      },
    },
    visual_authenticity: {
      // DISPLAY ONLY: shown on the warning overlay as "why" context.
      type: 'score',
      instructions: 'Rate the organic visual authenticity of this media.',
      criteria: [
        'Pure synthetic generation: plastic skin, uncanny blending, hallucinated limbs',
        'Heavy AI augmentation with obvious visual artifacts',
        'Ambiguous or heavily filtered authentic footage',
        'Verifiable organic photography with consistent real-world optics',
      ],
    },
  },
};

export const CATEGORY_LABELS = {
  organic: 'Organic content',
  absurdist_ai: 'AI absurdity bait',
  synthetic_parody: 'AI face-swap parody',
  static_ai_slideshow: 'Static AI slideshow',
  other_ai: 'AI-generated content',
};
