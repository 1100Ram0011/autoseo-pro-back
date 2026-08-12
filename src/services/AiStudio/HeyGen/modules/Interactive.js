/**
 * HeyGen Interactive Avatar Agent Module
 */

import BaseModule from "../core/BaseModule.js";
import { API_ENDPOINTS } from "../constants.js";

export class InteractiveModule extends BaseModule {
  async createAgentSession(options = {}) {
    const payload = {
      agent_id: options.agentId,
      avatar_id: options.avatarId,
      voice_id: options.voiceId,
      knowledge_base: options.knowledgeBase || null,
    };

    const result = await this.http.post(API_ENDPOINTS.AGENT_CREATE_SESSION, payload);
    this.emit("interactive.session_created", result);
    return result;
  }

  async sendMessage(sessionId, message) {
    const payload = {
      session_id: sessionId,
      message,
    };
    return this.http.post(API_ENDPOINTS.AGENT_SEND_MESSAGE, payload);
  }

  async stopSession(sessionId) {
    const result = await this.http.post(API_ENDPOINTS.AGENT_STOP_SESSION, { session_id: sessionId });
    this.emit("interactive.session_stopped", { sessionId });
    return result;
  }
}

export default InteractiveModule;
