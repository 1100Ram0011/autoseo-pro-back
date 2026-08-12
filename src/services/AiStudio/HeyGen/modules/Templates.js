/**
 * HeyGen Templates Module
 */

import BaseModule from "../core/BaseModule.js";
import { API_ENDPOINTS } from "../constants.js";

export class TemplatesModule extends BaseModule {
  async list(params = {}) {
    return this.http.get(API_ENDPOINTS.LIST_TEMPLATES, params);
  }

  async getDetails(templateId) {
    return this.http.get(`${API_ENDPOINTS.TEMPLATE_DETAILS}/${templateId}`);
  }

  async generateFromTemplate(templateId, variables = {}, options = {}) {
    const payload = {
      template_id: templateId,
      variables,
      title: options.title || `Template_Video_${Date.now()}`,
      caption: options.caption ?? false,
      callback_id: options.callbackId || null,
    };

    const result = await this.http.post(API_ENDPOINTS.GENERATE_FROM_TEMPLATE, payload);
    this.emit("template.generated", result);
    return result;
  }
}

export default TemplatesModule;
