/**
 * Centralized Predefined AI Error Catalog & Classifier
 * Maps raw provider errors (Anthropic, OpenAI, Vertex AI, etc.) to standard error codes and user-friendly messages.
 */

export const AI_ERROR_CATALOG = [
  // ==========================================
  // ANTHROPIC (CLAUDE) ERROR CODES (ANT-xxx)
  // ==========================================
  // ==========================================
  // ANTHROPIC (CLAUDE) ERROR CODES (ANT-xxx)
  // Official Docs: https://docs.anthropic.com/en/api/errors
  // ==========================================
  {
    code: 'ANT-400',
    provider: 'Anthropic',
    status: 400,
    type: 'invalid_request_error',
    adminTitle: 'Insufficient Credit Balance',
    adminDescription: 'Your Anthropic API credit balance is too low to access the Anthropic API. Upgrade plan or purchase credits at console.anthropic.com.',
    userMessage: 'Service temporarily unavailable. Kindly try again after some time. (Code: ANT-400)',
    matchers: [/credit balance is too low/i, /purchase credits/i, /plans & billing/i, /insufficient_credits/i],
  },
  {
    code: 'ANT-400-INVALID',
    provider: 'Anthropic',
    status: 400,
    type: 'invalid_request_error',
    adminTitle: 'Anthropic Invalid Request / Validation Error',
    adminDescription: 'The request payload or parameters sent to Anthropic were malformed or invalid.',
    userMessage: 'Service temporarily unavailable. Kindly check request parameters and try again. (Code: ANT-400-INVALID)',
    matchers: [/invalid_request_error/i, /invalid parameter/i, /invalid body/i, /unparseable/i],
  },
  {
    code: 'ANT-401',
    provider: 'Anthropic',
    status: 401,
    type: 'authentication_error',
    adminTitle: 'Invalid or Missing Anthropic API Key',
    adminDescription: 'The Anthropic API key provided in x-api-key header is invalid, missing, or revoked.',
    userMessage: 'Service temporarily unavailable. Kindly try again after some time. (Code: ANT-401)',
    matchers: [/invalid api key/i, /authentication_error/i, /x-api-key/i, /invalid x-api-key/i],
  },
  {
    code: 'ANT-403',
    provider: 'Anthropic',
    status: 403,
    type: 'permission_error',
    adminTitle: 'Anthropic Access Forbidden / Region Restricted',
    adminDescription: 'The requested operation is forbidden or your region/account is not supported.',
    userMessage: 'Service temporarily unavailable in your region. Kindly try again after some time. (Code: ANT-403)',
    matchers: [/permission_error/i, /access forbidden/i, /country, region or territory is not supported/i],
  },
  {
    code: 'ANT-404',
    provider: 'Anthropic',
    status: 404,
    type: 'not_found_error',
    adminTitle: 'Anthropic Resource or Model Not Found',
    adminDescription: 'The specified model ID or API resource endpoint was not found on Anthropic.',
    userMessage: 'Requested AI model or resource not found. (Code: ANT-404)',
    matchers: [/not_found_error/i, /resource not found/i, /model not found/i],
  },
  {
    code: 'ANT-413',
    provider: 'Anthropic',
    status: 413,
    type: 'request_too_large',
    adminTitle: 'Anthropic Request / Prompt Content Too Large',
    adminDescription: 'The request input prompt, image, or payload exceeded Anthropic size or context limits.',
    userMessage: 'The provided content is too long. Please reduce input length and try again. (Code: ANT-413)',
    matchers: [/prompt is too long/i, /context_length_exceeded/i, /request_too_large/i, /maximum context length/i],
  },
  {
    code: 'ANT-429',
    provider: 'Anthropic',
    status: 429,
    type: 'rate_limit_error',
    adminTitle: 'Anthropic Rate Limit Exceeded',
    adminDescription: 'Requests per minute (RPM), tokens per minute (TPM), or tokens per day (TPD) limit reached.',
    userMessage: 'High system demand. Kindly wait a moment and try again. (Code: ANT-429)',
    matchers: [/rate_limit_error/i, /rate limit/i, /too many requests/i],
  },
  {
    code: 'ANT-500',
    provider: 'Anthropic',
    status: 500,
    type: 'api_error',
    adminTitle: 'Anthropic Internal Server Error',
    adminDescription: 'Anthropic server encountered an internal error while processing the request.',
    userMessage: 'Service temporarily unavailable. Kindly try again after some time. (Code: ANT-500)',
    matchers: [/api_error/i, /internal_server_error/i, /anthropic error 500/i],
  },
  {
    code: 'ANT-529',
    provider: 'Anthropic',
    status: 529,
    type: 'overloaded_error',
    adminTitle: 'Anthropic API Overloaded',
    adminDescription: 'Anthropic servers are temporarily overloaded due to high global traffic.',
    userMessage: 'Service busy. Kindly try again in a few moments. (Code: ANT-529)',
    matchers: [/overloaded_error/i, /anthropic is overloaded/i],
  },

  // ==========================================
  // OPENAI ERROR CODES (OAI-xxx)
  // ==========================================
  {
    code: 'OAI-400',
    provider: 'OpenAI',
    status: 400,
    type: 'invalid_request_error',
    adminTitle: 'OpenAI Invalid Request',
    adminDescription: 'The request parameters or prompt were invalid for OpenAI API.',
    userMessage: 'Service temporarily unavailable. Kindly try again after some time. (Code: OAI-400)',
    matchers: [/invalid_request_error/i, /context_length_exceeded/i, /maximum context length/i],
  },
  {
    code: 'OAI-401',
    provider: 'OpenAI',
    status: 401,
    type: 'invalid_api_key',
    adminTitle: 'Invalid OpenAI API Key',
    adminDescription: 'The OpenAI API key is missing or invalid.',
    userMessage: 'Service temporarily unavailable. Kindly try again after some time. (Code: OAI-401)',
    matchers: [/incorrect api key/i, /invalid_api_key/i, /unauthorized/i],
  },
  {
    code: 'OAI-402',
    provider: 'OpenAI',
    status: 402,
    type: 'insufficient_quota',
    adminTitle: 'OpenAI Insufficient Quota',
    adminDescription: 'OpenAI billing quota exceeded or card declined. Check platform.openai.com billing.',
    userMessage: 'Service temporarily unavailable. Kindly try again after some time. (Code: OAI-402)',
    matchers: [/insufficient_quota/i, /quota exceeded/i, /you exceeded your current quota/i, /billing/i],
  },
  {
    code: 'OAI-429',
    provider: 'OpenAI',
    status: 429,
    type: 'rate_limit_exceeded',
    adminTitle: 'OpenAI Rate Limit Exceeded',
    adminDescription: 'OpenAI rate limit (RPM/TPM) reached for current tier.',
    userMessage: 'High system demand. Kindly wait a moment and try again. (Code: OAI-429)',
    matchers: [/rate_limit_exceeded/i, /rate limit reached/i, /too many requests/i],
  },
  {
    code: 'OAI-500',
    provider: 'OpenAI',
    status: 500,
    type: 'server_error',
    adminTitle: 'OpenAI Server Error',
    adminDescription: 'OpenAI encountered an internal server failure.',
    userMessage: 'Service temporarily unavailable. Kindly try again after some time. (Code: OAI-500)',
    matchers: [/server_error/i, /openai server error/i, /bad gateway/i, /service unavailable/i],
  },

  // ==========================================
  // VERTEX AI / GOOGLE GEMINI ERROR CODES (VTX-xxx)
  // ==========================================
  {
    code: 'VTX-400-COPYRIGHT',
    provider: 'Vertex AI',
    status: 400,
    type: 'third_party_content_restriction',
    adminTitle: 'Google Content Provider Copyright Filter',
    adminDescription: 'Google blocked the request due to third-party content provider interests or copyright restrictions.',
    userMessage: 'Request blocked due to third-party content/copyright policies. Kindly modify prompt or input media and try again. (Code: VTX-400-COPYRIGHT)',
    matchers: [/interests of third-party content providers/i, /third-party content/i, /third_party_content/i, /third party content/i],
  },
  {
    code: 'VTX-400-IMAGE',
    provider: 'Vertex AI',
    status: 400,
    type: 'invalid_image',
    adminTitle: 'Vertex AI / Gemini Invalid Image Input',
    adminDescription: 'The provided image file, buffer, or format sent to Vertex AI was invalid or corrupt.',
    userMessage: 'Provided image is invalid. Kindly select a valid image file and try again. (Code: VTX-400-IMAGE)',
    matchers: [/provided image is not valid/i, /invalid image/i, /corrupt image/i],
  },
  {
    code: 'VTX-400-URI',
    provider: 'Vertex AI',
    status: 400,
    type: 'invalid_file_uri',
    adminTitle: 'Vertex AI Invalid fileUri Parameter',
    adminDescription: 'The fileUri parameter sent to Vertex AI must be a valid Cloud Storage or HTTP(S) URI.',
    userMessage: 'Invalid media URI format. Kindly check file upload and try again. (Code: VTX-400-URI)',
    matchers: [/fileuri parameter must be a cloud storage/i, /fileuri/i, /entered value was/i],
  },
  {
    code: 'VTX-400',
    provider: 'Vertex AI',
    status: 400,
    type: 'safety_or_invalid',
    adminTitle: 'Vertex AI Safety Filter / Invalid Argument',
    adminDescription: 'Vertex AI / Gemini blocked request due to safety policies or malformed parameters.',
    userMessage: 'Request could not be processed due to content policies. Kindly adjust prompt and try again. (Code: VTX-400)',
    matchers: [/safety filter/i, /safety guidelines/i, /blocked the generation/i, /invalid argument/i, /invalid_argument/i, /error 29310472/i],
  },
  {
    code: 'VTX-401',
    provider: 'Vertex AI',
    status: 401,
    type: 'unauthenticated',
    adminTitle: 'Vertex AI Authentication Failure',
    adminDescription: 'GCP Service Account key or OAuth token is invalid/expired.',
    userMessage: 'Service temporarily unavailable. Kindly try again after some time. (Code: VTX-401)',
    matchers: [/unauthenticated/i, /invalid credentials/i, /gcp key/i],
  },
  {
    code: 'VTX-403-BILLING',
    provider: 'Vertex AI',
    status: 403,
    type: 'billing_disabled',
    adminTitle: 'Google Cloud GCP Project Billing Disabled',
    adminDescription: 'GCP project billing is disabled (BILLING_DISABLED). Enable billing on Google Cloud Console.',
    userMessage: 'Service temporarily unavailable. Kindly try again after some time. (Code: VTX-403-BILLING)',
    matchers: [/billing_disabled/i, /requires billing to be enabled/i, /enable billing/i, /console.developers.google.com\/billing/i],
  },
  {
    code: 'VTX-403-IAM',
    provider: 'Vertex AI',
    status: 403,
    type: 'permission_denied',
    adminTitle: 'Vertex AI IAM Permission Denied',
    adminDescription: 'GCP Service account lacks aiplatform.endpoints.predict permission or Vertex AI API is disabled.',
    userMessage: 'Service temporarily unavailable. Kindly try again after some time. (Code: VTX-403-IAM)',
    matchers: [/aiplatform.endpoints.predict/i, /iam_permission_denied/i, /permission_denied/i, /permission 'aiplatform/i],
  },
  {
    code: 'VTX-403',
    provider: 'Vertex AI',
    status: 403,
    type: 'permission_denied',
    adminTitle: 'Vertex AI Access Forbidden',
    adminDescription: 'GCP Service account lacks required role or access is forbidden for Vertex AI.',
    userMessage: 'Service temporarily unavailable. Kindly try again after some time. (Code: VTX-403)',
    matchers: [/permission denied/i, /api has not been used in project/i, /forbidden/i],
  },
  {
    code: 'VTX-404',
    provider: 'Vertex AI',
    status: 404,
    type: 'not_found',
    adminTitle: 'Vertex AI / Gemini Model Not Found',
    adminDescription: 'The specified publisher model or model version was not found or not supported for generateContent.',
    userMessage: 'Requested AI model or version is not available. (Code: VTX-404)',
    matchers: [/was not found or your project does not have access/i, /is not found for api version/i, /publisher model/i, /not supported for generatecontent/i, /call listmodels/i, /not_found/i],
  },
  {
    code: 'VTX-429',
    provider: 'Vertex AI',
    status: 429,
    type: 'resource_exhausted',
    adminTitle: 'Vertex AI / Gemini Resource Quota Exhausted',
    adminDescription: 'Vertex AI / Gemini rate limit or quota exceeded (RESOURCE_EXHAUSTED). Check GCP quota limits.',
    userMessage: 'High system demand on Google Vertex AI. Kindly try again in a few moments. (Code: VTX-429)',
    matchers: [/resource_exhausted/i, /resource exhausted/i, /quota exceeded/i, /rate limit/i, /error-code-429/i, /code":\s*429/i],
  },
  {
    code: 'VTX-500',
    provider: 'Vertex AI',
    status: 500,
    type: 'internal_error',
    adminTitle: 'Vertex AI Server Error',
    adminDescription: 'Google Cloud Vertex AI backend encountered an internal error.',
    userMessage: 'Service temporarily unavailable. Kindly try again after some time. (Code: VTX-500)',
    matchers: [/internal server error/i, /google cloud error/i],
  },

  // ==========================================
  // HEYGEN ERROR CODES (HYG-xxx)
  // ==========================================
  {
    code: 'HYG-400',
    provider: 'HeyGen',
    status: 400,
    adminTitle: 'HeyGen Bad Request',
    adminDescription: 'Invalid avatar or template configuration sent to HeyGen.',
    userMessage: 'Service temporarily unavailable. Kindly try again after some time. (Code: HYG-400)',
    matchers: [/heygen/i, /invalid avatar/i],
  },
  {
    code: 'HYG-401',
    provider: 'HeyGen',
    status: 401,
    adminTitle: 'HeyGen Unauthorized Key',
    adminDescription: 'HeyGen API key is invalid or revoked.',
    userMessage: 'Service temporarily unavailable. Kindly try again after some time. (Code: HYG-401)',
    matchers: [/heygen auth/i, /heygen api key/i],
  },

  // ==========================================
  // GENERIC AI FALLBACK CODES (GEN-xxx)
  // ==========================================
  {
    code: 'GEN-400',
    provider: 'Generic',
    status: 400,
    adminTitle: 'Generic Bad Request',
    adminDescription: 'AI Request sent invalid data or payload.',
    userMessage: 'Service temporarily unavailable. Kindly try again after some time. (Code: GEN-400)',
    matchers: [],
  },
  {
    code: 'GEN-401',
    provider: 'Generic',
    status: 401,
    adminTitle: 'Generic Unauthorized',
    adminDescription: 'AI Provider API Key missing or unauthorized.',
    userMessage: 'Service temporarily unavailable. Kindly try again after some time. (Code: GEN-401)',
    matchers: [],
  },
  {
    code: 'GEN-429',
    provider: 'Generic',
    status: 429,
    adminTitle: 'Generic Rate Limit Exceeded',
    adminDescription: 'AI Provider rate limit reached.',
    userMessage: 'High demand on AI service. Kindly try again in a moment. (Code: GEN-429)',
    matchers: [],
  },
  {
    code: 'GEN-500',
    provider: 'Generic',
    status: 500,
    adminTitle: 'Generic Upstream AI Failure',
    adminDescription: 'AI Provider encountered an unhandled exception or upstream breakdown.',
    userMessage: 'Service temporarily unavailable. Kindly try again after some time. (Code: GEN-500)',
    matchers: [],
  },
];

/**
 * Classify any raw error into standardized AI error representation
 * @param {any} rawError - Raw error object caught from SDK or HTTP request
 * @param {string} [providerHint] - Provider name hint (e.g. 'Anthropic', 'OpenAI', 'Vertex AI')
 * @returns {Object} Standardized AI Error structure
 */
export function classifyAiError(rawError, providerHint = '') {
  let status = 500;
  let message = '';
  let errorType = '';
  let requestId = '';
  let rawData = null;

  if (typeof rawError === 'string') {
    message = rawError;
  } else if (rawError && typeof rawError === 'object') {
    // Extract status code numerically handling Google API error structure { error: { code: 429, status: "RESOURCE_EXHAUSTED" } }
    const extractedStatus =
      rawError.status ||
      rawError.statusCode ||
      rawError.error?.code ||
      rawError.response?.status ||
      rawError.response?.data?.error?.code ||
      rawError.error?.status ||
      500;

    if (typeof extractedStatus === 'number' && !isNaN(extractedStatus)) {
      status = extractedStatus;
    } else if (typeof extractedStatus === 'string' && !isNaN(parseInt(extractedStatus, 10))) {
      status = parseInt(extractedStatus, 10);
    } else {
      status = 500;
    }

    message =
      rawError.message ||
      rawError.error?.message ||
      rawError.response?.data?.error?.message ||
      rawError.response?.data?.message ||
      '';
    errorType =
      rawError.type ||
      rawError.error?.type ||
      rawError.error?.status ||
      rawError.response?.data?.error?.type ||
      rawError.response?.data?.error?.status ||
      '';
    requestId =
      rawError.request_id ||
      rawError.requestId ||
      rawError.data?.request_id ||
      rawError.data?.error?.request_id ||
      rawError.response?.data?.request_id ||
      rawError.headers?.['request-id'] ||
      rawError.headers?.['x-request-id'] ||
      '';
    rawData = rawError.data || rawError.response?.data || rawError.error || rawError;
  }

  // Combine full text string to evaluate regex matchers
  const fullTextToTest = `${message} ${errorType} ${typeof rawData === 'string' ? rawData : JSON.stringify(rawData || {})}`.toLowerCase();

  // Normalize provider hint
  let providerName = providerHint || 'Generic';
  if (!providerHint) {
    if (fullTextToTest.includes('anthropic') || fullTextToTest.includes('claude') || requestId.startsWith('req_')) {
      providerName = 'Anthropic';
    } else if (fullTextToTest.includes('openai') || fullTextToTest.includes('gpt')) {
      providerName = 'OpenAI';
    } else if (fullTextToTest.includes('vertex') || fullTextToTest.includes('gemini') || fullTextToTest.includes('google')) {
      providerName = 'Vertex AI';
    }
  }

  // 1. Exact Matcher search
  const providerCatalog = AI_ERROR_CATALOG.filter(
    (item) => item.provider.toLowerCase() === providerName.toLowerCase()
  );

  for (const entry of providerCatalog) {
    if (entry.matchers && entry.matchers.length > 0) {
      for (const matcher of entry.matchers) {
        if (matcher.test(fullTextToTest)) {
          return {
            code: entry.code,
            provider: entry.provider,
            status: entry.status || status,
            adminTitle: entry.adminTitle,
            adminDescription: entry.adminDescription,
            userMessage: entry.userMessage,
            requestId: requestId || 'N/A',
            rawErrorData: rawData,
            originalMessage: message,
          };
        }
      }
    }
  }

  // 2. Status Code based fallback per provider
  const statusFallback = providerCatalog.find((item) => item.status === Number(status));
  if (statusFallback) {
    return {
      code: statusFallback.code,
      provider: statusFallback.provider,
      status: Number(status),
      adminTitle: statusFallback.adminTitle,
      adminDescription: message || statusFallback.adminDescription,
      userMessage: statusFallback.userMessage,
      requestId: requestId || 'N/A',
      rawErrorData: rawData,
      originalMessage: message,
    };
  }

  // 3. Fallback to Generic Code
  let genericPrefix = 'GEN';
  if (providerName.toLowerCase().includes('anthropic')) genericPrefix = 'ANT';
  else if (providerName.toLowerCase().includes('openai')) genericPrefix = 'OAI';
  else if (providerName.toLowerCase().includes('vertex')) genericPrefix = 'VTX';

  const defaultCode = `${genericPrefix}-${status || 500}`;

  return {
    code: defaultCode,
    provider: providerName,
    status: Number(status) || 500,
    adminTitle: `${providerName} API Error (${status || 500})`,
    adminDescription: message || `An unexpected error occurred in ${providerName} API execution.`,
    userMessage: `Service temporarily unavailable. Kindly try again after some time. (Code: ${defaultCode})`,
    requestId: requestId || 'N/A',
    rawErrorData: rawData,
    originalMessage: message,
  };
}
