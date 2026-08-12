/**
 * HeyGen HTTP Client Wrapper
 */

import axios from "axios";
import { defaultConfig } from "../config.js";
import { HeyGenAPIError, HeyGenValidationError, HeyGenTimeoutError } from "../errors.js";
import { executeWithRetry } from "./Retry.js";
import { cleanPayload, formatQueryParams } from "./Utils.js";

export class HttpClient {
  constructor(options = {}) {
    this.apiKey = options.apiKey || defaultConfig.apiKey;
    this.baseUrl = options.baseUrl || defaultConfig.baseUrl;
    this.v2BaseUrl = options.v2BaseUrl || defaultConfig.v2BaseUrl;
    this.timeout = options.timeout || defaultConfig.timeout;
    this.retryConfig = { ...defaultConfig.retry, ...options.retry };
    this.customHeaders = options.headers || {};

    if (!this.apiKey) {
      console.warn("HeyGen API key is missing. Ensure HEYGEN_API_KEY environment variable is set.");
    }

    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeout,
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": this.apiKey,
        "x-api-key": this.apiKey,
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        ...this.customHeaders,
      },
    });
  }

  setApiKey(apiKey) {
    this.apiKey = apiKey;
    this.axiosInstance.defaults.headers.common["X-Api-Key"] = apiKey;
    this.axiosInstance.defaults.headers.common["x-api-key"] = apiKey;
    this.axiosInstance.defaults.headers.common["Authorization"] = `Bearer ${apiKey}`;
  }

  async request(method, url, data = null, config = {}) {
    if (!this.apiKey) {
      throw new HeyGenValidationError("API Key is required to make HTTP requests to HeyGen.");
    }

    const cleanedData = data ? cleanPayload(data) : null;
    const requestConfig = {
      method,
      url,
      ...(cleanedData && method.toLowerCase() !== "get" ? { data: cleanedData } : {}),
      ...config,
      headers: {
        ...this.axiosInstance.defaults.headers,
        ...config.headers,
      },
    };

    const makeCall = async () => {
      try {
        const response = await this.axiosInstance(requestConfig);
        return response.data?.data !== undefined ? response.data.data : response.data;
      } catch (error) {
        if (error.code === "ECONNABORTED" || error.message?.includes("timeout")) {
          throw new HeyGenTimeoutError(`Request to ${url} timed out after ${this.timeout}ms`);
        }

        if (error.response) {
          const status = error.response.status;
          const resData = error.response.data || {};
          const rawMessage = typeof resData.error === "object" ? (resData.error?.message || resData.error?.detail) : (resData.message || resData.error || resData.detail);
          const message = rawMessage || error.message || "HeyGen API Error";
          const apiCode = resData.code || resData.error_code || resData.error?.code || null;
          throw new HeyGenAPIError(message, status, resData, apiCode);
        }

        throw new HeyGenAPIError(error.message || "Network Error", 500);
      }
    };

    if (config.skipRetry) {
      return makeCall();
    }

    return executeWithRetry(makeCall, this.retryConfig);
  }

  async get(url, params = null, config = {}) {
    const queryString = formatQueryParams(params);
    return this.request("GET", `${url}${queryString}`, null, config);
  }

  async post(url, data = {}, config = {}) {
    return this.request("POST", url, data, config);
  }

  async put(url, data = {}, config = {}) {
    return this.request("PUT", url, data, config);
  }

  async patch(url, data = {}, config = {}) {
    return this.request("PATCH", url, data, config);
  }

  async delete(url, params = null, config = {}) {
    const queryString = formatQueryParams(params);
    return this.request("DELETE", `${url}${queryString}`, null, config);
  }
}

export default HttpClient;
