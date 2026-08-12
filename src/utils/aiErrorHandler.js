import AiErrorLog from '../models/ai/AiErrorLog.js';
import { classifyAiError } from './aiErrorCatalog.js';

/**
 * Log and format AI execution errors for multi-LLM setup
 * @param {any} rawError - The caught error object
 * @param {string} [providerHint] - Provider hint ('Anthropic', 'OpenAI', 'Vertex AI', etc.)
 * @param {Object} [context] - Execution context ({ endpoint, userId, requestPayload })
 * @returns {Promise<Object>} Formatted error object ready for API responses & user toasts
 */
export async function logAndFormatAiError(rawError, providerHint = '', context = {}) {
  const classified = classifyAiError(rawError, providerHint);

  try {
    // Sanitize payload to prevent logging sensitive user secrets or huge base64 strings
    let sanitizedPayload = null;
    if (context.requestPayload) {
      try {
        const payloadStr = JSON.stringify(context.requestPayload);
        if (payloadStr.length < 10000) {
          sanitizedPayload = context.requestPayload;
        } else {
          sanitizedPayload = { _summary: 'Payload too large to store completely', length: payloadStr.length };
        }
      } catch (e) {
        sanitizedPayload = '[Unserializable Payload]';
      }
    }

    // Derive human readable source/feature location
    let sourceFeature = context.source || context.feature || '';
    if (!sourceFeature) {
      const ep = (context.endpoint || '').toLowerCase();
      if (ep.includes('chat') || ep.includes('promptapproval') || ep.includes('message')) {
        sourceFeature = 'Chat Studio (Prompt Approval)';
      } else if (ep.includes('character') || ep.includes('avatar')) {
        sourceFeature = 'Character & Avatar Studio';
      } else if (ep.includes('cinematic') || ep.includes('video')) {
        sourceFeature = 'Video Generation Studio';
      } else if (ep.includes('social') || ep.includes('audit') || ep.includes('analytics')) {
        sourceFeature = 'Social Analytics & Audit';
      } else if (ep.includes('openai') || ep.includes('text')) {
        sourceFeature = 'AI Text Generation Service';
      } else {
        sourceFeature = context.endpoint || 'AI Execution Gateway';
      }
    }

    // Async DB save (fail-safe so DB error does not break caller response)
    await AiErrorLog.create({
      errorCode: classified.code,
      provider: classified.provider,
      status: classified.status,
      userMessage: classified.userMessage,
      adminTitle: classified.adminTitle,
      adminDescription: classified.adminDescription,
      requestId: classified.requestId || 'N/A',
      endpoint: context.endpoint || 'AI Execution Gateway',
      source: sourceFeature,
      userId: context.userId || null,
      requestPayload: sanitizedPayload,
      rawErrorData: classified.rawErrorData,
      originalMessage: classified.originalMessage,
    });
  } catch (dbErr) {
    console.error('⚠️ [AiErrorHandler] Failed to persist error log to MongoDB:', dbErr.message);
  }

  // Console warning for backend debugging
  console.error(`❌ [AI Error ${classified.code}] Provider: ${classified.provider} | Status: ${classified.status} | RequestId: ${classified.requestId}`);
  console.error(`   Admin Detail: ${classified.adminDescription}`);

  return {
    success: false,
    code: classified.code,
    errorCode: classified.code,
    message: classified.userMessage,
    userMessage: classified.userMessage,
    adminTitle: classified.adminTitle,
    adminDescription: classified.adminDescription,
    status: classified.status,
    provider: classified.provider,
    requestId: classified.requestId,
  };
}

export default logAndFormatAiError;
