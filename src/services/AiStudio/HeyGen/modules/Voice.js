/**
 * HeyGen Voice Module
 */

import BaseModule from "../core/BaseModule.js";
import { API_ENDPOINTS } from "../constants.js";
import VoiceHelper from "../helpers/VoiceHelper.js";

export class VoiceModule extends BaseModule {
  async list(params = {}) {
    const data = await this.http.get(API_ENDPOINTS.LIST_VOICES, params);
    const voices = data?.voices || data || [];
    if (params.filter) {
      return VoiceHelper.filterVoices(voices, params.filter);
    }
    return voices;
  }

  async getDetails(voiceId) {
    return this.http.get(API_ENDPOINTS.VOICE_DETAILS, { voice_id: voiceId });
  }
}

export default VoiceModule;
