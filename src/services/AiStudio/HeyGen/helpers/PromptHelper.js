/**
 * HeyGen Cinematic Avatar Prompt Helper Utility
 */

export class PromptHelper {
  static formatCinematicPrompt({
    prompt,
    looks = [],
    referenceImages = [],
    referenceVideos = [],
    cameraMovement = null,
    lightingStyle = null,
  }) {
    let structuredPrompt = prompt;

    if (cameraMovement) {
      structuredPrompt += ` [Camera: ${cameraMovement}]`;
    }

    if (lightingStyle) {
      structuredPrompt += ` [Lighting: ${lightingStyle}]`;
    }

    return {
      prompt: structuredPrompt,
      avatar_looks: looks.slice(0, 3), // Max 3 avatar looks supported
      reference_images: referenceImages,
      reference_videos: referenceVideos,
    };
  }

  static buildStylePresetPrompt(basePrompt, presetName) {
    const presets = {
      cinematic: "Cinematic, photorealistic lighting, 8k resolution, film grain, dramatic atmosphere",
      anime: "Anime style, cell shaded, vibrant colors, expressive design",
      cyberpunk: "Neon lights, futuristic city background, cyberpunk aesthetic, high contrast",
      documentary: "Natural lighting, documentary camera feel, professional studio setup",
    };

    const suffix = presets[presetName.toLowerCase()] || "";
    return suffix ? `${basePrompt}. Style: ${suffix}` : basePrompt;
  }
}

export default PromptHelper;
