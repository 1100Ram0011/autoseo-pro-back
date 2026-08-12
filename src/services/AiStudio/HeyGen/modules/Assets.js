/**
 * HeyGen Assets Management Module
 * Supports Standard Upload, Direct Uploads, Batch Uploads, Asset Listing, Status Queries, and Asset Deletion.
 */

import BaseModule from "../core/BaseModule.js";
import { API_ENDPOINTS } from "../constants.js";
import UploadHandler from "../core/Upload.js";

export class AssetsModule extends BaseModule {
  constructor(client, events) {
    super(client, events);
    this.uploader = new UploadHandler(this.http);
  }

  /**
   * Standard upload for small files (<= 32MB)
   * @param {Buffer|ReadableStream} fileBufferOrStream 
   * @param {Object} options - { filename, contentType, assetType }
   */
  async upload(fileBufferOrStream, options = {}) {
    const result = await this.uploader.uploadMedia(fileBufferOrStream, options);
    this.emit("asset.uploaded", result);
    return result;
  }

  /**
   * Initialize direct upload for large files
   * @param {Object} fileDetails - { name, type, size, ... }
   */
  async initDirectUpload(fileDetails = {}) {
    const result = await this.http.post(API_ENDPOINTS.ASSETS_DIRECT_UPLOAD, fileDetails);
    this.emit("asset.direct_upload_initialized", result);
    return result;
  }

  /**
   * Complete direct upload after uploading file to presigned URL
   * @param {string} assetId 
   */
  async completeDirectUpload(assetId) {
    const result = await this.http.post(`${API_ENDPOINTS.LIST_ASSETS}/${assetId}/complete`);
    this.emit("asset.direct_upload_completed", { assetId, ...result });
    return result;
  }

  /**
   * Initialize batch upload (up to 100 files)
   * @param {Array|Object} batchItems 
   */
  async initBatchUpload(batchItems = []) {
    const payload = Array.isArray(batchItems) ? { files: batchItems } : batchItems;
    const result = await this.http.post(API_ENDPOINTS.ASSETS_BATCH_UPLOAD, payload);
    this.emit("asset.batch_upload_initialized", result);
    return result;
  }

  /**
   * List assets in workspace
   * @param {Object} params - { page, limit, type, ... }
   */
  async list(params = {}) {
    return this.http.get(API_ENDPOINTS.LIST_ASSETS, params);
  }

  /**
   * Get specific asset details
   * @param {string} assetId 
   */
  async getDetails(assetId) {
    return this.http.get(`${API_ENDPOINTS.ASSET_INFO}/${assetId}`);
  }

  /**
   * Get status for list of assets
   * @param {Object} params - { ids: "id1,id2" }
   */
  async getStatuses(params = {}) {
    return this.http.get(API_ENDPOINTS.ASSETS_STATUSES, params);
  }

  /**
   * Get status of batch upload
   * @param {string} batchId 
   */
  async getBatchStatus(batchId) {
    return this.http.get(`${API_ENDPOINTS.ASSETS_BATCHES}/${batchId}`);
  }

  /**
   * Delete an asset by ID
   * @param {string} assetId 
   */
  async delete(assetId) {
    const result = await this.http.delete(`${API_ENDPOINTS.DELETE_ASSET}/${assetId}`);
    this.emit("asset.deleted", { assetId });
    return result;
  }
}

export default AssetsModule;
