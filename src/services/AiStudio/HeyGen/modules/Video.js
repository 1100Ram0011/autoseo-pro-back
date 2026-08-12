/**
 * HeyGen Video Module
 * Supports HeyGen API v3 (`POST /v3/videos`) & API v2 (`POST /v2/video/generate`)
 * Documentation:
 * - https://developers.heygen.com/reference/create-video (v3 primary specification)
 * - https://developers.heygen.com/photo-avatar
 * - https://developers.heygen.com/image-to-video
 */

import BaseModule from "../core/BaseModule.js";
import { API_ENDPOINTS, VIDEO_STATUS } from "../constants.js";
import VideoHelper from "../helpers/VideoHelper.js";
import Poller from "../core/Polling.js";

export class VideoModule extends BaseModule {
  /**
   * Primary video generation method with v3 top-level specification & v2 fallback
   * @param {Object} options
   */
  async generate(options = {}) {
    const tryPost = async (url, payload) => {
      const result = await this.http.post(url, payload);
      const videoId = result?.video_id || result?.id || result?.data?.video_id || result;
      this.emit("video.generated", { videoId, payload });
      return result;
    };

    // Extract core arguments from root options object OR nested videoInputs / video_inputs
    const inputsArr = options.videoInputs || options.video_inputs || [];
    const firstInput = inputsArr[0] || {};

    const avatarId =
      options.avatarId ||
      options.avatar_id ||
      firstInput.character?.avatar_id ||
      firstInput.character?.talking_photo_id ||
      firstInput.avatarId ||
      firstInput.avatar_id;

    const voiceId =
      options.voiceId ||
      options.voice_id ||
      firstInput.voice?.voice_id ||
      firstInput.voiceId ||
      firstInput.voice_id;

    const script =
      options.script ||
      options.text ||
      options.customScript ||
      firstInput.voice?.input_text ||
      firstInput.voice?.text ||
      firstInput.text ||
      firstInput.input_text ||
      "";

    const title = options.title || `Video_${Date.now()}`;
    const engineType = typeof options.engine === "string" ? options.engine : options.engine?.type || "avatar_iv";
    const motionPrompt = options.motionPrompt || options.motion_prompt;
    const expressiveness = options.expressiveness || "high";
    const aspectRatio = options.aspectRatio || options.aspect_ratio || "16:9";

    let lastError = null;

    // --- STRATEGY 1: HeyGen v3 Primary (`POST /v3/videos`) ---
    // Official v3 type tags: 'avatar', 'image', 'cinematic_avatar', 'studio'
    const v3Types = ["avatar", "image"];
    for (const typeTag of v3Types) {
      try {
        const v3Payload = VideoHelper.buildVideoPayloadV3({
          ...options,
          avatarId,
          voiceId,
          script,
          title,
          type: typeTag,
          engine: engineType,
          aspectRatio,
        });

        // Ensure mandatory v3 top-level fields are populated
        v3Payload.avatar_id = avatarId;
        v3Payload.voice_id = voiceId;
        v3Payload.script = script;

        return await tryPost(API_ENDPOINTS.GENERATE_VIDEO, v3Payload);
      } catch (err) {
        lastError = err;
        console.warn(`HeyGen v3 video attempt failed [Type: ${typeTag}]:`, err.message || err);
      }
    }

    // --- STRATEGY 2: HeyGen v2 Fallback (`POST /v2/video/generate`) ---
    const v2Types = ["avatar", "talking_photo"];
    for (const typeTag of v2Types) {
      try {
        const v2Payload = VideoHelper.buildVideoPayloadV2({
          ...options,
          avatarId,
          voiceId,
          text: script,
          title,
          type: typeTag,
          aspectRatio,
        });
        return await tryPost(API_ENDPOINTS.GENERATE_VIDEO_V2, v2Payload);
      } catch (err) {
        lastError = err;
        console.warn(`HeyGen v2 video attempt failed [Type: ${typeTag}]:`, err.message || err);
      }
    }

    console.error("All HeyGen video generation endpoints & variants failed. Last Error:", lastError);
    throw lastError;
  }

  /**
   * Alias method for generate
   */
  async generateVideo(options = {}) {
    return this.generate(options);
  }

  /**
   * Alias method for generate
   */
  async create(options = {}) {
    return this.generate(options);
  }

  /**
   * Image to Video generation method
   * Documentation: https://developers.heygen.com/image-to-video
   */
  async generateImageToVideo(options = {}) {
    const payload = {
      image_url: options.imageUrl || options.image_url,
      prompt: options.prompt || "natural motion and expression",
      aspect_ratio: options.aspectRatio || options.aspect_ratio || "16:9",
      dimension: options.dimension || null,
    };
    try {
      const result = await this.http.post("/v3/videos/image-to-video", payload);
      return result;
    } catch (err) {
      return this.generate(options);
    }
  }

  /**
   * Check video status by ID
   * @param {string} videoId
   */
  async getStatus(videoId) {
    try {
      return await this.http.get(`${API_ENDPOINTS.VIDEO_STATUS}/${videoId}`);
    } catch (err) {
      return await this.http.get(API_ENDPOINTS.VIDEO_STATUS_V1, { video_id: videoId });
    }
  }

  /**
   * List generated videos
   * @param {Object} params
   */
  async list(params = {}) {
    return this.http.get(API_ENDPOINTS.LIST_VIDEOS, params);
  }

  /**
   * Delete video by ID
   * @param {string} videoId
   */
  async delete(videoId) {
    const result = await this.http.delete(API_ENDPOINTS.DELETE_VIDEO, { video_id: videoId });
    this.emit("video.deleted", { videoId });
    return result;
  }

  /**
   * Generate video and poll status until complete or failed
   */
  async generateAndPoll(options = {}, pollingOptions = {}) {
    const response = await this.generate(options);
    const videoId = response?.video_id || response?.id || response?.data?.video_id || response;

    return Poller.pollTask(
      () => this.getStatus(videoId),
      (statusRes) => {
        const status = statusRes?.status || statusRes?.video_status;
        if (status === VIDEO_STATUS.COMPLETED) {
          return { done: true, error: false };
        }
        if (status === VIDEO_STATUS.FAILED) {
          return {
            done: true,
            error: true,
            errorMessage: statusRes?.error?.message || statusRes?.error || "Video generation failed",
          };
        }
        return { done: false };
      },
      {
        ...pollingOptions,
        onProgress: (res, attempt) => {
          this.emit("video.polling_progress", { videoId, status: res?.status, attempt });
          if (pollingOptions.onProgress) pollingOptions.onProgress(res, attempt);
        },
      }
    );
  }
}

export default VideoModule;