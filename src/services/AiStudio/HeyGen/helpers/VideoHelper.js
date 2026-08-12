/**
 * HeyGen Video Helper Utility
 * Supports HeyGen API v3 (`POST /v3/videos`) & API v2 (`POST /v2/video/generate`)
 * Documentation:
 * - https://developers.heygen.com/reference/create-video (v3 primary specification)
 * - https://developers.heygen.com/photo-avatar
 * - https://developers.heygen.com/image-to-video
 */

import { ASPECT_RATIOS, DIMENSIONS } from "../constants.js";

const VALID_EMOTIONS = {
  friendly: "Friendly",
  excited: "Excited",
  serious: "Serious",
  soothing: "Soothing",
  broadcaster: "Broadcaster",
  angry: "Angry",
};

export const DEFAULT_MOTION_PROMPT = `gesturing naturally while speaking`;

export const DEFAULT_ENGINE = { type: "avatar_iv" };

export class VideoHelper {
  /**
   * Build HeyGen v3 Video Generation Payload (`POST /v3/videos`)
   * Top-level `type` discriminator specification
   */
  static buildVideoPayloadV3(options = {}) {
    const avatarId = options.avatarId || options.avatar_id;
    const voiceId = options.voiceId || options.voice_id;
    const script = options.script || options.text || options.input_text || "";
    const type = options.type || "avatar";

    const payload = {
      type: type,
      avatar_id: avatarId,
      title: options.title || `Video_${Date.now()}`,
      aspect_ratio: options.aspectRatio || options.aspect_ratio || ASPECT_RATIOS.LANDSCAPE,
      script: script,
      voice_id: voiceId,
      output_format: options.output_format || "mp4",
    };

    const engineObj = options.engine
      ? (typeof options.engine === "string" ? { type: options.engine } : { ...options.engine })
      : { type: "avatar_iv" };

    if (options.referenceLookId || options.reference_look_id) {
      engineObj.reference_look_id = options.referenceLookId || options.reference_look_id;
    }
    payload.engine = engineObj;

    payload.motion_prompt = options.motionPrompt || options.motion_prompt || DEFAULT_MOTION_PROMPT;
    payload.expressiveness = options.expressiveness || "high";

    if ((options.speed && options.speed !== 1) || (options.pitch && options.pitch !== 0)) {
      payload.voice_settings = {
        speed: options.speed || 1,
        pitch: options.pitch || 0,
        volume: options.volume || 1,
      };
    }

    if (options.callbackId || options.callback_id) {
      payload.callback_id = options.callbackId || options.callback_id;
    }

    if (options.background) {
      payload.background = options.background;
    }

    return payload;
  }

  /**
   * Build HeyGen v2 Video Generation Payload (`POST /v2/video/generate`)
   */
  static buildVideoPayloadV2(options = {}) {
    const avatarId = options.avatarId || options.avatar_id;
    const voiceId = options.voiceId || options.voice_id;
    const text = options.text || options.script || "";
    const type = options.type || "avatar";
    const dimension = options.dimension || DIMENSIONS.LANDSCAPE_1080P;

    let characterObj = {};
    if (type === "talking_photo") {
      characterObj = {
        type: "talking_photo",
        talking_photo_id: avatarId,
      };
    } else {
      characterObj = {
        type: "avatar",
        avatar_id: avatarId,
        avatar_style: options.avatarStyle || "normal",
        talking_style: options.talkingStyle || "expressive",
        super_resolution: options.superResolution ?? true,
      };
    }

    const rawEmotion = (options.emotion || "Friendly").toString().toLowerCase();
    const normalizedEmotion = VALID_EMOTIONS[rawEmotion] || "Friendly";

    return {
      title: options.title || `Video_${Date.now()}`,
      caption: options.caption ?? false,
      dimension: {
        width: dimension.width,
        height: dimension.height,
      },
      aspect_ratio: options.aspectRatio || options.aspect_ratio || ASPECT_RATIOS.LANDSCAPE,
      video_inputs: [
        {
          character: characterObj,
          voice: {
            type: "text",
            voice_id: voiceId,
            input_text: text,
            emotion: normalizedEmotion,
          },
        },
      ],
      test: options.test ?? false,
    };
  }

  /**
   * Primary Helper: extracts avatarId, voiceId, and script from root options or nested videoInputs
   */
  static buildVideoPayload(options = {}) {
    let avatarId = options.avatarId || options.avatar_id;
    let voiceId = options.voiceId || options.voice_id;
    let script = options.script || options.text || options.customScript;

    const inputsArr = options.videoInputs || options.video_inputs || [];
    if (inputsArr.length > 0) {
      const input = inputsArr[0];
      avatarId = avatarId || input.character?.avatar_id || input.character?.talking_photo_id || input.avatarId || input.avatar_id;
      voiceId = voiceId || input.voice?.voice_id || input.voiceId || input.voice_id;
      script = script || input.voice?.input_text || input.voice?.text || input.text || input.input_text;
    }

    return this.buildVideoPayloadV3({
      ...options,
      avatarId,
      voiceId,
      script,
    });
  }

  /**
   * Helper to build video input element for v2 format
   */
  static buildVideoInput(options = {}) {
    const avatarId = options.avatarId || options.avatar_id;
    const voiceId = options.voiceId || options.voice_id;
    const text = options.text || options.script || options.input_text || "";
    const type = options.type || "avatar";

    let characterObj = {};
    if (type === "talking_photo") {
      characterObj = {
        type: "talking_photo",
        talking_photo_id: avatarId,
      };
    } else {
      characterObj = {
        type: "avatar",
        avatar_id: avatarId,
        avatar_style: options.avatarStyle || "normal",
        talking_style: options.talkingStyle || "expressive",
        super_resolution: options.superResolution ?? true,
      };
    }

    const rawEmotion = (options.emotion || "Friendly").toString().toLowerCase();
    const normalizedEmotion = VALID_EMOTIONS[rawEmotion] || "Friendly";

    return {
      character: characterObj,
      voice: {
        type: "text",
        voice_id: voiceId,
        input_text: text,
        emotion: normalizedEmotion,
      },
    };
  }
}

export default VideoHelper;