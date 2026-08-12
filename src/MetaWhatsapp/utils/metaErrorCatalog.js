/**
 * Meta WhatsApp Cloud API Comprehensive Error Catalog & Recovery Mapping
 * Official Documentation Reference: https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes
 */

const META_ERROR_CATALOG = {
    // ── Tier 1: Authorization & Billing Errors ────────────────────────────────
    "190": {
        severity: "CRITICAL",
        category: "AUTH",
        title: "Access Token Expired",
        action: "REAUTH_TOKEN",
        solution: "Your Meta System User Access Token has expired or was revoked. Please re-authenticate your WhatsApp Business account in Account Settings."
    },
    "100": {
        severity: "CRITICAL",
        category: "AUTH",
        title: "Invalid Parameter / OAuth Error",
        action: "REAUTH_TOKEN",
        solution: "Invalid API parameter or authentication session. Please check your WABA connection settings or re-login."
    },
    "200": {
        severity: "CRITICAL",
        category: "AUTH",
        title: "Permission Denied",
        action: "REAUTH_TOKEN",
        solution: "Permission denied for this WhatsApp Phone Number ID. Ensure your System User has Full Control access in Meta Business Manager."
    },
    "131031": {
        severity: "CRITICAL",
        category: "BILLING",
        title: "Meta Payment Account Error",
        action: "CHECK_PAYMENT",
        solution: "Payment account error or credit limit reached on Meta WABA. Please check your payment method in Meta Business Manager."
    },
    "131030": {
        severity: "CRITICAL",
        category: "ACCOUNT",
        title: "WhatsApp Account Disabled",
        action: "HALT_WABA",
        solution: "WhatsApp Business Account has been disabled or suspended by Meta. Please check WhatsApp Manager for policy compliance notifications."
    },

    // ── Tier 2: Rate Limits & Capacity Controls ───────────────────────────────
    "130429": {
        severity: "WARNING",
        category: "RATE_LIMIT",
        title: "Throughput Rate Limit Hit",
        action: "PAUSE_QUEUE",
        solution: "API rate limit hit (TPS limit exceeded). The system auto-pauses the queue and applies an exponential backoff delay before resuming."
    },
    "80007": {
        severity: "WARNING",
        category: "RATE_LIMIT",
        title: "Daily Messaging Tier Cap Reached",
        action: "TIER_LIMIT",
        solution: "Your account reached its daily messaging tier limit (e.g. 1k, 10k, 100k messages/24h). Higher volume will resume automatically at 00:00 UTC."
    },
    "131056": {
        severity: "INFO",
        category: "RATE_LIMIT",
        title: "Per-User Marketing Rate Limit",
        action: "SKIP_NO_CHARGE",
        solution: "Recipient reached Meta's maximum daily marketing message limit. Message skipped with no credit charge."
    },

    // ── Tier 3: Ecosystem Protection & Delivery ──────────────────────────────
    "131049": {
        severity: "WARNING",
        category: "ECOSYSTEM",
        title: "Ecosystem Engagement Limit",
        action: "RETRY_24H",
        solution: "Auto-scheduled 24-hour retry hold (SCHEDULED_RETRY). Recipient hit Meta frequency cap. Recipient can also send 'Hi' to your WhatsApp number to unblock delivery immediately."
    },
    "131026": {
        severity: "ERROR",
        category: "DELIVERY",
        title: "Message Undeliverable",
        action: "MARK_UNDELIVERABLE",
        solution: "Message undeliverable. Phone number is not registered on WhatsApp, or user account is currently inactive."
    },
    "131047": {
        severity: "WARNING",
        category: "SESSION",
        title: "24-Hour Service Window Closed",
        action: "REQUIRE_TEMPLATE",
        solution: "The 24-hour customer service window has expired. Free-form text messages are blocked; you must send an approved template message."
    },

    // ── Tier 4: Template & Media Content ──────────────────────────────────────
    "131051": {
        severity: "ERROR",
        category: "TEMPLATE",
        title: "Template Not Found",
        action: "FIX_TEMPLATE",
        solution: "Specified template or language code does not exist in Meta account. Check template approval status in WhatsApp Manager."
    },
    "132001": {
        severity: "ERROR",
        category: "TEMPLATE",
        title: "Template Language Mismatch",
        action: "FIX_TEMPLATE",
        solution: "Template language code mismatch. Verify that the requested language code is approved in Meta Business Manager."
    },
    "132015": {
        severity: "WARNING",
        category: "TEMPLATE",
        title: "Template Paused by Meta",
        action: "PAUSED_TEMPLATE",
        solution: "Template paused by Meta due to low quality rating (high user block/report rate). Edit template content in Meta Manager to resume usage."
    },
    "132068": {
        severity: "ERROR",
        category: "TEMPLATE",
        title: "Variable Parameter Mismatch",
        action: "FIX_PARAMS",
        solution: "Parameter count or structure does not match template placeholders. Check variable mapping before launching campaign."
    }
};

/**
 * Get standardized error information and solution guidance for a given Meta error code
 */
export const getMetaErrorInfo = (code, rawMessage = "") => {
    const codeStr = String(code || "").trim();
    const catalogItem = META_ERROR_CATALOG[codeStr];

    if (catalogItem) {
        return {
            code: codeStr,
            title: catalogItem.title,
            severity: catalogItem.severity,
            category: catalogItem.category,
            action: catalogItem.action,
            rawMessage: rawMessage || `Meta API Error ${codeStr}`,
            solution: catalogItem.solution
        };
    }

    // Default Fallback
    return {
        code: codeStr || "UNKNOWN",
        title: "Meta API Error",
        severity: "ERROR",
        category: "GENERAL",
        action: "GENERIC_FAIL",
        rawMessage: rawMessage || "Message delivery failed via Meta Cloud API.",
        solution: "Message delivery failed via Meta Cloud API. Please check your WABA connection and recipient phone number format."
    };
};

export default META_ERROR_CATALOG;
