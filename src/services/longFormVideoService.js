/**
 * longFormVideoService.js
 *
 * Handles AI video generation for durations longer than a single clip (> 8s).
 *
 * Pipeline:
 *  1. Generate storyboard via Claude (breaks user prompt into N scenes with lip sync manifests)
 *  2. Generate each scene clip sequentially using the existing generateVideo()
 *  3. Apply last-frame continuity (scene N's last frame → scene N+1's init image)
 *  4. [Optional] Apply lip sync to speaking scenes via the lip sync engine
 *  5. Stitch all clips into one final MP4 using FFmpeg
 *  6. Upload the final video to S3 and return its URL
 *
 * ⚠️  ZERO changes to the existing 8-second flow.
 *     This file is only invoked from the worker when duration > 8.
 */

import Anthropic from "@anthropic-ai/sdk";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import fs from "fs";
import { PassThrough, Readable } from "stream";
import path from "path";
import axios from "axios";
import { removeBackgroundFromBase64 } from "../utils/removeBackground.js";
import { v4 as uuidv4 } from "uuid";
import os from "os";
import sharp from "sharp";

// Force fluent-ffmpeg to use the modern ffmpeg-static (v6+) instead of 
// any globally cached outdated version (like the 2018 @ffmpeg-installer/ffmpeg)
import ffprobeStatic from "ffprobe-static";
ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(ffprobeStatic.path);

import { uploadBase64VideoToS3 } from "../utils/uploadBase64ToS3.js";
import { generateVideo } from "./aiService.js";
import BusinessSummaryProfile from "../models/BusinessSummaryProfile.js";
import socketService from "../socket.js";
import logger from "../config/logger.js";
import { addLogoOutroToVideo } from "../utils/addLogoOutroToVideo.js";
import { enhancePromptCinematically } from "../utils/cinematicPromptEnhancer.js";

/* ─────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────── */

/** Maximum duration (seconds) a single AI clip can generate */
const SINGLE_CLIP_MAX_DURATION = 8;

/** Temp directory for downloaded clips and frames */
const TEMP_DIR = os.tmpdir();

/**
 * Minimum face-frame percentage required for the lip sync engine to
 * successfully track and deform the mouth region.
 * Scenes with estimatedFaceSize "wide" or "extreme-wide" fall below this
 * threshold and are automatically skipped by the lip sync router.
 */
const LIP_SYNC_MIN_FACE_SIZE_CLASSES = new Set(["close", "medium"]);

/* ─────────────────────────────────────────
   SOCKET HELPER
───────────────────────────────────────── */

function emit(chatId, event, payload) {
  socketService.emitToChat(chatId, event, { chatId, ...payload });
}

/* ═══════════════════════════════════════════════════════════════
   PUBLIC ENTRY POINT
═══════════════════════════════════════════════════════════════ */

/**
 * generateLongFormVideo
 *
 * Orchestrates the full long-form video pipeline.
 *
 * @param {object}      opts
 * @param {string}      opts.prompt               - Claude-refined visual prompt
 * @param {string}      opts.userId
 * @param {string|null} opts.firstFrameBase64      - Brand-composited first frame (may be null)
 * @param {object}      opts.params               - generationParams from the job (aspect, model, etc.)
 * @param {string}      opts.chatId
 * @param {string}      opts.messageId
 * @param {number}      opts.totalDuration        - Requested duration in seconds (e.g. 16, 24, 32)
 * @param {Array}       opts.contactLines         - Business contact info lines for outro
 * @param {string|null} opts.logoUrl              - Logo URL for params passthrough
 * @param {number}      opts.clipDuration         - Dynamic chunk size for each generated scene
 * @param {number}      opts.sceneCount           - Pre-calculated number of scenes
 * @param {number}      opts.finalCostPerChunk    - Dynamic credit cost for each scene generated
 * @param {string}      opts.activeVideoModel     - The active model being used (e.g. 'pixverse', 'veo')
 * @param {boolean}     opts.enableLipSync        - Whether to run lip sync post-processing
 *
 * @returns {Promise<{ videoUrl: string, metadata: object }>}
 */
export async function generateLongFormVideo({
  prompt,
  userId,
  firstFrameBase64,
  params,
  chatId,
  messageId,
  totalDuration,
  contactLines = [],
  logoUrl = null,
  clipDuration = 8,
  sceneCount,
  finalCostPerChunk = 0,
  activeVideoModel = "veo",
  isApprovalSkipped,
  isBusiness,
  enableLipSync = false,
  hasUploadedImage = false,
}) {
  logger.info(
    `[LongForm] Starting: userId=${userId} duration=${totalDuration}s sceneCount=${sceneCount} clipDuration=${clipDuration}s lipSync=${enableLipSync}`,
  );

  /* ── Step 1: Storyboard ───────────────────────────────────── */
  emit(chatId, "generation:progress", {
    messageId,
    percentage: 12,
    message: `Planning ${sceneCount}-scene video…`,
  });

  const brandContext = await fetchBrandContext(userId);
  const storyboard = await generateStoryboard({
    prompt,
    brandContext,
    sceneCount,
    totalDuration,
    clipDuration,
    hasUploadedImage,
    isApprovalSkipped,
  });

  logger.info(
    `[LongForm] Storyboard generated: ${storyboard.scenes.length} scenes`,
  );

  const lipSyncSceneCount = storyboard.scenes.filter(
    (s) => s.lipSyncManifest?.required === true,
  ).length;

  if (enableLipSync && lipSyncSceneCount > 0) {
    logger.info(
      `[LongForm] Lip sync enabled: ${lipSyncSceneCount}/${sceneCount} scenes require sync`,
    );
  }

  /* ── Step 2: Sequential clip generation + last-frame ─────── */
  emit(chatId, "generation:progress", {
    messageId,
    percentage: 18,
    message: `Generating ${sceneCount} scenes…`,
  });

  const clipUrls = await generateClipsSequentially({
    storyboard,
    userId,
    firstFrameBase64,
    params,
    chatId,
    messageId,
    sceneCount,
    contactLines,
    logoUrl,
    clipDuration,
    finalCostPerChunk,
    activeVideoModel,
    isBusiness,
    enableLipSync,
    prompt,
    hasUploadedImage,
    isApprovalSkipped,
  });

  logger.info(`[LongForm] Generated clips:`, clipUrls.map((c) => c.url));

  /* ── Step 3: Stitch all clips into one final video ────────── */
  emit(chatId, "generation:progress", {
    messageId,
    percentage: 80,
    message: "Stitching scenes together…",
  });

  const finalVideoUrl = await stitchVideoClips(
    clipUrls,
    userId,
    contactLines,
    logoUrl,
    isApprovalSkipped,
  );

  emit(chatId, "generation:progress", {
    messageId,
    percentage: 95,
    message: "Finalizing…",
  });

  logger.info(`[LongForm] Complete: ${finalVideoUrl}`);

  return {
    videoUrl: finalVideoUrl,
    metadata: {
      duration: totalDuration,
      sceneCount,
      lipSyncSceneCount: enableLipSync ? lipSyncSceneCount : 0,
      clipUrls: clipUrls.map((c) => c.url),
    },
  };
}

/* ═══════════════════════════════════════════════════════════════
   STEP 1 — STORYBOARD GENERATION (CLAUDE)
═══════════════════════════════════════════════════════════════ */

/**
 * LipSyncManifest shape (for reference — Claude generates this, we validate it):
 *
 * {
 *   required: boolean,
 *   speakingCharacter: string | null,
 *   dialogueText: string | null,
 *   phonemeHints: Array<{
 *     word: string,
 *     phoneme: string,        // ARPABET notation
 *     viseme: string,         // closed set — see VALID_VISEMES below
 *     relativePosition: number  // 0.0 → 1.0 within clip timeline
 *   }>,
 *   mouthOpenDuration: number,  // 0-100, percentage of clip with open mouth
 *   facialVisibility: {
 *     faceVisible: boolean,
 *     estimatedFaceSize: "close"|"medium"|"wide"|"extreme-wide",
 *     occlusionRisk: "none"|"low"|"medium"|"high",
 *     occlusionSource: string | null
 *   },
 *   syncAnchorFrame: "opening"|"mid"|"closing",
 *   emotionalExpression: string,
 *   _phonemeFallback?: boolean  // Set by validator, not Claude
 * }
 */

const VALID_VISEMES = new Set([
  "rest",
  "bilabial",
  "labiodental",
  "dental",
  "alveolar",
  "palatal",
  "velar",
  "rounded",
  "open",
  "wide-open",
  "lateral",
]);

async function generateStoryboard({
  prompt,
  brandContext,
  sceneCount,
  totalDuration,
  clipDuration,
  hasUploadedImage,
  isApprovalSkipped,
}) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  /* ── System Prompt ──────────────────────────────────────────── */
  let systemPrompt = `You are AXIS — an elite AI Auteur and cinematic director with mastery over viral short-form advertising. You operate with the precision of a post-production studio and the creative vision of an award-winning auteur. You do not produce generic content. Every frame is intentional. Every scene earns its place.

You also function as a LIP SYNC CHOREOGRAPHER. For every scene where a character speaks, you produce a machine-readable LipSyncManifest that a downstream TTS and video synthesis engine will consume directly. Precision here is non-negotiable — a single misaligned phoneme ruins the illusion.

════════════════════════════════════════
SECTION 1 — ABSOLUTE CONTINUITY LAW
════════════════════════════════════════

This is your highest-priority directive. Continuity overrides creativity.

CONTINUITY PRIORITY ORDER:
1. Character identity (including mouth anatomy)
2. Product and object identity
3. Camera motion and direction
4. Environment and world-state
5. Lighting and color temperature
6. Story progression

SCENE LINKAGE PROTOCOL:
Before writing Scene N (for N > 1), you MUST:
  → Read the closingFrame of Scene N-1
  → Begin the openingFrame of Scene N as a direct continuation of that exact frame state
  → No jumps in: character position, camera position, camera direction, lighting, environment, or object placement — unless explicitly required by story logic

CHARACTER CONTINUITY:
- Define a recurring character's COMPLETE physical description ONCE in Scene 1
- In every subsequent scene, copy that exact description verbatim — no paraphrasing, no shortening, no additions
- LIP SYNC ADDENDUM: Character descriptions for speaking characters MUST include:
    • Lip anatomy: lip thickness (thin/medium/full), lip pigmentation, any distinctive mouth features
    • Dental visibility: teeth visibility at rest (none/slight/moderate)
    • Jaw structure: defined/soft/angular
    • These mouth anatomy attributes are LOCKED for the entire video — never alter them
- Maintain identical: age, gender, ethnicity, facial structure, hairstyle, clothing, accessories, physical build

ENVIRONMENT CONTINUITY:
- Same location = identical: weather, time of day, architecture, background elements, crowd density, store layout, vehicle placement
- Treat the environment as a persistent, living world — not a new set per scene

LIGHTING CONTINUITY:
- Preserve: color temperature, intensity, shadow softness, sun position, practical lights, exposure style
- LIP SYNC ADDENDUM: Facial lighting must remain consistent enough for a lip sync engine to track the mouth region. Flag any scene where dramatic shadows cross the mouth area in occlusionRisk.

PRODUCT & OBJECT CONTINUITY:
- All persistent props, packaging, uniforms, vehicles, and equipment must appear visually identical across all scenes

CAMERA CONTINUITY:
- Preserve camera momentum across scene boundaries
- Scene N ends moving left → Scene N+1 begins moving left
- Scene N ends with forward push → Scene N+1 begins mid-forward push
- Scene N ends on whip pan → Scene N+1 begins during that whip pan's resolution
- LIP SYNC ADDENDUM: In any scene where lip sync is required, the camera MUST hold a medium or closer framing on the speaking character's face for at least 60% of the clip duration. This is a hard technical requirement for the lip sync engine.

════════════════════════════════════════
SECTION 2 — LIP SYNC CHOREOGRAPHY LAW
════════════════════════════════════════

For every scene, evaluate whether lip sync is required and populate the manifest accordingly.

LIP SYNC TRIGGER CONDITIONS:
required = true when ANY of these are true:
  → voiceOver text is non-empty AND a character is visibly present in frame
  → A character performs a monologue, pitch, or direct address to camera
  → The narrative depends on a human voice being perceived as coming from a visible character

required = false when:
  → voiceOver is a third-person narrator with no on-screen speaker
  → The scene is purely environmental (no speaking character in frame)
  → The character's face is not visible or is extreme-wide framed

PHONEME MAPPING PROTOCOL:
Decompose every voiceOver word into:
  1. word — exact word as written
  2. phoneme — ARPABET notation (e.g., "hello" → "HH AH L OW", "brand" → "B R AE N D")
  3. viseme — mouth shape class from this CLOSED SET ONLY:
       rest | bilabial | labiodental | dental | alveolar |
       palatal | velar | rounded | open | wide-open | lateral
  4. relativePosition — 0.0 to 1.0 decimal (when this word occurs in the clip timeline)
     Distribute evenly unless pacing dictates otherwise. Last word ≤ 0.92 to allow mouth-close.

VISEME REFERENCE:
  rest         → neutral closed mouth (silence, pauses)
  bilabial     → lips pressed: B, P, M
  labiodental  → lower lip to upper teeth: F, V
  dental       → tongue near teeth: TH
  alveolar     → tongue near ridge: T, D, N, S, Z
  palatal      → tongue to palate: SH, ZH, Y
  velar        → back of throat: K, G, NG
  rounded      → lips rounded: W, OO
  open         → jaw drops: AH, AA
  wide-open    → maximum jaw drop: AW, OW sustained
  lateral      → tongue to side: L

MOUTH OPEN DURATION:
Count phonemes requiring mouth opening (all except rest and bilabial).
Divide by total phonemes × 100. Round to nearest integer.

FACIAL VISIBILITY:
  estimatedFaceSize:
    "close"        = face fills >50% of frame height
    "medium"       = face fills 20–50% of frame height
    "wide"         = face fills 5–20% of frame height
    "extreme-wide" = face fills <5% of frame height
  occlusionRisk: "none" | "low" | "medium" | "high"

SYNC ANCHOR FRAME: "opening" | "mid" | "closing"
  → Where in the clip the speaking character's mouth activity peaks

EMOTIONAL EXPRESSION — one word from:
  joy | determination | urgency | warmth | confidence |
  vulnerability | excitement | calm | intensity | sincerity | pride | surprise

CAMERA RULE FOR LIP SYNC SCENES:
When required = true:
  → visualPrompt MUST include a camera hold or slow push on the character's face
  → closingFrame MUST describe the character's facial state at speech end
  → If estimatedFaceSize is "wide" or "extreme-wide": either reframe to medium/close, or set required = false

1. VOICE BLUEPRINT (LOCKED — MUST NOT CHANGE)
Recreate the same voice in Scene 2 using these EXACT specifications:
 
- Gender: Male
- Pitch: Medium-low
- Tone: Calm, neutral, slightly serious
- Tempo: ~135–145 words per minute
- Accent: Neutral Indian English (urban tone)
- Energy: Stable, low-to-medium
- Delivery: Smooth, even pacing with consistent pauses every 4–6 words
- Emotional variation: Minimal (flat consistency preferred)
 
This voice must remain IDENTICAL across scenes. No reinterpretation allowed.
 
---
 
2. AUDIO CONTINUITY SIMULATION (CRITICAL)
Since audio reference is NOT available:
 
- Simulate that both scenes were recorded in ONE continuous take
- Match:
  • speech rhythm
  • pause timing
  • sentence flow
  • loudness consistency
- Do NOT reset tone at the start of Scene 2
 
Scene 2 must sound like a direct continuation of Scene 1.
 

════════════════════════════════════════
SECTION 3 — CINEMATIC INTELLIGENCE
════════════════════════════════════════

AUTEUR CAMERA DOCTRINE:
Apply masterful, varied cinematography: whip pans, drone sweeps, rack focus, kinetic tracking shots, crash zooms, oner sequences, over-shoulder POV, Dutch angles. Never repeat the same camera movement twice consecutively without narrative justification.

TRANSITION STRATEGIES — choose exactly one per scene:
Match Cut | Motion Match | Whip Pan | Camera Pass Through Object | Foreground Wipe | Speed Ramp Transition | Lens Occlusion | Character Crossing Frame | Environmental Continuation

HUMAN REALISM MANDATE:
✓ Realistic skin texture and pore detail
✓ Natural eye movement and gaze behavior
✓ Authentic body language and movement physics
✓ Emotionally truthful expressions
✓ Anatomically accurate mouth movement during speech
✗ No uncanny valley rendering
✗ No frozen or robotic mouth during speech
✗ No cartoon-like or exaggerated features

════════════════════════════════════════
SECTION 4 — BRAND & CULTURAL FIDELITY
════════════════════════════════════════

BRAND DNA COMPLIANCE:
Strictly reflect the brand's identity, visual language, tonal register, and market positioning from Brand Context.

If Brand Context is sparse:
  → Extract every available signal (name, category, location, audience)
  → Infer coherent visual identity from those signals
  → Never hallucinate brand attributes not inferable from context

GEOGRAPHIC & CULTURAL NATIVITY:
  → Visuals, wardrobe, architecture, street life must reflect authentic local culture
  → Voice-over tone and emotional register must match the audience's cultural context
  → Mouth movement realism must account for the language's phoneme set

════════════════════════════════════════
SECTION 5 — VIRAL PACING ARCHITECTURE
════════════════════════════════════════

SHATTER PREDICTABILITY:
Do not default to Hook → Build → Climax → Resolution.
Use structural disruption: flashbacks, non-linear jumps, in-medias-res, abstract metaphors, pattern interrupts. Every 3 seconds must give the viewer a reason to keep watching.

VOICE-OVER PROTOCOL:
- Maximum 12 words per scene (unless clip exceeds 8 seconds)
- Must trigger: curiosity | desire | urgency | nostalgia | pride | awe
- Brand-authentic register — felt, not sold
- LIP SYNC ADDENDUM: Write voiceOver so prominent open-vowel phonemes land during the character's most face-forward, well-lit moments

════════════════════════════════════════
SECTION 6 — FINAL SCENE LAW
════════════════════════════════════════

The final scene must:
  → Deliver definitive visual and emotional closure
  → Not imply or suggest continuation
  → End on a closing frame that stands alone as a poster frame
  → If lip sync active: end with mouth closed, expression resolved — not mid-word

════════════════════════════════════════
SECTION 7 — VISUAL RESTRICTIONS
════════════════════════════════════════

Never depict or describe:
  - Logos, watermarks, or brand marks within the visual frame
  - Subtitles, captions, or text overlays
  - UI elements or on-screen interfaces

════════════════════════════════════════
SECTION 8 — OUTPUT SPECIFICATION
════════════════════════════════════════

OUTPUT FORMAT: Valid JSON only.
No markdown. No explanations. No code fences. No trailing text.

SCENE PARAMETERS:
- Total scenes: exactly ${sceneCount}
- Each scene duration: exactly ${clipDuration} seconds
- Total video duration: ${totalDuration} seconds

FIELD DEFINITIONS:
  openingFrame       — Exact frame state at scene start. Lip sync: include character mouth state.
  cinematicData      — Strict visual properties. MUST contain: action, subject, environment, lighting, camera, mood, style, motion.
  closingFrame       — Exact frame state at scene end. Lip sync: include character mouth state and expression at speech end.
  transitionStrategy — Exactly one from the approved list.
  voiceOver          — Max 12 words. Triggers real emotion. Brand-authentic.
  onScreenText       — Empty string.
  lipSyncManifest    — Complete manifest object per schema below. required=false → all other fields null/empty.

LIPSYNC MANIFEST SCHEMA:
{
  "required": boolean,
  "speakingCharacter": "character identifier or null",
  "dialogueText": "exact voiceOver text or null",
  "phonemeHints": [
    { "word": "string", "phoneme": "ARPABET", "viseme": "viseme class", "relativePosition": 0.0 }
  ],
  "mouthOpenDuration": integer,
  "facialVisibility": {
    "faceVisible": boolean,
    "estimatedFaceSize": "close|medium|wide|extreme-wide",
    "occlusionRisk": "none|low|medium|high",
    "occlusionSource": "string or null"
  },
  "syncAnchorFrame": "opening|mid|closing",
  "emotionalExpression": "one word"
}

BRAND CONTEXT:
${JSON.stringify(brandContext, null, 2)}

${hasUploadedImage ? `════════════════════════════════════════
SECTION 9 — INITIAL IMAGE UPLOAD
════════════════════════════════════════
The user has uploaded an initial image of a character. You MUST ensure that your cinematicData.subject for every scene explicitly specifies that the character's Face and Body must be used perfectly and consistently, but the background from the initial image should NOT be preserved (the background environment should reflect the scene instead).` : ""}`;

  if (isApprovalSkipped) {
    systemPrompt = `You are an elite Cinematic Director operating in the style of Edgar Wright and Martin Scorsese.
Your job is to take the user's exact foundational prompt and split it into ${sceneCount} logical, highly engaging scenes.
You MUST NOT creatively alter the user's core story intent or dialogue, but you MUST elevate the pacing and visual dynamism.
The ${clipDuration}-second scenes must be written effectively for the video generation model by extracting visual keywords directly from the user's prompt and applying rhythmic, cinematic pacing.

════════════════════════════════════════
SECTION 1 — CINEMATIC PACING & MOMENTUM
════════════════════════════════════════
Instead of static continuity, you must use dynamic camera language and intentional cuts to drive the narrative forward:
  → Use Scorsese-style fluid tracking shots, push-ins, and chaotic realism for tension or dialogue scenes.
  → Use Edgar Wright-style whip-pans, snap-zooms, match cuts on action, and rhythmic momentum for action or transition scenes.
  → Change the camera angle, framing, or momentum between scenes (e.g., from a Wide Tracking Shot to an Extreme Close-up) to keep the viewer engaged. Do not use continuous static shots.

════════════════════════════════════════
SECTION 2 — CHARACTER CONSISTENCY
════════════════════════════════════════
${hasUploadedImage 
  ? `The user has uploaded an initial image. The AI will inherently use this. Therefore, in the [SUBJECT] field, DO NOT explicitly describe the character's physical traits (face/body). Focus ONLY on the character's action, emotion, and clothing in that specific scene.` 
  : `No initial image was uploaded. You must establish a "Master Character Profile" (e.g., "John, a 30yo man with a sharp jawline, wearing a red leather jacket") and explicitly include this exact, consistent physical description in the [SUBJECT] field for EVERY scene to ensure the AI generates the same character.`}

════════════════════════════════════════
SECTION 3 — LIP SYNC & OUTPUT SPECIFICATION
════════════════════════════════════════
OUTPUT FORMAT: Valid JSON only.
No markdown. No explanations. No code fences. No trailing text.

SCENE PARAMETERS:
- Total scenes: exactly ${sceneCount}
- Each scene duration: exactly ${clipDuration} seconds
- Total video duration: ${totalDuration} seconds

FIELD DEFINITIONS:
  openingFrame       — Exact frame state at scene start. Lip sync: include character mouth state.
  cinematicData      — Strict visual properties. MUST contain: action, subject, environment, lighting, camera, mood, style, motion.
  closingFrame       — Exact frame state at scene end. Lip sync: include character mouth state and expression at speech end.
  transitionStrategy — Transition approach (e.g. Match Cut, Whip Pan, Snap Zoom).
  voiceOver          — The exact text the user provided that should be spoken in this scene.
  onScreenText       — Empty string.
  lipSyncManifest    — Complete manifest object per schema below. required=false → all other fields null/empty.

LIPSYNC MANIFEST SCHEMA:
{
  "required": boolean,
  "speakingCharacter": "character identifier or null",
  "dialogueText": "exact voiceOver text or null",
  "phonemeHints": [
    { "word": "string", "phoneme": "ARPABET", "viseme": "viseme class", "relativePosition": 0.0 }
  ],
  "mouthOpenDuration": integer,
  "facialVisibility": {
    "faceVisible": boolean,
    "estimatedFaceSize": "close|medium|wide|extreme-wide",
    "occlusionRisk": "none|low|medium|high",
    "occlusionSource": "string or null"
  },
  "syncAnchorFrame": "opening|mid|closing",
  "emotionalExpression": "one word"
}

BRAND CONTEXT:
${JSON.stringify(brandContext, null, 2)}
`;
  }

  /* ── User Message ───────────────────────────────────────────── */
  const userMessage = `VIDEO REQUEST: "${prompt}"

Generate exactly ${sceneCount} scenes for a ${totalDuration}-second video (${clipDuration} seconds per scene).

EXECUTION CHECKLIST — complete mentally before writing each scene:

CONTINUITY CHECKS:
□ Scene 1? → Define all recurring characters in full, including mouth anatomy
□ Scene N>1? → Read Scene N-1 closingFrame, begin openingFrame as direct continuation
□ Camera motion continuous from previous scene?
□ Environment state preserved or intentionally shifted?
□ cinematicData.action free of openingFrame/closingFrame content?

LIP SYNC CHECKS:
□ voiceOver non-empty AND character visible in frame? → required = true
□ If required = true:
  → Decomposed every word into word/phoneme/viseme/relativePosition?
  → Camera holds medium or closer for ≥60% of clip?
  → closingFrame describes character mouth state?
  → cinematicData.action includes mouth articulation and micro-expression details?
  → mouthOpenDuration calculated correctly?
  → facialVisibility assessed accurately?

QUALITY CHECKS:
□ voiceOver triggers genuine emotion in ≤12 words?
□ Final scene: definitive closure, mouth closed at end?

Return this exact JSON structure:
{
  "title": "video title maximum 8 words",
  "scenes": [
    {
      "order": 1,
      "openingFrame": "Precise frame state at scene start. Lip sync: include character mouth state.",
      "cinematicData": {
        "action": "Scene action, cinematography, movement only. Lip sync: mouth articulation arc, micro-expression.",
        "subject": "Detailed character breakdown and anatomy...",
        "environment": "Setting and background elements...",
        "lighting": "Lighting setup, key/fill/backlight...",
        "camera": "Lens, angle, and framing...",
        "mood": "Emotional undertone...",
        "style": "Visual aesthetic and color grading...",
        "motion": "Camera or subject momentum..."
      },
      "closingFrame": "Precise frame state at scene end. Lip sync: character mouth state and expression at speech end.",
      "transitionStrategy": "Exactly one approved transition strategy",
      "voiceOver": "Max 12 words. Real emotion. Brand voice.",
      "onScreenText": "",
      "lipSyncManifest": {
        "required": true,
        "speakingCharacter": "character identifier",
        "dialogueText": "exact voiceOver text",
        "phonemeHints": [
          { "word": "word", "phoneme": "ARPABET", "viseme": "viseme class", "relativePosition": 0.0 }
        ],
        "mouthOpenDuration": 72,
        "facialVisibility": {
          "faceVisible": true,
          "estimatedFaceSize": "medium",
          "occlusionRisk": "none",
          "occlusionSource": null
        },
        "syncAnchorFrame": "mid",
        "emotionalExpression": "confidence"
      }
    }
  ]
}`;

  /* ── API Call ───────────────────────────────────────────────── */
  let raw;
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      // Token budget:
      //   Base scene fields:    ~300 tokens/scene
      //   LipSyncManifest:      ~500 tokens/scene (phonemeHints dense)
      //   Title + wrapper:      ~50 tokens
      //   Reduced to 4000 to align with aiService and prevent proxy/API truncation limits
      max_tokens: 10000,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }, { timeout: 180000 });
    raw = response.content[0].text.trim();
  } catch (err) {
    logger.error(`[Storyboard] Claude API call failed: ${err.message}`);
    throw new Error(`Storyboard generation failed: ${err.message}`);
  }

  /* ── JSON Extraction ───────────────────────────────────────── */
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    raw = jsonMatch[0];
  } else {
    raw = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
  }

  /* ── Parse ─────────────────────────────────────────────────── */
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (parseErr) {
    logger.error(
      `[Storyboard] JSON parse failed. Raw preview: ${raw.slice(0, 400)}`,
    );
    throw new Error("Storyboard generation returned invalid JSON");
  }

  if (!parsed.scenes || parsed.scenes.length === 0) {
    throw new Error("Storyboard returned empty scenes array");
  }

  /* ── Lip Sync Manifest Validation & Normalization ──────────── */
  parsed.scenes = parsed.scenes.map((scene) => {
    if (!scene.lipSyncManifest) {
      scene.lipSyncManifest = buildNullManifest();
    }

    const m = scene.lipSyncManifest;

    // If required but phonemeHints missing, flag for TTS fallback
    if (m.required && (!m.phonemeHints || m.phonemeHints.length === 0)) {
      logger.warn(
        `[Storyboard] Scene ${scene.order}: lipSync required but phonemeHints empty. Flagging for TTS fallback.`,
      );
      m._phonemeFallback = true;
    }

    // Clamp mouthOpenDuration
    if (typeof m.mouthOpenDuration === "number") {
      m.mouthOpenDuration = Math.max(0, Math.min(100, m.mouthOpenDuration));
    }

    // Normalize phoneme timeline
    if (m.phonemeHints && m.phonemeHints.length > 0) {
      m.phonemeHints = normalizePhonemeTimeline(m.phonemeHints);
    }

    // Validate viseme values against closed set
    if (m.phonemeHints) {
      m.phonemeHints = m.phonemeHints.map((hint) => ({
        ...hint,
        viseme: VALID_VISEMES.has(hint.viseme) ? hint.viseme : "rest",
      }));
    }

    // Auto-downgrade: if face too small for sync engine, disable sync
    if (
      m.required &&
      m.facialVisibility?.faceVisible &&
      !LIP_SYNC_MIN_FACE_SIZE_CLASSES.has(m.facialVisibility.estimatedFaceSize)
    ) {
      logger.warn(
        `[Storyboard] Scene ${scene.order}: face size "${m.facialVisibility.estimatedFaceSize}" is too small for lip sync engine. Auto-downgrading to narrator mode.`,
      );
      m.required = false;
      m._autoDowngraded = true;
    }

    return scene;
  });

  /* ── Scene Count Correction ────────────────────────────────── */
  if (parsed.scenes.length !== sceneCount) {
    logger.warn(
      `[Storyboard] Scene count mismatch: expected ${sceneCount}, received ${parsed.scenes.length}. Correcting.`,
    );
    while (parsed.scenes.length < sceneCount) {
      const last = parsed.scenes[parsed.scenes.length - 1];
      parsed.scenes.push({
        order: parsed.scenes.length + 1,
        openingFrame: last.closingFrame || "",
        visualPrompt: last.visualPrompt || "",
        closingFrame: last.closingFrame || "",
        transitionStrategy: "Environmental Continuation",
        voiceOver: "",
        onScreenText: "",
        lipSyncManifest: buildNullManifest(),
      });
    }
    parsed.scenes = parsed.scenes.slice(0, sceneCount);
  }

  /* ── Reindex & Return ──────────────────────────────────────── */
  parsed.scenes = parsed.scenes.map((s, i) => ({ ...s, order: i + 1 }));
  return parsed;
}

/* ═══════════════════════════════════════════════════════════════
   STEP 2 — SEQUENTIAL CLIP GENERATION WITH LAST-FRAME CONTINUITY
═══════════════════════════════════════════════════════════════ */

/**
 * Generates all scene clips one by one.
 * After generation, speaking scenes are optionally routed through the lip sync engine.
 * The last frame of clip N is extracted and used as the init image for clip N+1.
 *
 * @returns {Promise<Array<{url: string, text: string}>>}
 */
async function generateClipsSequentially({
  storyboard,
  userId,
  firstFrameBase64,
  params,
  chatId,
  messageId,
  sceneCount,
  contactLines,
  logoUrl,
  clipDuration,
  finalCostPerChunk,
  activeVideoModel,
  isBusiness,
  enableLipSync,
  prompt,
  hasUploadedImage,
  isApprovalSkipped,
}) {
  const clipUrls = [];
  let currentInitFrame = firstFrameBase64 || null;

  if (hasUploadedImage && isApprovalSkipped && currentInitFrame) {
    try {
      logger.info(`[LongForm] Approval skipped. Running background removal on uploaded image...`);
      currentInitFrame = await removeBackgroundFromBase64(currentInitFrame);
    } catch (err) {
      logger.error(`[LongForm] Background removal failed: ${err.message}`);
    }
  }

  // Extract global audio descriptor to maintain voice consistency
  const audioSplit = prompt ? prompt.split(/Audio track:/i) : [];
  const globalAudioDescriptor = audioSplit.length > 1 ? audioSplit[1].trim() : "";

  for (let i = 0; i < storyboard.scenes.length; i++) {
    const scene = storyboard.scenes[i];
    const isLast = i === storyboard.scenes.length - 1;

    // Progress: scenes occupy 18%→78% of the progress bar
    const sceneProgress = 18 + Math.floor(((i + 1) / sceneCount) * 60);

    emit(chatId, "generation:progress", {
      messageId,
      percentage: sceneProgress,
      message: `Generating scene ${i + 1} of ${sceneCount}…`,
    });

    logger.info(`[LongForm] Scene ${i + 1}/${sceneCount}: generating clip`);

    const clipParams = {
      ...params,
      duration: clipDuration,
      logoUrl: logoUrl || params?.logoUrl,
      contactLines: isLast ? contactLines : [],
      enhancePrompt: isApprovalSkipped,
      isContinuationFrame: i > 0,
    };

    // Build the final prompt: visual + voiceover hint + hard text suppression
    let sceneVisual = "";
    if (scene.cinematicData) {
      if (hasUploadedImage) {
        sceneVisual = `[ENVIRONMENT]: ${scene.cinematicData.environment || ""}
[LIGHTING]: ${scene.cinematicData.lighting || ""}
[CAMERA]: ${scene.cinematicData.camera || ""}
[MOTION]: ${scene.cinematicData.motion || ""}
[MOOD & STYLE]: ${scene.cinematicData.mood || ""}, ${scene.cinematicData.style || ""}
[ACTION]: ${scene.cinematicData.action || ""}`;
      } else {
        sceneVisual = `[SUBJECT]: ${scene.cinematicData.subject || ""}
[ENVIRONMENT]: ${scene.cinematicData.environment || ""}
[LIGHTING]: ${scene.cinematicData.lighting || ""}
[CAMERA]: ${scene.cinematicData.camera || ""}
[MOTION]: ${scene.cinematicData.motion || ""}
[MOOD & STYLE]: ${scene.cinematicData.mood || ""}, ${scene.cinematicData.style || ""}
[ACTION]: ${scene.cinematicData.action || ""}`;
      }
    } else {
      sceneVisual = scene.visualPrompt || scene.prompt || "";
    }
    let finalPrompt = sceneVisual;

    const isPixverse = clipParams.engine === "pixverse" || (clipParams.model && clipParams.model.includes("pixverse"));

    if (isPixverse) {
      clipParams.negative_prompt = "Text, Letters, Words, Typography, or WATERMARKS.";
    } else {
      finalPrompt +=
        "\n\nNegative Prompt: Text, Letters, Words, Typography, or WATERMARKS. The visuals must be completely devoid of text.";
    }

    // Append audio track at the absolute END to prevent LLM recency bias overriding it
    if (scene.voiceOver && scene.voiceOver.trim() !== "") {
      finalPrompt += `\n\nAudio track: ${globalAudioDescriptor}\nDialogue: "${scene.voiceOver}"\nCRITICAL: Ensure perfect lip sync for the spoken dialogue.`;
    } else if (globalAudioDescriptor) {
      finalPrompt += `\n\nAudio track: ${globalAudioDescriptor}`;
    }

    let enhancedVeoPrompt = finalPrompt;
    if (isApprovalSkipped) {
      // Explicitly enforce physics since Claude isn't here to do it
      enhancedVeoPrompt = finalPrompt + "\n\nMOTION & PHYSICS INSTRUCTION: Enforce ultra-realistic physics, natural gravity, and correct anatomical movement. The subject must move realistically with forward momentum, proper foot contact, and realistic weight. No sliding, floating, or backward motion. Render in cinematic quality with depth.";
    } else {
      enhancedVeoPrompt = await enhancePromptCinematically(finalPrompt, userId);
    }

    /* ── Generate raw clip ─────────────────────────────────── */
    let clipResult;
    try {
      clipResult = await generateVideo(
        enhancedVeoPrompt,
        userId,
        currentInitFrame,
        clipParams,
        chatId,
        messageId,
        true, // isLongFormClip
        isBusiness,
      );
    } catch (clipErr) {
      logger.error(
        `[LongForm] Scene ${i + 1} generation failed: ${clipErr.message}`,
      );
      if (clipUrls.length === 0) {
        throw new Error(
          `Long-form video failed on scene 1: ${clipErr.message}`,
        );
      }
      logger.warn(
        `[LongForm] Skipping scene ${i + 1} due to error. Stitching ${clipUrls.length} completed scenes.`,
      );
      emit(chatId, "generation:progress", {
        messageId,
        percentage: sceneProgress,
        message: "A scene encountered an issue. Bypassing it and finalizing your video... please wait!",
      });
      break;
    }

    let finalClipUrl = clipResult.videoUrl;

    /* ── Voice Consistency: ElevenLabs Audio Overlay ───────── */
    if (scene.voiceOver && scene.voiceOver.trim() !== "" && process.env.ELEVENLABS_API_KEY) {
      try {
        emit(chatId, "generation:progress", {
          messageId,
          percentage: sceneProgress,
          message: `Applying consistent voiceover for scene ${i + 1}…`,
        });

        finalClipUrl = await applyConsistentAudioOverlay({
          videoUrl: finalClipUrl,
          text: scene.voiceOver.trim(),
          userId,
          sceneIndex: i + 1,
          clipDuration,
        });

        logger.info(
          `[LongForm] Consistent audio overlay applied for scene ${i + 1}: ${finalClipUrl}`,
        );
      } catch (audioErr) {
        logger.warn(
          `[LongForm] Audio overlay failed for scene ${i + 1}: ${audioErr.message}. Using raw Veo audio.`,
        );
      }
    }

    /* ── Lip Sync Post-Processing ──────────────────────────── */
    const manifest = scene.lipSyncManifest;
    const shouldSync =
      enableLipSync &&
      manifest?.required === true &&
      !manifest?._autoDowngraded &&
      manifest?.dialogueText?.trim();

    if (shouldSync) {
      try {
        emit(chatId, "generation:progress", {
          messageId,
          percentage: sceneProgress,
          message: `Syncing lips for scene ${i + 1}…`,
        });

        finalClipUrl = await applyLipSync({
          videoUrl: clipResult.videoUrl,
          manifest,
          clipDuration,
          userId,
          sceneIndex: i + 1,
        });

        logger.info(
          `[LongForm] Lip sync applied for scene ${i + 1}: ${finalClipUrl}`,
        );
      } catch (syncErr) {
        // Non-fatal: fall back to raw clip if sync fails
        logger.warn(
          `[LongForm] Lip sync failed for scene ${i + 1}: ${syncErr.message}. Using raw clip.`,
        );
        finalClipUrl = clipResult.videoUrl;
      }
    }

    clipUrls.push({
      url: finalClipUrl,
      text: scene.onScreenText || "",
    });

    logger.info(`[LongForm] Scene ${i + 1} complete: ${finalClipUrl}`);

    /* ── Extract last frame for next scene's init image ─────── */
    if (!isLast) {
      try {
        currentInitFrame = await extractLastFrameAsBase64(finalClipUrl);
        logger.info(`[LongForm] Last frame extracted for scene ${i + 2}`);
      } catch (frameErr) {
        logger.warn(
          `[LongForm] Last-frame extraction failed for scene ${i + 1}: ${frameErr.message}. Next scene will use no init frame.`,
        );
        currentInitFrame = null;
      }
    }
  }

  if (clipUrls.length === 0) {
    throw new Error("No clips were successfully generated for long-form video");
  }

  return clipUrls;
}

/* ═══════════════════════════════════════════════════════════════
   STEP 2.5 — CONSISTENT AUDIO OVERLAY (ELEVENLABS)
═══════════════════════════════════════════════════════════════ */

/**
 * Applies a highly consistent ElevenLabs voiceover to a generated video clip,
 * replacing the randomly generated Veo internal audio.
 */
async function applyConsistentAudioOverlay(videoUrl, text, clipDuration, sceneIndex, userId) {
  const voiceId = process.env.ELEVENLABS_VOICE_ID || "pNInz6obpgDQGcFmaJgB"; // Default: Adam
  const apiKey = process.env.ELEVENLABS_API_KEY;

  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not configured.");

  logger.info(`[VoiceOverlay] Generating ElevenLabs audio for Scene ${sceneIndex}`);

  const ttsResponse = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      text: text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.8 }
    },
    {
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json"
      },
      responseType: "arraybuffer",
      timeout: 30000
    }
  );

  let localVideoPath = null;
  let localAudioPath = null;

  try {
    localVideoPath = await downloadFileToDisk(videoUrl, `overlay_vid_${sceneIndex}`);
    localAudioPath = path.join(TEMP_DIR, `tts_${uuidv4()}.mp3`);
    fs.writeFileSync(localAudioPath, ttsResponse.data);

    const hasAudio = await new Promise((resolve) => {
      ffmpeg.ffprobe(localVideoPath, (err, metadata) => {
        if (err || !metadata) return resolve(false);
        resolve(metadata.streams.some(s => s.codec_type === 'audio'));
      });
    });

    const passThrough = new PassThrough();
    const chunks = [];
    passThrough.on('data', chunk => chunks.push(chunk));

    await new Promise((resolve, reject) => {
      let ffmpegCmd = ffmpeg().input(localVideoPath).input(localAudioPath);

    if (hasAudio) {
      ffmpegCmd
        .complexFilter([
          "[0:a]volume=0.3[bgm]",
          "[1:a]volume=1.0[tts]",
          "[bgm][tts]amix=inputs=2:duration=first:dropout_transition=2[aout]"
        ])
        .outputOptions([
          "-map 0:v:0",
          "-map [aout]",
          "-c:v copy",
          "-c:a aac",
          "-b:a 192k",
          `-t ${clipDuration}`,
          "-f mp4",
          "-movflags empty_moov+frag_keyframe+default_base_moof"
        ]);
    } else {
      ffmpegCmd
        .outputOptions([
          "-map 0:v:0",
          "-map 1:a:0",
          "-c:v copy",
          "-c:a aac",
          "-b:a 192k",
          `-t ${clipDuration}`,
          "-f mp4",
          "-movflags empty_moov+frag_keyframe+default_base_moof"
        ]);
    }

    ffmpegCmd
      .on("end", resolve)
      .on("error", (err) => reject(new Error(`FFmpeg mux failed: ${err.message}`)))
      .pipe(passThrough, { end: true });
  });

  const finalBuffer = Buffer.concat(chunks);
  const runId = uuidv4().slice(0, 8);
  const finalUrl = await uploadBase64VideoToS3(
    finalBuffer.toString("base64"),
    `scene_${sceneIndex}_${userId}_${runId}`
  );

  return finalUrl;
  } finally {
    safeUnlink(localVideoPath);
    safeUnlink(localAudioPath);
  }
}

/* ═══════════════════════════════════════════════════════════════
   STEP 2B — LIP SYNC ENGINE ROUTER
═══════════════════════════════════════════════════════════════ */

/**
 * Routes a generated clip through the lip sync engine.
 *
 * Architecture:
 *   1. Generate TTS audio from dialogueText (ElevenLabs / Azure TTS)
 *   2. If _phonemeFallback=true, use TTS word-timestamps to auto-align phonemes
 *   3. Submit (video + audio + phonemeHints) to sync engine (LatentSync / Wav2Lip / D-ID)
 *   4. Poll for result, return final synced clip URL
 *
 * This function is the integration boundary. Swap the engine implementation
 * without touching any other part of the pipeline.
 *
 * @param {object} opts
 * @param {string} opts.videoUrl       - Raw generated clip URL
 * @param {object} opts.manifest       - Validated LipSyncManifest from storyboard
 * @param {number} opts.clipDuration   - Duration of the clip in seconds
 * @param {string} opts.userId
 * @param {number} opts.sceneIndex     - 1-based scene number for logging
 *
 * @returns {Promise<string>}          - URL of the lip-synced clip
 */
async function applyLipSync({
  videoUrl,
  manifest,
  clipDuration,
  userId,
  sceneIndex,
}) {
  const {
    dialogueText,
    phonemeHints,
    facialVisibility,
    syncAnchorFrame,
    emotionalExpression,
    mouthOpenDuration,
    _phonemeFallback,
  } = manifest;

  logger.info(
    `[LipSync] Scene ${sceneIndex}: "${dialogueText}" | face=${facialVisibility.estimatedFaceSize} | anchor=${syncAnchorFrame} | openDuration=${mouthOpenDuration}%`,
  );

  /* ── Step A: Generate TTS audio ────────────────────────── */
  const audioResult = await generateTTSAudio({
    text: dialogueText,
    emotionalExpression,
    userId,
  });
  // audioResult: { audioUrl: string, wordTimestamps: Array<{word, startMs, endMs}> }

  /* ── Step B: Resolve phoneme hints ─────────────────────── */
  let resolvedPhonemes = phonemeHints;
  if (_phonemeFallback && audioResult.wordTimestamps?.length > 0) {
    // Auto-generate phoneme alignment from TTS word timestamps
    resolvedPhonemes = autoAlignPhonemesFromTimestamps({
      wordTimestamps: audioResult.wordTimestamps,
      clipDurationMs: clipDuration * 1000,
    });
    logger.info(
      `[LipSync] Scene ${sceneIndex}: using TTS auto-alignment (${resolvedPhonemes.length} phonemes)`,
    );
  }

  /* ── Step C: Submit to lip sync engine ─────────────────── */
  const syncedUrl = await submitToLipSyncEngine({
    videoUrl,
    audioUrl: audioResult.audioUrl,
    phonemeHints: resolvedPhonemes,
    facialVisibility,
    syncAnchorFrame,
    clipDuration,
    userId,
    sceneIndex,
  });

  return syncedUrl;
}

/**
 * Generates TTS audio for a dialogue line.
 * Returns the audio URL and word-level timestamps for phoneme fallback alignment.
 *
 * Swap this implementation for ElevenLabs, Azure TTS, or any other provider.
 *
 * @returns {Promise<{audioUrl: string, wordTimestamps: Array<{word, startMs, endMs}>}>}
 */
async function generateTTSAudio({ text, emotionalExpression, userId }) {
  // ── Implementation slot ────────────────────────────────────────────
  // Example ElevenLabs call:
  //
  // const response = await fetch("https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps", {
  //   method: "POST",
  //   headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "Content-Type": "application/json" },
  //   body: JSON.stringify({
  //     text,
  //     model_id: "eleven_multilingual_v2",
  //     voice_settings: { stability: 0.5, similarity_boost: 0.8 }
  //   })
  // });
  // const data = await response.json();
  // const audioUrl = await uploadBase64VideoToS3(data.audio_base64, `tts_${userId}_${uuidv4().slice(0,8)}`);
  // const wordTimestamps = data.alignment.words.map(w => ({
  //   word: w.word,
  //   startMs: Math.round(w.start * 1000),
  //   endMs: Math.round(w.end * 1000)
  // }));
  // return { audioUrl, wordTimestamps };
  // ── End implementation slot ───────────────────────────────────────

  throw new Error(
    "[LipSync] generateTTSAudio: no TTS provider configured. Implement ElevenLabs / Azure TTS here.",
  );
}

/**
 * Auto-aligns phoneme hints from TTS word-level timestamps when Claude's
 * phoneme map is missing (_phonemeFallback=true).
 *
 * Maps each TTS word timestamp to a relativePosition within the clip timeline.
 *
 * @param {Array<{word, startMs, endMs}>} wordTimestamps
 * @param {number}                        clipDurationMs
 * @returns {Array<{word, phoneme, viseme, relativePosition}>}
 */
function autoAlignPhonemesFromTimestamps({ wordTimestamps, clipDurationMs }) {
  return wordTimestamps.map((w) => ({
    word: w.word,
    phoneme: "",       // TTS engine doesn't expose raw ARPABET; leave empty
    viseme: "open",    // Safe fallback: open mouth shape during speech
    relativePosition: parseFloat(
      Math.min(0.92, w.startMs / clipDurationMs).toFixed(3),
    ),
  }));
}

/**
 * Submits a clip + audio + phoneme map to the lip sync rendering engine.
 * Returns the URL of the processed clip.
 *
 * Swap this for LatentSync, Wav2Lip, SadTalker, D-ID, or HeyGen.
 *
 * @returns {Promise<string>} - URL of the synced video clip
 */
async function submitToLipSyncEngine({
  videoUrl,
  audioUrl,
  phonemeHints,
  facialVisibility,
  syncAnchorFrame,
  clipDuration,
  userId,
  sceneIndex,
}) {
  // ── Implementation slot ────────────────────────────────────────────
  //
  // Example D-ID /talks endpoint:
  //
  // const payload = {
  //   source_url: videoUrl,
  //   script: {
  //     type: "audio",
  //     audio_url: audioUrl,
  //   },
  //   config: {
  //     fluent: true,
  //     pad_audio: 0.0,
  //     stitch: true,
  //   },
  // };
  //
  // const createRes = await fetch("https://api.d-id.com/talks", {
  //   method: "POST",
  //   headers: { Authorization: `Basic ${process.env.DID_API_KEY}`, "Content-Type": "application/json" },
  //   body: JSON.stringify(payload),
  // });
  // const { id } = await createRes.json();
  //
  // // Poll for result
  // for (let attempt = 0; attempt < 30; attempt++) {
  //   await new Promise(r => setTimeout(r, 4000));
  //   const pollRes = await fetch(`https://api.d-id.com/talks/${id}`, {
  //     headers: { Authorization: `Basic ${process.env.DID_API_KEY}` },
  //   });
  //   const result = await pollRes.json();
  //   if (result.status === "done") return result.result_url;
  //   if (result.status === "error") throw new Error(`D-ID sync failed: ${result.error}`);
  // }
  // throw new Error(`D-ID sync timed out for scene ${sceneIndex}`);
  //
  // ── End implementation slot ───────────────────────────────────────

  throw new Error(
    "[LipSync] submitToLipSyncEngine: no sync engine configured. Implement LatentSync / Wav2Lip / D-ID here.",
  );
}

/* ═══════════════════════════════════════════════════════════════
   STEP 3A — LAST-FRAME EXTRACTION
═══════════════════════════════════════════════════════════════ */

/**
 * Downloads a video clip, extracts the last frame using FFmpeg,
 * and returns it as a base64-encoded JPEG string.
 *
 * @param {string} videoUrl   - S3 or CDN URL of the generated clip
 * @returns {Promise<string>} - base64-encoded JPEG (no data URI prefix)
 */
export async function extractLastFrameAsBase64(videoUrl) {
  let localPath = null;
  let tmpJpg = null;
  try {
    localPath = await downloadFileToDisk(videoUrl, "extract");
    tmpJpg = localPath + ".jpg";

    return await new Promise((resolve, reject) => {
      logger.info(`[LongForm] Extracting true last frame using stream parsing...`);
      
      ffmpeg(localPath)
        .outputOptions([
          "-update 1", // Continuously overwrite the output file (guarantees the very last frame is saved)
          "-q:v 2"
        ])
        .save(tmpJpg)
        .on("end", () => {
          if (!fs.existsSync(tmpJpg)) {
            return reject(new Error("FFmpeg completed but no image was created"));
          }
          const buf = fs.readFileSync(tmpJpg);
          if (buf.length === 0) {
            return reject(new Error("Extracted image is empty"));
          }
          resolve(buf.toString("base64"));
        })
        .on("error", (err) => {
          logger.warn(`[LongForm] Primary extract failed: ${err.message}. Falling back to basic extract.`);
          // Fallback: Just grab a frame from the beginning if the video stream parsing fails completely
          ffmpeg(localPath)
            .outputOptions(["-vf", "select='eq(n\\,0)'", "-vframes 1"])
            .save(tmpJpg)
            .on("end", () => {
              if (!fs.existsSync(tmpJpg)) return reject(new Error("Fallback also failed"));
              resolve(fs.readFileSync(tmpJpg).toString("base64"));
            })
            .on("error", fallbackErr => reject(fallbackErr));
        });
    });
  } finally {
    if (localPath && fs.existsSync(localPath)) try { fs.unlinkSync(localPath); } catch (e) {}
    if (tmpJpg && fs.existsSync(tmpJpg)) try { fs.unlinkSync(tmpJpg); } catch (e) {}
  }
}

/* ═══════════════════════════════════════════════════════════════
   STEP 3B — VIDEO STITCHING (FFMPEG)
═══════════════════════════════════════════════════════════════ */

/**
 * Downloads all clip URLs, concatenates them using FFmpeg's concat demuxer,
 * applies the logo outro, uploads the result to S3.
 *
 * @param {Array<{url: string, text: string}>} clipUrls
 * @param {string}   userId
 * @param {Array}    contactLines
 * @param {string}   logoUrl
 * @param {boolean}  isApprovalSkipped
 * @returns {Promise<string>} - Final video S3 URL
 */
async function stitchVideoClips(
  clipUrls,
  userId,
  contactLines = [],
  logoUrl = null,
  isApprovalSkipped,
) {
  if (clipUrls.length === 1) {
    logger.info("[LongForm] Single clip — skipping concat, applying outro");
    return await applyOutroToSingleClip({
      clipUrl: clipUrls[0].url,
      userId,
      logoUrl,
      contactLines,
      isApprovalSkipped,
    });
  }

  const runId = uuidv4().slice(0, 8);

  const localClipPaths = [];
  let localLogoPath = null;

  try {
    logger.info(`[LongForm] Downloading ${clipUrls.length} clips for local stitching`);
    for (let i = 0; i < clipUrls.length; i++) {
      const p = await downloadFileToDisk(clipUrls[i].url, `stitch_${i}`);
      localClipPaths.push(p);
    }

    if (logoUrl) {
      localLogoPath = await downloadImageToPng(logoUrl, "logo");
    }

    const getClipMetadata = (localPath) => new Promise((resolve, reject) => {
      ffmpeg.ffprobe(localPath, (err, metadata) => {
        if (err) return reject(err);
        const hasAudio = metadata.streams.some(s => s.codec_type === 'audio');
        const videoStream = metadata.streams.find(s => s.codec_type === 'video');
        const width = videoStream ? videoStream.width : 1280;
        const height = videoStream ? videoStream.height : 720;
        resolve({ duration: metadata?.format?.duration || 8, hasAudio, width, height });
      });
    });

    logger.info(`[LongForm] Analyzing ${localClipPaths.length} local clips for stitching`);
    const clipsMeta = [];
    for (let i = 0; i < localClipPaths.length; i++) {
      const meta = await getClipMetadata(localClipPaths[i]);
      clipsMeta.push(meta);
      logger.info(`[LongForm] Analyzed clip ${i + 1} (Duration: ${meta.duration}s, Audio: ${meta.hasAudio})`);
    }

    logger.info(`[LongForm] Stitching clips with 0.5s crossfade in memory...`);
    let ffmpegCmd = ffmpeg();
    localClipPaths.forEach(p => {
      ffmpegCmd = ffmpegCmd.input(p);
    });

    if (localLogoPath) {
      ffmpegCmd = ffmpegCmd.input(localLogoPath);
    }

  const targetWidth = clipsMeta[0].width || 1280;
  const targetHeight = clipsMeta[0].height || 720;
  const FADE_DURATION = 0.5;
  const filtergraph = [];

  for (let i = 0; i < clipUrls.length; i++) {
    filtergraph.push(`[${i}:v]settb=AVTB,fps=24,scale=${targetWidth}:${targetHeight},format=yuv420p[v${i}_fmt]`);
    if (clipsMeta[i].hasAudio) {
      filtergraph.push(`[${i}:a]aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo[a${i}_fmt]`);
    } else {
      filtergraph.push(`anullsrc=cl=stereo:r=48000:d=${clipsMeta[i].duration}[a${i}_fmt]`);
    }
  }

  let currentDuration = clipsMeta[0].duration;
  let lastVideoLabel = "v0_fmt";
  let lastAudioLabel = "a0_fmt";

  for (let i = 1; i < clipUrls.length; i++) {
    const offset = Number(Math.max(0, currentDuration - FADE_DURATION).toFixed(3));
    const nextVideoLabel = `v${i}`;
    const nextAudioLabel = `a${i}`;
    
    filtergraph.push(`[${lastVideoLabel}][v${i}_fmt]xfade=transition=fade:duration=${FADE_DURATION}:offset=${offset}[${nextVideoLabel}]`);
    filtergraph.push(`[${lastAudioLabel}][a${i}_fmt]acrossfade=d=${FADE_DURATION}[${nextAudioLabel}]`);
    
    lastVideoLabel = nextVideoLabel;
    lastAudioLabel = nextAudioLabel;
    currentDuration = currentDuration + clipsMeta[i].duration - FADE_DURATION;
  }

  if (logoUrl) {
    const logoIndex = clipUrls.length;
    filtergraph.push(`[${logoIndex}:v]scale=iw*0.15:-1[logo]`);
    filtergraph.push(`[${lastVideoLabel}][logo]overlay=main_w-overlay_w-20:20[final_v]`);
    lastVideoLabel = 'final_v';
  }

  const passThrough = new PassThrough();
  const chunks = [];
  passThrough.on('data', chunk => chunks.push(chunk));

  await new Promise((resolve, reject) => {
    ffmpegCmd
      .complexFilter(filtergraph, [lastVideoLabel, lastAudioLabel])
      .outputOptions([
        "-c:v libx264",
        "-preset fast",
        "-crf 23",
        "-c:a aac",
        "-b:a 192k",
        "-movflags empty_moov+frag_keyframe+default_base_moof",
        "-f mp4"
      ])
      .on("start", (cmd) => logger.info(`[LongForm] FFmpeg stitch cmd started`))
      .on("end", resolve)
      .on("error", (err, stdout, stderr) => {
        logger.error(`[LongForm] FFmpeg stitch failed. Stderr: ${stderr}`);
        reject(new Error(`FFmpeg crossfade stitch failed: ${err.message}`));
      })
      .pipe(passThrough, { end: true });
  });

  logger.info(`[LongForm] Stitch complete in memory`);
  let finalBuffer = Buffer.concat(chunks);
  
  if (!isApprovalSkipped) {
      try {
        finalBuffer = await addLogoOutroToVideo(
          finalBuffer,
          null, // Logo already applied in filtergraph, so pass null to avoid duplicating logo overlay
          contactLines,
          userId,
        );
        logger.info(`[LongForm] Outro applied successfully`);
      } catch (outroErr) {
        logger.error(`[LongForm] Outro failed: ${outroErr.message}. Uploading stitched clip.`);
      }
  }

  const base64 = finalBuffer.toString("base64");
  const finalUrl = await uploadBase64VideoToS3(
    base64,
    `longform_${userId}_${runId}`
  );

  logger.info(`[LongForm] Uploaded stitched video: ${finalUrl}`);
  return finalUrl;
  } finally {
    for (const p of localClipPaths) safeUnlink(p);
    safeUnlink(localLogoPath);
  }
}

/**
 * Applies logo outro to a single-clip video without FFmpeg concat.
 */
async function applyOutroToSingleClip({
  clipUrl,
  userId,
  logoUrl,
  contactLines,
  isApprovalSkipped,
}) {
  if (isApprovalSkipped) return clipUrl;

  const response = await axios.get(clipUrl, {
    responseType: "arraybuffer",
    timeout: 120_000,
  });
  let finalBuffer = Buffer.from(response.data);

  try {
    finalBuffer = await addLogoOutroToVideo(
      finalBuffer,
      logoUrl,
      contactLines,
      userId,
    );
  } catch (err) {
    logger.error(`[LongForm] Single clip outro failed: ${err.message}`);
  }

  const runId = uuidv4().slice(0, 8);
  const base64 = finalBuffer.toString("base64");
  return await uploadBase64VideoToS3(base64, `single_outro_${userId}_${runId}`);
}

/* ═══════════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════════ */

/** Get duration of a local video file via ffprobe */
function getVideoDuration(localPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(localPath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata?.format?.duration || 8);
    });
  });
}

/**
 * Safely downloads a remote file to the local TEMP directory.
 */
async function downloadFileToDisk(url, prefix = "dl") {
  const tmpPath = path.join(TEMP_DIR, `${prefix}_${uuidv4()}.mp4`);
  const response = await axios.get(url, { responseType: "arraybuffer", timeout: 60000 });
  fs.writeFileSync(tmpPath, response.data);
  return tmpPath;
}

/**
 * Safely downloads an image and converts it to PNG (useful for SVGs which FFmpeg doesn't support well).
 */
async function downloadImageToPng(url, prefix = "logo") {
  const tmpPath = path.join(TEMP_DIR, `${prefix}_${uuidv4()}.png`);
  const response = await axios.get(url, { responseType: "arraybuffer", timeout: 60000 });
  const pngBuffer = await sharp(response.data).png().toBuffer();
  fs.writeFileSync(tmpPath, pngBuffer);
  return tmpPath;
}

/**
 * Safely unlinks a local file.
 */
// function safeUnlink(filePath) {
//   if (filePath && fs.existsSync(filePath)) {
//     try { fs.unlinkSync(filePath); } catch (e) {}
//   }
// }

/** 
 * Safely probes a remote URL by downloading it to a temporary file first. 
 * This avoids SIGSEGV crashes caused by older statically compiled ffprobe binaries 
 * attempting to negotiate modern HTTPS/GnuTLS connections.
 */
async function probeRemoteVideo(remoteUrl) {
  let localPath = null;
  try {
    localPath = await downloadFileToDisk(remoteUrl, "probe");
    return await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(localPath, (err, metadata) => {
        if (err) return reject(err);
        const hasAudio = metadata.streams.some(s => s.codec_type === 'audio');
        const videoStream = metadata.streams.find(s => s.codec_type === 'video');
        const width = videoStream ? videoStream.width : 1280;
        const height = videoStream ? videoStream.height : 720;
        resolve({ duration: metadata?.format?.duration || 8, hasAudio, width, height, metadata });
      });
    });
  } finally {
    safeUnlink(localPath);
  }
}

/** Build a null/empty LipSyncManifest for non-speaking scenes */
function buildNullManifest() {
  return {
    required: false,
    speakingCharacter: null,
    dialogueText: null,
    phonemeHints: [],
    mouthOpenDuration: 0,
    facialVisibility: {
      faceVisible: false,
      estimatedFaceSize: null,
      occlusionRisk: null,
      occlusionSource: null,
    },
    syncAnchorFrame: null,
    emotionalExpression: null,
  };
}

/**
 * Normalizes phoneme timeline:
 * - Sorts by relativePosition
 * - Clamps to [0, 1]
 * - Enforces strict monotonic increase (no two words at same position)
 * - Caps last word at 0.92 to allow mouth-close frame at clip end
 */
function normalizePhonemeTimeline(hints) {
  hints.sort((a, b) => (a.relativePosition ?? 0) - (b.relativePosition ?? 0));

  hints = hints.map((h, i) => ({
    ...h,
    relativePosition: Math.max(
      0,
      Math.min(0.92, h.relativePosition ?? i / hints.length),
    ),
  }));

  for (let i = 1; i < hints.length; i++) {
    if (hints[i].relativePosition <= hints[i - 1].relativePosition) {
      hints[i].relativePosition = parseFloat(
        Math.min(0.92, hints[i - 1].relativePosition + 0.01).toFixed(3),
      );
    }
  }

  return hints.map((h) => ({
    ...h,
    relativePosition: parseFloat(h.relativePosition.toFixed(3)),
  }));
}

/**
 * Fetch and shape brand context from MongoDB.
 * Returns empty object gracefully if no brand profile found.
 */
async function fetchBrandContext(userId) {
  try {
    const brandData = await BusinessSummaryProfile.findOne({
      userId,
      status: "COMPLETED",
      isActive: true,
    }).lean();

    if (!brandData) return {};

    return {
      brand_name: brandData.analysis?.business_overview?.brand_name,
      industry: brandData.analysis?.business_overview?.industries,
      business_type: brandData.analysis?.business_overview?.business_type,
      visual_style: brandData.analysis?.branding_guidelines?.visual_style,
      brand_colors: brandData.analysis?.branding_guidelines?.brand_colors,
      target_audience:
        brandData.analysis?.target_market?.primary_customer_segments,
      positioning:
        brandData.analysis?.competitor_analysis
          ?.competitive_positioning_summary,
      analysisSummary: brandData.analysisSummary,
    };
  } catch (err) {
    logger.warn(`[LongForm] fetchBrandContext failed: ${err.message}`);
    return {};
  }
}

/** Safely unlink a temp file — suppresses errors so cleanup never throws */
function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) {
    // Intentionally silent
  }
}