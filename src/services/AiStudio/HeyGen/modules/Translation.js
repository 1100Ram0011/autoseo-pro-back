/**
 * HeyGen Video Translation Module
 */

import BaseModule from "../core/BaseModule.js";
import { API_ENDPOINTS } from "../constants.js";
import Poller from "../core/Polling.js";

export class TranslationModule extends BaseModule {
  async translateVideo({ videoUrl, targetLanguage, mode = "speed", title = null }) {
    const payload = {
      video_url: videoUrl,
      target_language: targetLanguage,
      mode, // "speed" or "precision"
      title: title || `Translation_${Date.now()}`,
    };

    const result = await this.http.post(API_ENDPOINTS.TRANSLATE_VIDEO, payload);
    this.emit("translation.requested", result);
    return result;
  }

  async getStatus(translationId) {
    return this.http.get(API_ENDPOINTS.TRANSLATION_STATUS, { translation_id: translationId });
  }

  async list(params = {}) {
    return this.http.get(API_ENDPOINTS.LIST_TRANSLATIONS, params);
  }

  async translateAndPoll(options = {}, pollingOptions = {}) {
    const res = await this.translateVideo(options);
    const translationId = res?.translation_id || res?.id || res;

    return Poller.pollTask(
      () => this.getStatus(translationId),
      (statusRes) => {
        const status = statusRes?.status;
        if (status === "completed" || status === "success") {
          return { done: true, error: false };
        }
        if (status === "failed") {
          return { done: true, error: true, errorMessage: statusRes?.error || "Translation failed" };
        }
        return { done: false };
      },
      pollingOptions
    );
  }
}

export default TranslationModule;
