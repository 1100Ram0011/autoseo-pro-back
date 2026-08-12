// // export function buildClaudeVideoPrompt(video, businessContext) {
// //     return `
// // Generate a single continuous 8-second vertical video (9:16, 1080×1920, 30fps).
// // Broadcast quality. Ultra-realistic. Commercial production feel.

// // ═══════════════════════════════════════
// // PRODUCTION BRIEF
// // ═══════════════════════════════════════

// // BRAND: ${businessContext?.brand_name}
// // INDUSTRY: ${businessContext?.industry}
// // OBJECTIVE: ${video?.objective}
// // MUSIC MOOD: ${video?.music_mood}

// // ═══════════════════════════════════════
// // 3-ACT STRUCTURE — FULL 8 SECONDS
// // ═══════════════════════════════════════

// // ACT 1 — HOOK (0–3s)
// // ${video?.hook_first_3_seconds}
// // Fast-paced. One dominant subject. Scroll-stopping opening frame.
// // Use: whip pan / snap zoom / POV entry / bold mid-action cut-in.
// // Establish tension or desire in the first frame. No slow builds.
// // Cut timing: 0.8–1.2s per shot.

// // ACT 2 — VALUE (3–6s)
// // ${video?.script}
// // Moderate pace. Product or solution as hero.
// // Visual proof — show don't tell. Smooth transition from Act 1.
// // Cut timing: 1.5–2s per shot.

// // ACT 3 — CTA (6–7s)
// // ${video?.cta}
// // Single held frame. Peak visual energy.
// // Subject faces camera or product dominates frame.
// // Clean solid-color or blurred background — no busy elements.

// // END CARD (7–8s)
// // Pure black background. No subjects. No movement.
// // Large centered white text: "${businessContext?.brand_name}"
// // Bold sans-serif. Clean. Undistorted. Professionally typeset.
// // Text fades in over 0.3s. Holds for 0.7s.
// // Nothing else on this frame.

// // ═══════════════════════════════════════
// // SCENE BREAKDOWN
// // ═══════════════════════════════════════

// // ${video?.scene_breakdown}

// // Each scene must specify:
// // - Shot type: ECU / CU / MCU / MS / FS / WS
// // - Angle: eye-level / low-angle / high-angle / POV / bird's eye
// // - One camera movement: dolly / pan / tilt / tracking / arc / static
// // - Lens: 24–35mm (immersive) / 50mm (natural) / 85mm+ (compressed)
// // - Depth of field: shallow (premium) / deep (editorial) / rack focus (transition)

// // ═══════════════════════════════════════
// // LIGHTING
// // ═══════════════════════════════════════

// // Match to brand emotion:
// // - Golden hour: aspirational, D2C, lifestyle
// // - Rembrandt: dramatic, premium, confident
// // - Backlit: luxury, silhouette, editorial
// // - Soft diffused: friendly, healthcare, food
// // - Neon/volumetric: modern, tech, energy

// // Consistent light direction across all scenes.
// // No flat ambient. No mixed colour temperatures between scenes.
// // End card (7–8s): pure black only. Zero lighting elements.

// // ═══════════════════════════════════════
// // COLOR
// // ═══════════════════════════════════════

// // Brand primary: ${businessContext?.brand_colors?.primary}
// // Brand secondary: ${businessContext?.brand_colors?.secondary}

// // Apply across: wardrobe, environment, props, surfaces, lighting accents.
// // Both colors must appear in at least 2 natural elements per scene.
// // Grade: +10–15% saturation, crushed blacks, broadcast-safe.
// // Consistent grade across Acts 1–3.
// // End card: ungraded pure black. No color elements.

// // ═══════════════════════════════════════
// // TEXT RULES — STRICT
// // ═══════════════════════════════════════

// // Maximum 2 text elements across the entire video.
// // Text appears ONLY in high-contrast zones — never over busy backgrounds.

// // Allowed text zones:
// // - Over solid-color backgrounds only
// // - Over heavily blurred bokeh backgrounds
// // - Over the pure black end card

// // Text must be:
// // - Bold sans-serif, large, centered
// // - White on dark backgrounds only
// // - Clean, undistorted, professionally typeset
// // - No decorative fonts, no script, no stylized letterforms
// // - Minimum 15% of frame height in font size
// // - Surrounded by negative space — never touching frame edges

// // ═══════════════════════════════════════
// // AUDIO — VEO 3.1 NATIVE
// // ═══════════════════════════════════════

// // Generate fully synchronized native audio.

// // MUSIC:
// // - Mood: ${video?.music_mood}
// // - Act 1: energetic, driving — matches cut pace
// // - Act 2: builds, melodic, product-aligned
// // - Act 3: crescendo peak at 6.5s, resolves at 7s
// // - End card (7–8s): silence

// // SFX:
// // - Sync to every camera movement and cut
// // - Product interactions: crisp, tactile, satisfying
// // - Transitions: sonic punctuation on every cut
// // - Ambient bed beneath music throughout Acts 1–3

// // AUDIO MIX:
// // - Master: –3dB to –6dB, no clipping
// // - Music ducked –6dB under dialogue
// // - End card: complete silence, clean cut

// // ═══════════════════════════════════════
// // MOTION RULES
// // ═══════════════════════════════════════

// // - One camera movement per scene
// // - Transitions: match cut / smash cut / rack focus — no dissolves
// // - Act 1: fast cuts (0.8–1.2s per shot)
// // - Act 2: medium pace (1.5–2s per shot)
// // - Act 3: single held frame (2s minimum)
// // - End card: static black, no movement
// // - No motion blur unless intentional whip transition

// // ═══════════════════════════════════════
// // BRAND SAFETY
// // ═══════════════════════════════════════

// // - No copyrighted assets, logos, or celebrity likenesses
// // - No misleading visuals or fabricated claims
// // - No stock footage aesthetic — high-budget original production feel
// // - Platform compliant: Instagram Reels, TikTok, YouTube Shorts

// // `;
// // }


// //

// export function buildClaudeVideoPrompt(video, businessContext) {
//     return `
// Generate a single continuous 8-second vertical video (9:16, 1080×1920, 30fps).
// Broadcast quality. Ultra-realistic. Commercial production feel.

// ═══════════════════════════════════════
// PRODUCTION BRIEF
// ═══════════════════════════════════════

// BRAND: ${businessContext?.brand_name}
// INDUSTRY: ${businessContext?.industry}
// OBJECTIVE: ${video?.objective}
// MUSIC MOOD: ${video?.music_mood}

// ═══════════════════════════════════════
// 3-ACT STRUCTURE — FULL 8 SECONDS
// ═══════════════════════════════════════

// ACT 1 — HOOK (0–3s)
// ${video?.hook_first_3_seconds}
// Fast-paced. One dominant subject. Scroll-stopping opening frame.
// Use: whip pan / snap zoom / POV entry / bold mid-action cut-in.
// Establish tension or desire in the first frame. No slow builds.
// Cut timing: 0.8–1.2s per shot.

// ACT 2 — VALUE (3–6s)
// ${video?.script}
// Moderate pace. Product or solution as hero.
// Visual proof — show don't tell. Smooth transition from Act 1.
// Cut timing: 1.5–2s per shot.

// ACT 3 — CTA (6–7s)
// ${video?.cta}
// Single held frame. Peak visual energy.
// Script reaches its FINAL CONCLUSION in this frame.
// Every message from the script MUST be fully delivered by 7s.
// Subject faces camera or product dominates frame.
// Clean solid-color or blurred background — no busy elements.
// NO story left unfinished. NO abrupt cuts. Logical narrative end.

// ═══════════════════════════════════════
// END CARD — SECOND 8 ONLY (7–8s)
// ═══════════════════════════════════════

// Pure black background. No subjects. No movement. No scene.
// This frame contains ONLY the following brand identity elements:

// LOGO: ${businessContext?.branding_guidelines?.logo_url}
// — Centered, top half of frame
// — Original proportions, no stretch, no crop
// — Clean render, no glow, no shadow, no distortion

// BRAND NAME: ${businessContext?.brand_name}
// — Bold sans-serif, large, centered below logo
// — White text on black only
// — Undistorted, professionally typeset, zero blur

// WEBSITE: ${businessContext?.branding_guidelines?.website_url || ""}
// — Small clean text, centered below brand name
// — White, legible, no distortion

// All 3 elements fade in together over 0.3s.
// Hold clean for 0.7s.
// NOTHING ELSE on this frame — no scenes, no people, no props.

// ═══════════════════════════════════════
// SCENE BREAKDOWN
// ═══════════════════════════════════════

// ${video?.scene_breakdown?.map((scene, i) => `
// Scene ${i + 1}:
// Visual: ${scene?.visual || scene?.description || ""}
// On Screen Text: ${scene?.on_screen_text || ""}
// `).join("\n") || video?.scene_breakdown}

// Each scene must specify:
// - Shot type: ECU / CU / MCU / MS / FS / WS
// - Angle: eye-level / low-angle / high-angle / POV / bird's eye
// - One camera movement: dolly / pan / tilt / tracking / arc / static
// - Lens: 24–35mm (immersive) / 50mm (natural) / 85mm+ (compressed)
// - Depth of field: shallow (premium) / deep (editorial) / rack focus (transition)

// ═══════════════════════════════════════
// LIGHTING
// ═══════════════════════════════════════

// Match to brand emotion:
// - Golden hour: aspirational, D2C, lifestyle
// - Rembrandt: dramatic, premium, confident
// - Backlit: luxury, silhouette, editorial
// - Soft diffused: friendly, healthcare, food
// - Neon/volumetric: modern, tech, energy

// Consistent light direction across all scenes.
// No flat ambient. No mixed colour temperatures between scenes.
// End card (7–8s): pure black only. Zero lighting elements.

// ═══════════════════════════════════════
// COLOR
// ═══════════════════════════════════════

// Brand primary: ${businessContext?.brand_colors?.primary}
// Brand secondary: ${businessContext?.brand_colors?.secondary}

// Apply across: wardrobe, environment, props, surfaces, lighting accents.
// Both colors must appear in at least 2 natural elements per scene.
// Grade: +10–15% saturation, crushed blacks, broadcast-safe.
// Consistent grade across Acts 1–3.
// End card: ungraded pure black. No color elements.

// ═══════════════════════════════════════
// TEXT RULES — STRICT
// ═══════════════════════════════════════

// Maximum 2 text elements across the entire video.
// Text appears ONLY in high-contrast zones — never over busy backgrounds.

// Allowed text zones:
// - Over solid-color backgrounds only
// - Over heavily blurred bokeh backgrounds
// - Over the pure black end card

// Text must be:
// - Bold sans-serif, large, centered
// - White on dark backgrounds only
// - Clean, undistorted, professionally typeset
// - No decorative fonts, no script, no stylized letterforms
// - Minimum 15% of frame height in font size
// - Surrounded by negative space — never touching frame edges

// ═══════════════════════════════════════
// AUDIO — VEO 3.1 NATIVE
// ═══════════════════════════════════════

// Generate fully synchronized native audio.

// MUSIC:
// - Mood: ${video?.music_mood}
// - Act 1: energetic, driving — matches cut pace
// - Act 2: builds, melodic, product-aligned
// - Act 3: crescendo peak at 6.5s, resolves at 7s
// - End card (7–8s): silence

// SFX:
// - Sync to every camera movement and cut
// - Product interactions: crisp, tactile, satisfying
// - Transitions: sonic punctuation on every cut
// - Ambient bed beneath music throughout Acts 1–3

// AUDIO MIX:
// - Master: –3dB to –6dB, no clipping
// - Music ducked –6dB under dialogue
// - End card: complete silence, clean cut

// ═══════════════════════════════════════
// MOTION RULES
// ═══════════════════════════════════════

// - One camera movement per scene
// - Transitions: match cut / smash cut / rack focus — no dissolves
// - Act 1: fast cuts (0.8–1.2s per shot)
// - Act 2: medium pace (1.5–2s per shot)
// - Act 3: single held frame (2s minimum)
// - End card: static black, no movement
// - No motion blur unless intentional whip transition

// ═══════════════════════════════════════
// BRAND SAFETY
// ═══════════════════════════════════════

// - No copyrighted assets, logos, or celebrity likenesses
// - No misleading visuals or fabricated claims
// - No stock footage aesthetic — high-budget original production feel
// - Platform compliant: Instagram Reels, TikTok, YouTube Shorts

// `;
// }

export function buildClaudeVideoPrompt(video, businessContext) {
    // 1. Check if we actually have a logo to provide
    const hasLogo = !!businessContext?.branding_guidelines?.logo_url;

    // 2. Dynamically set the text/logo rules based on whether a logo exists
    const textAndLogoRules = hasLogo 
        ? `═══════════════════════════════════════
REFERENCE ASSET & STRICT NO-TEXT RULE
═══════════════════════════════════════
An image attachment (brand logo) is provided. You may integrate this logo shape visually.
CRITICAL RESTRICTION: Do NOT generate any OTHER text, typography, letters, or numbers anywhere in the video.
- NO floating UI elements containing text.
- NO written checklists, paper documents, or contact info cards (this causes AI gibberish).
- If the scene calls for a list or features, use purely visual abstract icons (e.g., simple checkmarks, glowing shapes) with ZERO text next to them.`
        : `═══════════════════════════════════════
TEXT RULES — STRICT (NO TEXT ALLOWED)
═══════════════════════════════════════
DO NOT include any on-screen text, words, letters, logos, or typography in the visual generation. AI video models warp text. The visual video must be 100% text-free and logo-free.
- NO floating UI elements containing text.
- NO written checklists, paper documents, or contact info cards (this causes AI gibberish).
- Use pure abstract icons or human actions instead of written information.`;

    const template = `[VISUAL]
Generate a single continuous 8-second vertical video (9:16, 1080×1920, 30fps).
Broadcast quality. Ultra-realistic. Commercial production feel.

═══════════════════════════════════════
CRITICAL VEO 3 ARCHITECTURE (STRICT)
═══════════════════════════════════════
NO HARD CUTS. NO TRANSITIONS. NO MONTAGE.
The entire 8 seconds MUST be ONE continuous, seamless camera movement (e.g., a smooth gimbal push-in, a continuous FPV drone sweep).
Never show close-ups of paper documents, computer screens, or UI checklists that would force the AI to hallucinate gibberish text.

═══════════════════════════════════════
PRODUCTION BRIEF
═══════════════════════════════════════
BRAND: {{BRAND_NAME}}
INDUSTRY: {{INDUSTRY}}
OBJECTIVE: {{OBJECTIVE}}
VISUAL HOOK (0-3s): {{HOOK_FIRST_3_SECONDS}}
CTA RESOLUTION (6-8s): {{CTA}}

═══════════════════════════════════════
TIMELINE OF CONTINUOUS MOTION
═══════════════════════════════════════
(Read these not as cuts, but as waypoints in a single fluid camera journey)

{{SCENE_BREAKDOWN}}

═══════════════════════════════════════
AESTHETICS, LIGHTING & COLOR
═══════════════════════════════════════
Lighting: Cinematic, matched to brand emotion.
Brand Colors (Must be visually prominent and strictly adhered to exactly as described):
- Primary Presence (~80%): {{PRIMARY_COLOR}}
- Secondary/Accent (~60%): {{SECONDARY_COLOR}}

${textAndLogoRules}

[AUDIO]
═══════════════════════════════════════
VEO 3 NATIVE AUDIO & VOICEOVER
═══════════════════════════════════════
Generate fully synchronized native audio.

VOICEOVER SCRIPT (Max 20 Words): 
"{{SCRIPT}}"

MUSIC & SFX:
- Music Mood: {{MUSIC_MOOD}}
- SFX: Sync to the continuous camera movement. Tactile, crisp environmental sounds matching the visual journey.
- Mix: Music ducked underneath the authoritative, clear voiceover.
`;

    // Build scene breakdown string (Formatted as waypoints, no text injection)
    // We add a regex replace to automatically strip out dangerous words like "text" or "checklist" from the incoming JSON
    const sceneBreakdown = Array.isArray(video?.scene_breakdown)
        ? video.scene_breakdown.map((scene, i) => {
            let safeVisual = (scene?.visual || scene?.description || "")
                .replace(/text|typography|words|checklist|contact info/gi, "visual icons");
            return `Waypoint ${i + 1} (Continuous flow):\nVisual: ${safeVisual}`;
        }).join("\n\n")
        : (video?.scene_breakdown || "");

    // Replace all placeholders with dynamic data
    const prompt = template
        .replace(/{{BRAND_NAME}}/g,          businessContext?.brand_name || "")
        .replace(/{{INDUSTRY}}/g,            businessContext?.industry || "")
        .replace(/{{OBJECTIVE}}/g,           video?.objective || "")
        .replace(/{{MUSIC_MOOD}}/g,          video?.music_mood || "")
        .replace(/{{HOOK_FIRST_3_SECONDS}}/g, video?.hook_first_3_seconds || "")
        .replace(/{{SCRIPT}}/g,              video?.script || "")
        .replace(/{{CTA}}/g,                 video?.cta || "")
        .replace(/{{SCENE_BREAKDOWN}}/g,     sceneBreakdown)
        .replace(/{{PRIMARY_COLOR}}/g,       businessContext?.branding_guidelines?.brand_colors?.[0] || "Deep Corporate Blue")
        .replace(/{{SECONDARY_COLOR}}/g,     businessContext?.branding_guidelines?.brand_colors?.[1] || "Clean White");

    return prompt;
}

export function buildUniversalVideoPrompt({
  analysis,
  video,
  attachments = {},
  options = {},
}) {
  const {
    duration = 8,
    aspectRatio = "9:16",
    resolution = "1080x1920",
    fps = 30,
    includeLogo = true,
    includeBrandOutro = true,
    includeContact = true,
  } = options;

  const business = analysis?.business_overview || {};
  const target = analysis?.target_market || {};
  const competitors = analysis?.competitor_analysis || {};
  const branding = analysis?.branding_guidelines || {};
  const strategy = analysis?.content_strategy || {};
  const trust = analysis?.trust_and_compliance_positioning || {};
  const contact = analysis?.contact_info || {};

  const colors = branding.brand_colors || [];
  const fonts = branding.fonts || [];

  const emotionalTriggers =
    strategy.emotional_triggers?.join(", ") || "";

  const audience =
    target.primary_customer_segments?.join(", ") || "";

  const trustSignals =
    trust.trust_badges_to_highlight?.join(", ") || "";

  const contentGoals =
    strategy.content_goals?.join(", ") || "";

  const visualStyle =
    branding.visual_style || "";

  const competitivePosition =
    competitors.competitive_positioning_summary || "";

  const sceneFlow = (video.scene_breakdown || [])
    .map((scene, index) => {
      return `
${index + 1}.
${scene.visual}
`;
    })
    .join("\n");

  const contactLines = [];

  if (includeContact) {
    if (contact.website) contactLines.push(contact.website);
    if (contact.phone) contactLines.push(contact.phone);
    if (contact.email) contactLines.push(contact.email);
    if (contact.address) contactLines.push(contact.address);
  }

  const hasLogo =
  includeLogo &&
  attachments?.some(a => a.type === "brand_logo");

  return `
You are an award-winning commercial film director creating a premium brand advertisement.

Create a single cinematic advertisement.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Aspect Ratio:
${aspectRatio}

Resolution:
${resolution}

Frame Rate:
${fps}fps

Style:
Ultra realistic
Premium commercial
Hollywood production quality
Natural human motion
Physically accurate lighting
Realistic materials
Professional color grading

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BRAND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Brand:
${business.brand_name || ""}

Industry:
${business.industries?.join(", ") || ""}

Business:
${business.business_type || ""}

Core Value:
${business.core_value_proposition || ""}

Competitive Position:
${competitivePosition}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TARGET AUDIENCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Primary Audience:
${audience}

Desired Emotional Response:

${emotionalTriggers}

The audience should immediately feel:

• Trust
• Curiosity
• Excitement
• Authenticity
• Confidence

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATIVE OBJECTIVE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Primary Goal:

${video.objective}

Content Goals:

${contentGoals}

Call To Action:

${video.cta}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VISUAL IDENTITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Visual Style:

${visualStyle}

Typography Style:

${fonts.join(", ")}

Maintain strict brand consistency throughout the video.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STORY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Opening Hook

${video.hook_first_3_seconds}

Story Flow

${sceneFlow}

End with a satisfying cinematic resolution that naturally reinforces the brand message.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CAMERA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Use smooth cinematic camera movement.

Natural camera language.

Professional lens selection.

Dynamic composition.

Rich foreground, midground and background depth.

Avoid abrupt cuts unless naturally required.

Avoid artificial looking movement.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LIGHTING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Premium cinematic lighting.

Natural reflections.

Volumetric light where appropriate.

High dynamic range.

Film-quality contrast.

Use the brand color palette naturally throughout the scene.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BRANDING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${
includeLogo
  ? `
A brand logo image is supplied as a reference attachment.

Use the supplied logo exactly as provided.

Do not redesign it.

Integrate it naturally into the final branding sequence.

`
  : ""
}

${
includeBrandOutro
  ? `ENDING

Finish with a premium cinematic brand reveal.

${
  hasLogo
    ? `Use the supplied logo exactly as provided.
Do not redesign, recreate or modify it.`
    : `No logo reference is available.
Display the brand name "${business.brand_name}" using elegant premium typography.`
}

${
  includeBrandOutro && contactLines.length
    ? `Display ONLY the following information exactly as provided:

${contactLines.join("\n")}

Keep the final layout clean, centered and premium.
Hold the ending long enough for comfortable reading.`
    : ""
}
`
  : ""
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TRUST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Visually reinforce:

${trustSignals}

Without making the commercial feel cluttered.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AUDIO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Voiceover:

Use the following script as the basis for the narration:

"${video.script}"

IMPORTANT VOICEOVER RULES:

• The entire voiceover MUST be fully spoken within ${duration} seconds.
• Rewrite, shorten, or simplify the script if necessary so it comfortably fits within ${duration} seconds.
• Target approximately 18–22 spoken words for an ${duration}-second advertisement.
• Never allow the narration to continue after the video ends.
• Match the pacing naturally with the visual scene transitions.
• Keep the narration concise, emotionally engaging, and impactful.
• End the final spoken sentence before the brand outro begins.

Music:

${video.music_mood}

Generate realistic environmental sound effects synchronized with the visuals.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
QUALITY REQUIREMENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The advertisement should resemble a global premium commercial produced for brands such as Apple, Nike, Mercedes-Benz, Google, or Netflix.

Prioritize:

• realism
• emotional storytelling
• premium cinematography
• believable acting
• natural motion
• luxury production quality
• strong brand recall

Avoid:

• AI artifacts
• distorted faces
• malformed hands
• unreadable typography
• low quality lighting
• unrealistic physics
• cheap stock footage appearance
• excessive visual clutter
`;
}

// export function buildClaudeVideoPrompt(video, businessContext) {
//     const template = `
// Generate a single continuous 8-second vertical video (9:16, 1080×1920, 30fps).
// Broadcast quality. Ultra-realistic. Commercial production feel.
 
// ═══════════════════════════════════════
// PRODUCTION BRIEF
// ═══════════════════════════════════════
 
// BRAND: {{BRAND_NAME}}
// INDUSTRY: {{INDUSTRY}}
// OBJECTIVE: {{OBJECTIVE}}
// MUSIC MOOD: {{MUSIC_MOOD}}
 
 
// ═══════════════════════════════════════
// 3-ACT STRUCTURE — FULL 8 SECONDS (NO OUTRO)
// ═══════════════════════════════════════
 
// ACT 1 — HOOK (0–3s)
// {{HOOK_FIRST_3_SECONDS}}
// Fast-paced. One dominant subject. Scroll-stopping opening frame.
// Cut timing: 0.8–1.2s per shot.
 
// ACT 2 — VALUE (3–6s)
// {{SCRIPT}}
// Moderate pace. Visual proof — show don't tell.
// Product or solution as hero.
// Cut timing: 1.5–2s per shot.
 
// ACT 3 — CONCLUSION & CTA (6–8s)
// {{CTA}}
// Peak visual energy. Full 2-second hold or high-impact movement.
// Subject faces camera or product dominates frame.
// NO hard cut to black. The scene fills the entire 8-second duration.
// Logical narrative end.

// THE COMPLETE NARRATIVE MUST COMPLETE WITHIN 8 SECONDS. NO INCOMPLETE END OF VIDEO 
 
// ═══════════════════════════════════════
// SCENE BREAKDOWN
// ═══════════════════════════════════════
 
// {{SCENE_BREAKDOWN}}
 
// Each scene must specify:
// - Shot type: ECU / CU / MCU / MS / FS / WS
// - Angle: eye-level / low-angle / high-angle / POV / bird's eye
// - One camera movement: dolly / pan / tilt / tracking / arc / static
// - Lens: 24–35mm (immersive) / 50mm (natural) / 85mm+ (compressed)
// - Depth of field: shallow (premium) / deep (editorial) / rack focus (transition)
 
// ═══════════════════════════════════════
// LIGHTING
// ═══════════════════════════════════════
 
// Match to brand emotion:
// - Golden hour: aspirational, D2C, lifestyle
// - Rembrandt: dramatic, premium, confident
// - Backlit: luxury, silhouette, editorial
// - Soft diffused: friendly, healthcare, food
// - Neon/volumetric: modern, tech, energy
 
// Consistent light direction across all scenes.
// No flat ambient. No mixed colour temperatures between scenes.
// End card (7–8s): pure black only. Zero lighting elements.
 
// ═══════════════════════════════════════
// COLOR
// ═══════════════════════════════════════
 
// Brand primary: {{PRIMARY_COLOR}}
// Brand secondary: {{SECONDARY_COLOR}}
 
// Apply across: wardrobe, environment, props, surfaces, lighting accents.
// Both colors must appear in at least 2 natural elements per scene.
// Grade: +10–15% saturation, crushed blacks, broadcast-safe.
// Consistent grade across Acts 1–3.
// End card: ungraded pure black. No color elements.
 
// ═══════════════════════════════════════
// TEXT RULES — STRICT
// ═══════════════════════════════════════
 
// Maximum 2 text elements across the entire video.
// Text appears ONLY in high-contrast zones — never over busy backgrounds.
 
// Allowed text zones:
// - Over solid-color backgrounds only
// - Over heavily blurred bokeh backgrounds
// - Over the pure black end card
 
// Text must be:
// - Bold sans-serif, large, centered
// - White on dark backgrounds only
// - Clean, undistorted, professionally typeset
// - No decorative fonts, no script, no stylized letterforms
// - Minimum 15% of frame height in font size
// - Surrounded by negative space — never touching frame edges
// - NO LOGO SHOULD BE ADDED AT ALL IN THE VIDEO.
  
 
// ═══════════════════════════════════════
// AUDIO — VEO 3.1 NATIVE
// ═══════════════════════════════════════
 
// Generate fully synchronized native audio.
 
// MUSIC:
// - Mood: {{MUSIC_MOOD}}
// - Act 1: energetic, driving — matches cut pace
// - Act 2: builds, melodic, product-aligned
// - Act 3: crescendo peak at 6.5s, resolves at 7s
// - End card (7–8s): silence
 
// SFX:
// - Sync to every camera movement and cut
// - Product interactions: crisp, tactile, satisfying
// - Transitions: sonic punctuation on every cut
// - Ambient bed beneath music throughout Acts 1–3
 
// AUDIO MIX:
// - Master: –3dB to –6dB, no clipping
// - Music ducked –6dB under dialogue
// - End card: complete silence, clean cut
 
// ═══════════════════════════════════════
// MOTION RULES
// ═══════════════════════════════════════
 
// - One camera movement per scene
// - Transitions: match cut / smash cut / rack focus — no dissolves
// - Act 1: fast cuts (0.8–1.2s per shot)
// - Act 2: medium pace (1.5–2s per shot)
// - Act 3: single held frame (2s minimum)
// - End card: static black, no movement
// - No motion blur unless intentional whip transition
 
// ═══════════════════════════════════════
// BRAND SAFETY
// ═══════════════════════════════════════
 
// - No copyrighted assets, logos, or celebrity likenesses
// - No misleading visuals or fabricated claims
// - No stock footage aesthetic — high-budget original production feel
// - Platform compliant: Instagram Reels, TikTok, YouTube Shorts
 
// `;

//     // Build scene breakdown string
//     const sceneBreakdown = Array.isArray(video?.scene_breakdown)
//         ? video.scene_breakdown.map((scene, i) => `
// Scene ${i + 1}:
// Visual: ${scene?.visual || scene?.description || ""}
// On Screen Text: ${scene?.on_screen_text || ""}
// `).join("\n")
//         : (video?.scene_breakdown || "");

//     // Replace all placeholders with dynamic data
//     return template
//         .replace(/{{BRAND_NAME}}/g, businessContext?.brand_name || "")
//         .replace(/{{INDUSTRY}}/g, businessContext?.industry || "")
//         .replace(/{{OBJECTIVE}}/g, video?.objective || "")
//         .replace(/{{MUSIC_MOOD}}/g, video?.music_mood || "")
//         .replace(/{{HOOK_FIRST_3_SECONDS}}/g, video?.hook_first_3_seconds || "")
//         .replace(/{{SCRIPT}}/g, video?.script || "")
//         .replace(/{{CTA}}/g, video?.cta || "")
//         .replace(/{{LOGO_URL}}/g, businessContext?.branding_guidelines?.logo_url || "")
//         .replace(/{{WEBSITE_URL}}/g, businessContext?.branding_guidelines?.website_url || "")
//         .replace(/{{SCENE_BREAKDOWN}}/g, sceneBreakdown)
//         .replace(/{{PRIMARY_COLOR}}/g, businessContext?.brand_colors?.primary || "#000000")
//         .replace(/{{SECONDARY_COLOR}}/g, businessContext?.brand_colors?.secondary || "#ffffff");
// }
