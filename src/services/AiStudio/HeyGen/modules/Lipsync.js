/**
 * HeyGen Lipsync Module
 * Reference: https://developers.heygen.com/lipsync-speed
 */

import BaseModule from "../core/BaseModule.js";
import { API_ENDPOINTS } from "../constants.js";
import Poller from "../core/Polling.js";
import { HeyGenValidationError } from "../errors.js";

export class LipsyncModule extends BaseModule {
  /**
   * Format video or audio input for HeyGen Lipsync API
   * Accepts: URL string, asset_id string, or object format ({ type: "url", url: "..." } or { type: "asset_id", asset_id: "..." })
   */
  _formatInput(input, paramName) {
    if (!input) {
      throw new HeyGenValidationError(`Lipsync requires a valid '${paramName}' input.`);
    }

    if (typeof input === "string") {
      const trimmed = input.trim();
      if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        return { type: "url", url: trimmed };
      }
      return { type: "asset_id", asset_id: trimmed };
    }

    if (typeof input === "object" && input !== null) {
      if (input.type && (input.url || input.asset_id)) {
        return input;
      }
      if (input.url) {
        return { type: "url", url: input.url };
      }
      if (input.asset_id || input.id) {
        return { type: "asset_id", asset_id: input.asset_id || input.id };
      }
    }

    throw new HeyGenValidationError(`Invalid format for '${paramName}'. Provide a URL string, asset_id string, or object.`);
  }

  /**
   * Create a Lipsync job (POST /v3/lipsyncs)
   * Mode defaults to "speed" per https://developers.heygen.com/lipsync-speed
   */
  async createLipsync(options = {}) {
    const {
      video,
      audio,
      mode = "speed",
      title,
      enable_caption,
      enable_dynamic_duration,
      disable_music_track,
      enable_speech_enhancement,
      enable_watermark,
      start_time,
      end_time,
      keep_the_same_format,
      fps_mode,
      callback_url,
      callback_id,
      folder_id,
    } = options;

    const formattedVideo = this._formatInput(video, "video");
    const formattedAudio = this._formatInput(audio, "audio");

    const payload = {
      video: formattedVideo,
      audio: formattedAudio,
      mode,
    };

    if (title !== undefined) payload.title = title;
    if (enable_caption !== undefined) payload.enable_caption = enable_caption;
    if (enable_dynamic_duration !== undefined) payload.enable_dynamic_duration = enable_dynamic_duration;
    if (disable_music_track !== undefined) payload.disable_music_track = disable_music_track;
    if (enable_speech_enhancement !== undefined) payload.enable_speech_enhancement = enable_speech_enhancement;
    if (enable_watermark !== undefined) payload.enable_watermark = enable_watermark;
    if (start_time !== undefined) payload.start_time = start_time;
    if (end_time !== undefined) payload.end_time = end_time;
    if (keep_the_same_format !== undefined) payload.keep_the_same_format = keep_the_same_format;
    if (fps_mode !== undefined) payload.fps_mode = fps_mode;
    if (callback_url !== undefined) payload.callback_url = callback_url;
    if (callback_id !== undefined) payload.callback_id = callback_id;
    if (folder_id !== undefined) payload.folder_id = folder_id;

    const result = await this.http.post(API_ENDPOINTS.CREATE_LIPSYNC, payload);
    this.emit("lipsync.created", result);
    return result;
  }

  /**
   * Get Lipsync Details (GET /v3/lipsyncs/{lipsync_id})
   */
  async getLipsync(lipsyncId) {
    if (!lipsyncId) {
      throw new HeyGenValidationError("lipsyncId is required.");
    }
    return this.http.get(`${API_ENDPOINTS.GET_LIPSYNC}/${lipsyncId}`);
  }

  /**
   * List Lipsyncs (GET /v3/lipsyncs)
   */
  async listLipsyncs(params = {}) {
    return this.http.get(API_ENDPOINTS.LIST_LIPSYNCS, params);
  }

  /**
   * Update Lipsync Title (PATCH /v3/lipsyncs/{lipsync_id})
   */
  async updateLipsync(lipsyncId, { title }) {
    if (!lipsyncId) {
      throw new HeyGenValidationError("lipsyncId is required.");
    }
    if (!title) {
      throw new HeyGenValidationError("title is required to update lipsync.");
    }
    return this.http.patch(`${API_ENDPOINTS.UPDATE_LIPSYNC}/${lipsyncId}`, { title });
  }

  /**
   * Delete Lipsync (DELETE /v3/lipsyncs/{lipsync_id})
   */
  async deleteLipsync(lipsyncId) {
    if (!lipsyncId) {
      throw new HeyGenValidationError("lipsyncId is required.");
    }
    return this.http.delete(`${API_ENDPOINTS.DELETE_LIPSYNC}/${lipsyncId}`);
  }

  /**
   * Create lipsync job and poll until status is completed or failed
   */
  async createAndPollLipsync(options = {}, pollingOptions = {}) {
    const res = await this.createLipsync(options);
    const lipsyncId = res?.lipsync_id || res?.data?.lipsync_id || res?.id || res;

    if (!lipsyncId) {
      throw new HeyGenValidationError("Could not extract lipsync_id from response.", res);
    }

    return Poller.pollTask(
      () => this.getLipsync(lipsyncId),
      (statusRes) => {
        const status = (statusRes?.status || statusRes?.data?.status || "").toLowerCase();
        if (status === "completed") {
          return { done: true, error: false };
        }
        if (status === "failed") {
          const failureMsg = statusRes?.failure_message || statusRes?.data?.failure_message || "Lipsync job failed";
          return { done: true, error: true, errorMessage: failureMsg };
        }
        return { done: false };
      },
      pollingOptions
    );
  }
}

export default LipsyncModule;
