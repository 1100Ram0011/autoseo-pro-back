/**
 * HeyGen Cinematic Avatar Module
 * Documentation: https://developers.heygen.com/cinematic-avatar
 */

import BaseModule from "../core/BaseModule.js";
import { API_ENDPOINTS, VIDEO_STATUS } from "../constants.js";
import PromptHelper from "../helpers/PromptHelper.js";
import Poller from "../core/Polling.js";

export class CinematicModule extends BaseModule {
  /**
   * Generate cinematic avatar video from a single prompt with reference images/videos and looks
   * @param {Object} options
   * @param {string} options.prompt - Text prompt describing the video scene
   * @param {Array<string>} [options.looks] - Up to 3 avatar looks
   * @param {Array<string>} [options.referenceImages] - Reference image URLs
   * @param {Array<string>} [options.referenceVideos] - Reference video URLs
   * @param {string} [options.aspectRatio] - Video aspect ratio (16:9, 9:16, 1:1)
   * @param {string} [options.callbackId] - Custom webhook callback ID
   */
  async generate(options = {}) {
    const formattedPrompt = PromptHelper.formatCinematicPrompt(options);

    const payload = {
      prompt: formattedPrompt.prompt,
      avatar_looks: formattedPrompt.avatar_looks,
      reference_images: formattedPrompt.reference_images,
      reference_videos: formattedPrompt.reference_videos,
      aspect_ratio: options.aspectRatio || "16:9",
      callback_id: options.callbackId || null,
      dimension: options.dimension || null,
    };

    const result = await this.http.post(API_ENDPOINTS.GENERATE_CINEMATIC, payload);
    const videoId = result?.video_id || result?.id || result;
    this.emit("cinematic.generated", { videoId, payload });
    return result;
  }

  /**
   * Check cinematic avatar video generation status
   * @param {string} videoId
   */
  async getStatus(videoId) {
    return this.http.get(API_ENDPOINTS.CINEMATIC_STATUS, { video_id: videoId });
  }

  /**
   * Generate cinematic avatar video and poll until completion
   */
  async generateAndPoll(options = {}, pollingOptions = {}) {
    const res = await this.generate(options);
    const videoId = res?.video_id || res?.id || res;

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
            errorMessage: statusRes?.error?.message || statusRes?.error || "Cinematic video generation failed",
          };
        }
        return { done: false };
      },
      {
        ...pollingOptions,
        onProgress: (res, attempt) => {
          this.emit("cinematic.polling_progress", { videoId, status: res?.status, attempt });
          if (pollingOptions.onProgress) pollingOptions.onProgress(res, attempt);
        },
      }
    );
  }
}

export default CinematicModule;
