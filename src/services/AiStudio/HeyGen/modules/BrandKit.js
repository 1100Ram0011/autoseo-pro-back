/**
 * HeyGen Brand Kit Module
 */

import BaseModule from "../core/BaseModule.js";
import { API_ENDPOINTS } from "../constants.js";

export class BrandKitModule extends BaseModule {
  async getBrandKit() {
    return this.http.get(API_ENDPOINTS.BRAND_KIT);
  }

  async updateBrandKit(data = {}) {
    const result = await this.http.put(API_ENDPOINTS.BRAND_KIT, data);
    this.emit("brandkit.updated", result);
    return result;
  }
}

export default BrandKitModule;
