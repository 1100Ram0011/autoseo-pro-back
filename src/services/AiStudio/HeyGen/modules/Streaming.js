/**
 * HeyGen Live Streaming Avatar Module
 */

import BaseModule from "../core/BaseModule.js";
import { API_ENDPOINTS } from "../constants.js";

export class StreamingModule extends BaseModule {
  async createSession(options = {}) {
    const payload = {
      quality: options.quality || "medium",
      avatar_name: options.avatarName || options.avatarId,
      voice: options.voice || null,
      version: options.version || "v2",
    };

    const result = await this.http.post(API_ENDPOINTS.STREAMING_CREATE_SESSION, payload);
    this.emit("streaming.session_created", result);
    return result;
  }

  async startSession(sessionId) {
    return this.http.post(API_ENDPOINTS.STREAMING_START_SESSION, { session_id: sessionId });
  }

  async sendSdpOffer(sessionId, sdp) {
    return this.http.post(API_ENDPOINTS.STREAMING_SEND_SDP, { session_id: sessionId, sdp });
  }

  async sendIceCandidate(sessionId, candidate) {
    return this.http.post(API_ENDPOINTS.STREAMING_SEND_ICE, { session_id: sessionId, candidate });
  }

  async sendTask(sessionId, text, taskType = "repeat") {
    const payload = {
      session_id: sessionId,
      text,
      task_type: taskType,
    };
    return this.http.post(API_ENDPOINTS.STREAMING_SEND_TASK, payload);
  }

  async stopSession(sessionId) {
    const result = await this.http.post(API_ENDPOINTS.STREAMING_STOP_SESSION, { session_id: sessionId });
    this.emit("streaming.session_stopped", { sessionId });
    return result;
  }
}

export default StreamingModule;
