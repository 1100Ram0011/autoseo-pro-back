/**
 * HeyGen Avatar Module
 * Supports Avatars, Avatar Looks, Avatar Groups, and Photo Avatars (v3 primary with v2 fallback)
 */

import BaseModule from "../core/BaseModule.js";
import { API_ENDPOINTS } from "../constants.js";
import AvatarHelper from "../helpers/AvatarHelper.js";
import Poller from "../core/Polling.js";

export class AvatarModule extends BaseModule {
  /**
   * List avatars (Studio avatars, Photo avatars, Digital Twins)
   * @param {Object} params - Filtering and pagination parameters
   */
  async list(params = {}) {
    const data = await this.http.get(API_ENDPOINTS.LIST_AVATARS, params);
    const avatars = data?.avatars || data?.list || data || [];
    if (params.filter) {
      return AvatarHelper.filterAvatars(avatars, params.filter);
    }
    return avatars;
  }

  /**
   * Get details for a specific avatar
   * @param {string} avatarId 
   */
  async getDetails(avatarId) {
    try {
      return await this.http.get(`${API_ENDPOINTS.AVATAR_DETAILS}/${avatarId}`);
    } catch (err) {
      return this.http.get(API_ENDPOINTS.AVATAR_DETAILS, { avatar_id: avatarId });
    }
  }

  /**
   * List avatar character groups
   * @param {Object} params 
   */
  async listGroups(params = {}) {
    try {
      return await this.http.get(API_ENDPOINTS.AVATAR_GROUPS, params);
    } catch (err) {
      console.warn("HeyGen v3 avatar groups fallback to v2 endpoint:", err.message);
      return this.http.get(API_ENDPOINTS.AVATAR_GROUPS_V2 || "/v2/avatar_group/list", params);
    }
  }

  /**
   * Create a new Avatar (digital twin, photo, or prompt-based)
   * @param {Object} options 
   */
  async createAvatar(options = {}) {
    const result = await this.http.post(API_ENDPOINTS.CREATE_AVATAR, options);
    this.emit("avatar.created", result);
    return result;
  }

  /**
   * Create a Photo Avatar
   * @param {Object} options - Includes imageUrl or assetId, name, motion_prompt, expressiveness, gender
   */
  async createPhotoAvatar(options = {}) {
    try {
      const payloadV3 = AvatarHelper.formatPhotoAvatarPayloadV3(options);
      const result = await this.http.post(API_ENDPOINTS.CREATE_PHOTO_AVATAR, payloadV3);
      this.emit("avatar.photo_created", result);
      return result;
    } catch (err) {
      console.warn("HeyGen v3 photo avatar creation fallback to v2 endpoint:", err.message);
      const payloadV2 = AvatarHelper.formatPhotoAvatarPayloadV2(options);
      const resultV2 = await this.http.post(API_ENDPOINTS.CREATE_PHOTO_AVATAR_V2, payloadV2);
      this.emit("avatar.photo_created", resultV2);
      return resultV2;
    }
  }

  /**
   * Create a Prompt-based Avatar or Look for an existing avatar
   * Documentation: https://developers.heygen.com/reference/create-avatar
   * @param {Object} options - { prompt, avatar_id, group_id, name, motion_prompt, expressiveness, gender }
   */
  async createPromptAvatar(options = {}) {
    const payloadV3 = AvatarHelper.formatPromptAvatarPayloadV3(options);
    const result = await this.http.post(API_ENDPOINTS.CREATE_AVATAR, payloadV3);
    this.emit("avatar.prompt_created", result);
    return result;
  }

  /*
  |--------------------------------------------------------------------------
  | Avatar Looks Management (GET, PATCH, DELETE /v3/avatars/looks)
  |--------------------------------------------------------------------------
  */

  /**
   * Create a new Avatar Look (using photo OR text prompt) for an existing avatar
   * Documentation: https://developers.heygen.com/reference/create-avatar
   * @param {Object} options - { prompt, avatar_id, group_id, image_url, imageUrl, name, motion_prompt, expressiveness }
   */
  async createLook(options = {}) {
    if (options.prompt || options.text || options.description) {
      return this.createPromptAvatar(options);
    }
    return this.createPhotoAvatar({
      imageUrl: options.image_url || options.imageUrl,
      assetId: options.asset_id || options.assetId,
      name: options.name || `Look_${Date.now()}`,
      motion_prompt: options.motion_prompt || options.motionPrompt,
      expressiveness: options.expressiveness || "high",
      gender: options.gender || "male",
      group_id: options.group_id || options.groupId || options.avatar_id || options.avatarId,
    });
  }

  /**
   * Alias for createLook (remix look via prompt or photo)
   */
  async remixLook(options = {}) {
    return this.createLook(options);
  }

  /**
   * List paginated avatar looks
   * @param {Object} params - { page, limit, ... }
   */
  async listLooks(params = {}) {
    return this.http.get(API_ENDPOINTS.AVATAR_LOOKS, params);
  }

  /**
   * Get specific avatar look details
   * @param {string} lookId 
   */
  async getLookDetails(lookId) {
    return this.http.get(`${API_ENDPOINTS.AVATAR_LOOKS}/${lookId}`);
  }

  /**
   * Update an avatar look (e.g. rename or retag)
   * @param {string} lookId 
   * @param {Object} updateData - { name, tags, ... }
   */
  async updateLook(lookId, updateData = {}) {
    const result = await this.http.patch(`${API_ENDPOINTS.AVATAR_LOOKS}/${lookId}`, updateData);
    this.emit("avatar.look_updated", { lookId, ...result });
    return result;
  }

  /**
   * Delete an avatar look
   * @param {string} lookId 
   */
  async deleteLook(lookId) {
    const result = await this.http.delete(`${API_ENDPOINTS.AVATAR_LOOKS}/${lookId}`);
    this.emit("avatar.look_deleted", { lookId });
    return result;
  }

  /**
   * Poll avatar look status until status is 'completed' or 'ready'
   * @param {string} lookId 
   * @param {Object} pollingOptions 
   */
  async pollLook(lookId, pollingOptions = {}) {
    return Poller.pollTask(
      async () => {
        try {
          return await this.getLookDetails(lookId);
        } catch (err) {
          return await this.getDetails(lookId);
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
            errorMessage: res?.error?.message || res?.error || "Avatar look generation failed",
          };
        }
        return { done: false };
      },
      {
        intervalMs: 5000,
        timeoutMs: 180000,
        maxAttempts: 36,
        ...pollingOptions,
      }
    );
  }
}

export default AvatarModule;
