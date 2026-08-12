/**
 * HeyGen Avatar Helper Utility
 */

export class AvatarHelper {
  static filterAvatars(avatars = [], criteria = {}) {
    return avatars.filter((avatar) => {
      if (criteria.gender && avatar.gender?.toLowerCase() !== criteria.gender.toLowerCase()) {
        return false;
      }
      if (criteria.pose && avatar.pose?.toLowerCase() !== criteria.pose.toLowerCase()) {
        return false;
      }
      if (criteria.style && avatar.avatar_style?.toLowerCase() !== criteria.style.toLowerCase()) {
        return false;
      }
      if (criteria.search) {
        const query = criteria.search.toLowerCase();
        const nameMatch = avatar.avatar_name?.toLowerCase().includes(query);
        const idMatch = avatar.avatar_id?.toLowerCase().includes(query);
        if (!nameMatch && !idMatch) return false;
      }
      return true;
    });
  }

  static formatPhotoAvatarPayload(options = {}) {
    return this.formatPhotoAvatarPayloadV3(options);
  }

  static formatPhotoAvatarPayloadV3(options = {}) {
    let fileObj;
    if (options.assetId || options.asset_id) {
      fileObj = {
        type: "asset_id",
        id: options.assetId || options.asset_id,
      };
    } else {
      fileObj = {
        type: "url",
        url: options.imageUrl || options.image_url,
      };
    }

    const payload = {
      type: "photo",
      name: options.name || `Avatar_${Date.now()}`,
      file: fileObj,
    };

    if (options.motion_prompt || options.motionPrompt) {
      payload.motion_prompt = options.motion_prompt || options.motionPrompt;
    }
    if (options.expressiveness) {
      payload.expressiveness = options.expressiveness;
    }
    if (options.gender) {
      payload.gender = options.gender;
    }
    if (options.groupId || options.group_id) {
      payload.group_id = options.groupId || options.group_id;
    }

    return payload;
  }

  static formatPromptAvatarPayloadV3(options = {}) {
    const payload = {
      type: "prompt",
      name: options.name || `Avatar_${Date.now()}`,
      prompt: options.prompt || options.text || options.description || "professional business attire",
    };

    if (options.avatarId || options.avatar_id || options.groupId || options.group_id) {
      payload.avatar_id = options.avatarId || options.avatar_id || options.groupId || options.group_id;
    }
    if (options.motion_prompt || options.motionPrompt) {
      payload.motion_prompt = options.motion_prompt || options.motionPrompt;
    }
    if (options.expressiveness) {
      payload.expressiveness = options.expressiveness;
    }
    if (options.gender) {
      payload.gender = options.gender;
    }

    return payload;
  }

  static formatPhotoAvatarPayloadV2(options = {}) {
    return {
      name: options.name || `Avatar_${Date.now()}`,
      image_url: options.imageUrl || options.image_url,
      gender: options.gender || "unspecified",
      motion: options.motion || options.motion_prompt || options.motionPrompt || "natural",
    };
  }
}

export default AvatarHelper;
