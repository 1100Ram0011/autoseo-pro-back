/**
 * HeyGen Digital Twin (Custom Avatar) Module
 */

import BaseModule from "../core/BaseModule.js";
import { API_ENDPOINTS } from "../constants.js";
import Poller from "../core/Polling.js";

export class DigitalTwinModule extends BaseModule {
  async createDigitalTwin({ name, videoUrl, consentVideoUrl }) {
    const payload = {
      name,
      video_url: videoUrl,
      consent_video_url: consentVideoUrl,
    };

    const result = await this.http.post(API_ENDPOINTS.DIGITAL_TWIN_CREATE, payload);
    this.emit("digital_twin.create_requested", result);
    return result;
  }

  async getStatus(digitalTwinId) {
    return this.http.get(API_ENDPOINTS.DIGITAL_TWIN_STATUS, { digital_twin_id: digitalTwinId });
  }

  async verifyConsent(digitalTwinId) {
    return this.http.post(API_ENDPOINTS.DIGITAL_TWIN_VERIFY, { digital_twin_id: digitalTwinId });
  }

  async createAndPoll(options = {}, pollingOptions = {}) {
    const res = await this.createDigitalTwin(options);
    const id = res?.digital_twin_id || res?.id;

    return Poller.pollTask(
      () => this.getStatus(id),
      (statusRes) => {
        const status = statusRes?.status;
        if (status === "trained" || status === "ready") {
          return { done: true, error: false };
        }
        if (status === "failed") {
          return { done: true, error: true, errorMessage: statusRes?.error || "Digital twin training failed" };
        }
        return { done: false };
      },
      pollingOptions
    );
  }
}

export default DigitalTwinModule;
