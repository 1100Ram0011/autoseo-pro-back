/**
 * HeyGen Upload Utility for Assets and Binary Streams
 */

import FormData from "form-data";
import { API_ENDPOINTS } from "../constants.js";
import { HeyGenValidationError } from "../errors.js";

export class UploadHandler {
  constructor(http) {
    this.http = http;
  }

  async uploadMedia(fileBufferOrStream, options = {}) {
    const filename = options.filename || "upload_file";
    const contentType = options.contentType || "application/octet-stream";
    const assetType = options.assetType || "image"; // image, video, audio

    if (!fileBufferOrStream) {
      throw new HeyGenValidationError("File buffer or stream is required for upload.");
    }

    const form = new FormData();
    form.append("file", fileBufferOrStream, {
      filename,
      contentType,
    });

    if (assetType) {
      form.append("type", assetType);
    }

    return this.http.post(API_ENDPOINTS.UPLOAD_ASSET, form, {
      headers: form.getHeaders(),
      timeout: options.timeout || 180000,
    });
  }
}

export default UploadHandler;
