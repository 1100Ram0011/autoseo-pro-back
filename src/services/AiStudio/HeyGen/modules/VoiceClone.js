/**
 * HeyGen Voice Clone Module
 */

import BaseModule from "../core/BaseModule.js";
import { API_ENDPOINTS } from "../constants.js";
import Poller from "../core/Polling.js";
import VoiceHelper from "../helpers/VoiceHelper.js";

export class VoiceCloneModule extends BaseModule {
  async createInstantClone({ name, audioUrl, audioBuffer }) {
    let finalAudioUrl = audioUrl;

    if (!finalAudioUrl && audioBuffer) {
      const uploadRes = await this.client.assets.upload(audioBuffer, {
        filename: `${name}_voice.mp3`,
        contentType: "audio/mp3",
        assetType: "audio",
      });
      finalAudioUrl = uploadRes?.url || uploadRes?.asset_url;
    }

    const payloadV3 = VoiceHelper.formatVoiceClonePayloadV3({
      name,
      audioUrl: finalAudioUrl,
    });

    try {
      const result = await this.http.post(API_ENDPOINTS.VOICE_CLONE_INSTANT, payloadV3);
      this.emit("voice.clone_requested", result);
      return result;
    } catch (err) {
      console.warn("HeyGen v3 voice clone error:", err.message);
      throw err;
    }
  }

  async getCloneStatus(cloneId) {
    try {
      return await this.http.get(`${API_ENDPOINTS.VOICE_CLONE_STATUS}/${cloneId}`);
    } catch (err) {
      return await this.http.get(API_ENDPOINTS.VOICE_CLONE_STATUS_V2, { clone_id: cloneId });
    }
  }

  async cloneAndPoll(options = {}, pollingOptions = {}) {
    const cloneRes = await this.createInstantClone(options);
    const cloneId = cloneRes?.clone_id || cloneRes?.voice_id;

    return Poller.pollTask(
      () => this.getCloneStatus(cloneId),
      (statusRes) => {
        const status = statusRes?.status;
        if (status === "completed" || status === "ready") {
          return { done: true, error: false };
        }
        if (status === "failed") {
          return { done: true, error: true, errorMessage: statusRes?.error || "Voice cloning failed" };
        }
        return { done: false };
      },
      pollingOptions
    );
  }

  async pollVoice(voiceId, pollingOptions = {}) {
    return Poller.pollTask(
      async () => {
        try {
          return await this.getCloneStatus(voiceId);
        } catch (err) {
          return await this.http.get(`${API_ENDPOINTS.LIST_VOICES}/${voiceId}`);
        }
      },
      (res) => {
        const status = (res?.status || res?.state || res?.data?.status || res?.data?.state || "").toString().toLowerCase();
        if (status === "completed" || status === "ready" || status === "success") {
          return { done: true, error: false };
        }
        if (status === "failed" || status === "error") {
          return {
            done: true,
            error: true,
            errorMessage: res?.error?.message || res?.error || "Voice cloning failed",
          };
        }
        return { done: false };
      },
      {
        intervalMs: 4000,
        timeoutMs: 90000,
        maxAttempts: 25,
        ...pollingOptions,
      }
    );
  }
}

export default VoiceCloneModule;
