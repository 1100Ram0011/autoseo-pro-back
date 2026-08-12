/**
 * HeyGen Video Agent Module
 * Documentation: https://developers.heygen.com/docs/video-agent
 */

import BaseModule from "../core/BaseModule.js";
import { API_ENDPOINTS } from "../constants.js";
import Poller from "../core/Polling.js";

export class AgentModule extends BaseModule {
  /**
   * Create Video Agent Generation Task (POST /v3/video-agents)
   * Documentation: https://developers.heygen.com/docs/video-agent
   *
   * @param {Object} options - { prompt, orientation, avatarId, avatar_id, voiceId, voice_id, files, imageUrls, image_urls }
   */
  async createVideoAgent(options = {}) {
    const prompt = options.prompt || options.text || "";
    const orientation = options.orientation || options.aspectRatio || options.aspect_ratio || "landscape";
    const avatarId = options.avatarId || options.avatar_id || options.avatar;
    const voiceId = options.voiceId || options.voice_id || options.voice;

    let files = [];
    if (Array.isArray(options.files)) {
      files = options.files.map((f) => (typeof f === "string" ? { type: "url", url: f } : f));
    } else if (options.imageUrls || options.image_urls || options.images || options.imageUrl || options.image_url) {
      const rawUrls = options.imageUrls || options.image_urls || options.images || options.imageUrl || options.image_url;
      const urlsArr = Array.isArray(rawUrls) ? rawUrls : [rawUrls];
      files = urlsArr.filter(Boolean).map((url) => ({ type: "url", url }));
    }

    const payload = {
      prompt,
      orientation,
    };

    if (avatarId) payload.avatar_id = avatarId;
    if (voiceId) payload.voice_id = voiceId;
    if (files.length > 0) payload.files = files;

    const endpoint = API_ENDPOINTS.CREATE_VIDEO_AGENT || "/v3/video-agents";
    const result = await this.http.post(endpoint, payload);
    this.emit("agent.video_created", result);
    return result;
  }

  /**
   * Alias for createVideoAgent
   */
  async generateVideoAgentTask(options = {}) {
    return this.createVideoAgent(options);
  }

  /**
   * Check status of video agent session
   * @param {string} sessionId 
   */
  async getStatus(sessionId) {
    return this.http.get(`${API_ENDPOINTS.CREATE_VIDEO_AGENT || "/v3/video-agents"}/${sessionId}`);
  }

  /**
   * Phase 1: Poll Video Agent Session (GET /v3/video-agents/{session_id}) until video_id is assigned
   * @param {string} sessionId 
   * @param {Object} [pollingOptions] 
   */
  async pollSession(sessionId, pollingOptions = {}) {
    return Poller.pollTask(
      async () => {
        return await this.getStatus(sessionId);
      },
      (res) => {
        const videoId = res?.video_id || res?.data?.video_id;
        const status = (res?.status || res?.data?.status || "").toString().toLowerCase();

        if (videoId) {
          return { done: true, error: false };
        }
        if (status === "failed" || status === "error") {
          return {
            done: true,
            error: true,
            errorMessage: res?.error?.message || res?.error || "Video Agent session failed",
          };
        }
        return { done: false };
      },
      {
        intervalMs: 15000, // 15 seconds polling interval per HeyGen docs recommendation
        timeoutMs: 600000,  // 10 minutes session timeout
        maxAttempts: 40,
        ...pollingOptions,
      }
    );
  }

  /**
   * Phase 2: Poll Video Render Status (GET /v3/videos/{video_id}) for final status and video_url
   * @param {string} videoId 
   * @param {Object} [pollingOptions] 
   */
  async pollVideo(videoId, pollingOptions = {}) {
    return Poller.pollTask(
      async () => {
        return await this.http.get(`${API_ENDPOINTS.VIDEO_STATUS || "/v3/videos"}/${videoId}`);
      },
      (res) => {
        const data = res?.data || res;
        const status = (
          data?.status ||
          data?.video_status ||
          res?.status ||
          res?.video_status ||
          ""
        ).toString().toLowerCase();

        const videoUrl =
          data?.video_url ||
          data?.download_url ||
          data?.url ||
          res?.video_url ||
          res?.download_url ||
          res?.url ||
          "";

        if (status === "completed" || status === "success" || videoUrl) {
          return { done: true, error: false };
        }
        if (status === "failed" || status === "error") {
          return {
            done: true,
            error: true,
            errorMessage: data?.error?.message || data?.error || res?.error?.message || res?.error || res?.message || "Video rendering failed",
          };
        }
        return { done: false };
      },
      {
        intervalMs: 15000, // 15 seconds polling interval per HeyGen docs recommendation
        timeoutMs: 900000,  // 15 minutes video render timeout
        maxAttempts: 60,
        ...pollingOptions,
      }
    );
  }

  /**
   * Two-phase Polling Workflow:
   * 1. GET /v3/video-agents/{session_id} -> retrieve assigned video_id
   * 2. GET /v3/videos/{video_id} -> retrieve final render status & video_url
   *
   * @param {Object} initialResult - Result returned by POST /v3/video-agents
   * @param {Object} [pollingOptions]
   */
  async pollVideoAgentWorkflow(initialResult, pollingOptions = {}) {
    const sessionId = initialResult?.session_id || initialResult?.data?.session_id || initialResult?.id;
    let videoId = initialResult?.video_id || initialResult?.data?.video_id;

    let sessionResult = initialResult;

    // Phase 1: Poll Session (GET /v3/video-agents/{session_id}) to get assigned video_id if not present
    if (!videoId && sessionId) {
      console.log(`[Phase 1] Polling session (GET /v3/video-agents/${sessionId}) for video_id (interval: 15s)...`);
      sessionResult = await this.pollSession(sessionId, pollingOptions);
      videoId = sessionResult?.video_id || sessionResult?.data?.video_id || videoId;
      console.log(`[Phase 1] Session poll completed. Assigned video_id: "${videoId}"`);
    }

    if (!videoId) {
      throw new Error("Could not obtain video_id from Video Agent session response.");
    }

    // Phase 2: Poll Video Render Status (GET /v3/videos/{video_id}) for final video_url
    console.log(`[Phase 2] Polling video status (GET /v3/videos/${videoId}) for final video_url (interval: 15s)...`);
    const videoResult = await this.pollVideo(videoId, pollingOptions);
    const videoData = videoResult?.data || videoResult;
    const finalVideoUrl =
      videoData?.video_url ||
      videoData?.download_url ||
      videoData?.url ||
      videoResult?.video_url ||
      videoResult?.download_url ||
      videoResult?.url ||
      "";

    console.log(`[Phase 2] Video render poll completed (GET /v3/videos/${videoId}). Final video_url: "${finalVideoUrl}"`);

    return {
      session: sessionResult,
      video: videoResult,
      video_id: videoId,
      video_url: finalVideoUrl,
    };
  }

  async generateAndPoll(options = {}, pollingOptions = {}) {
    const res = await this.createVideoAgent(options);
    return this.pollVideoAgentWorkflow(res, pollingOptions);
  }
}

export default AgentModule;
