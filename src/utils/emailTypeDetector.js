/**
 * Production-grade email account classification utility.
 *
 * 3-layer detection:
 *   Layer 1 — Profile signals at OAuth login (this module)
 *   Layer 2 — Microsoft MailTips probe (handled in controller)
 *   Layer 3 — Self-adjusting 429 tracking (handled in worker)
 *
 * Returns:
 *   accountType  — "free" | "workplace"
 *   dailyLimit   — Estimated sending limit per 24h
 *   tier         — Granular tier identifier (e.g. "gmail_free", "m365_business")
 *   confidence   — "high" | "medium" | "low"
 *   limitSource  — "profile_detection" (initial source)
 */

// ─── Known free/consumer email domains ──────────────────────────────────────────
const FREE_EMAIL_DOMAINS = new Set([
    // Google
    "gmail.com",
    "googlemail.com",
    // Yahoo
    "yahoo.com",
    "yahoo.co.in",
    "yahoo.co.uk",
    "yahoo.co.jp",
    "yahoo.fr",
    "yahoo.de",
    "ymail.com",
    "rocketmail.com",
    // Microsoft consumer
    "outlook.com",
    "outlook.co.in",
    "outlook.co.uk",
    "outlook.fr",
    "outlook.de",
    "outlook.jp",
    "hotmail.com",
    "hotmail.co.uk",
    "hotmail.co.in",
    "hotmail.fr",
    "hotmail.de",
    "live.com",
    "live.co.uk",
    "live.in",
    "msn.com",
    // Apple
    "icloud.com",
    "me.com",
    "mac.com",
    // Others
    "aol.com",
    "protonmail.com",
    "proton.me",
    "zoho.com",
    "gmx.com",
    "gmx.de",
    "gmx.net",
    "mail.com",
    "yandex.com",
    "yandex.ru",
    "rediffmail.com",
    "tutanota.com",
    "tuta.io",
    "fastmail.com",
    "hey.com",
]);

// Subset that are specifically Microsoft consumer domains
const MICROSOFT_FREE_DOMAINS = new Set([
    "outlook.com",
    "outlook.co.in",
    "outlook.co.uk",
    "outlook.fr",
    "outlook.de",
    "outlook.jp",
    "hotmail.com",
    "hotmail.co.uk",
    "hotmail.co.in",
    "hotmail.fr",
    "hotmail.de",
    "live.com",
    "live.co.uk",
    "live.in",
    "msn.com",
]);

// ─── Daily sending limits by tier ───────────────────────────────────────────────
const TIER_LIMITS = {
    // Google
    gmail_free: 500,
    google_workspace: 2000,
    google_unknown: 500,
    // Microsoft
    outlook_free: 300,
    m365_basic: 5000,
    m365_business: 10000,
    microsoft_unknown: 300,
    // Custom SMTP
    custom_smtp: 500,
    // Fallback
    unknown: 500,
};

/**
 * Detects the full account info for an email connection.
 *
 * @param {string} email       — The email address
 * @param {string} provider    — "google" | "microsoft" | "custom"
 * @param {object} [profile]   — OAuth profile object (Google userinfo or Microsoft /me)
 * @returns {{ accountType: "free"|"workplace", dailyLimit: number, tier: string, confidence: "high"|"medium"|"low", limitSource: string }}
 */
export const detectEmailAccountInfo = (email, provider, profile = {}) => {
    const emailLower = (email || "").toLowerCase();
    const domain = emailLower.split("@")[1] || "";

    console.log("email - ", email)
    console.log("provider - ", provider)
    console.log("profile - ", profile)

    // ─── Custom SMTP ─────────────────────────────────────────────────────────────
    if (provider === "custom") {
        return {
            accountType: FREE_EMAIL_DOMAINS.has(domain) ? "free" : "workplace",
            dailyLimit: TIER_LIMITS.custom_smtp,
            tier: "custom_smtp",
            confidence: "low",
            limitSource: "profile_detection",
        };
    }

    // ─── Google ──────────────────────────────────────────────────────────────────
    if (provider === "google") {
        // Google Workspace accounts always have the `hd` (hosted domain) field
        if (profile?.hd) {
            return {
                accountType: "workplace",
                dailyLimit: TIER_LIMITS.google_workspace,
                tier: "google_workspace",
                // `medium` because we can't distinguish paid Workspace (2000) from trial (500)
                confidence: "medium",
                limitSource: "profile_detection",
            };
        }

        // Known free Gmail domain
        if (FREE_EMAIL_DOMAINS.has(domain)) {
            return {
                accountType: "free",
                dailyLimit: TIER_LIMITS.gmail_free,
                tier: "gmail_free",
                confidence: "high",
                limitSource: "profile_detection",
            };
        }

        // Custom domain without `hd` — unusual; treat cautiously
        return {
            accountType: "workplace",
            dailyLimit: TIER_LIMITS.google_unknown,
            tier: "google_unknown",
            confidence: "low",
            limitSource: "profile_detection",
        };
    }

    // ─── Microsoft ───────────────────────────────────────────────────────────────
    if (provider === "microsoft") {
        const isFreeConsumerDomain = MICROSOFT_FREE_DOMAINS.has(domain);

        // Signal 1: Known free consumer domain
        if (isFreeConsumerDomain) {
            return {
                accountType: "free",
                dailyLimit: TIER_LIMITS.outlook_free,
                tier: "outlook_free",
                confidence: "high",
                limitSource: "profile_detection",
            };
        }

        // Signal 2: M365 Business/Enterprise indicators from profile
        // M365 accounts have `mail` field populated + organizational metadata
        const hasMail = !!profile?.mail;
        const hasOrgSignals = !!(profile?.jobTitle || profile?.officeLocation || (profile?.businessPhones?.length > 0));

        if (hasMail && hasOrgSignals) {
            return {
                accountType: "workplace",
                dailyLimit: TIER_LIMITS.m365_business,
                tier: "m365_business",
                confidence: "medium",
                limitSource: "profile_detection",
            };
        }

        // Signal 3: `mail` field present but no org metadata → likely M365 Basic
        if (hasMail) {
            return {
                accountType: "workplace",
                dailyLimit: TIER_LIMITS.m365_basic,
                tier: "m365_basic",
                confidence: "low",
                limitSource: "profile_detection",
            };
        }

        // Signal 4: Custom domain but no M365 signals (mail is null)
        // `mail` being null is a strong indicator of a free consumer account,
        // even on a custom domain (Microsoft allows custom domains on free Outlook)
        if (!hasMail && !FREE_EMAIL_DOMAINS.has(domain)) {
            return {
                accountType: "workplace",
                dailyLimit: TIER_LIMITS.microsoft_unknown,
                tier: "microsoft_unknown",
                confidence: "low",
                limitSource: "profile_detection",
            };
        }

        // Fallback
        return {
            accountType: "free",
            dailyLimit: TIER_LIMITS.outlook_free,
            tier: "outlook_free",
            confidence: "low",
            limitSource: "profile_detection",
        };
    }

    // ─── Fallback ────────────────────────────────────────────────────────────────
    return {
        accountType: FREE_EMAIL_DOMAINS.has(domain) ? "free" : "workplace",
        dailyLimit: TIER_LIMITS.unknown,
        tier: "unknown",
        confidence: "low",
        limitSource: "profile_detection",
    };
};

/**
 * Backward-compatible wrapper — returns just "free" | "workplace".
 *
 * @param {string} email
 * @param {string} provider
 * @param {object} [profile]
 * @returns {"free" | "workplace"}
 */
export const detectEmailAccountType = (email, provider, profile = {}) => {
    return detectEmailAccountInfo(email, provider, profile).accountType;
};

/**
 * Refines an existing account's tier/limit based on Microsoft MailTips data.
 * Call this after the MailTips probe to upgrade confidence.
 *
 * @param {object} currentInfo   — Result from detectEmailAccountInfo()
 * @param {number} maxMessageSize — maxMessageSize from MailTips (bytes)
 * @returns {object} Updated info with refined tier/limit if applicable
 */
export const refineWithMailTips = (currentInfo, maxMessageSize) => {
    if (!maxMessageSize || currentInfo.confidence === "high") {
        return currentInfo; // No refinement needed
    }

    // Free Outlook: max 20 MB (20971520 bytes)
    // M365 Business: max 35 MB (36700160 bytes) or 150 MB for some Enterprise plans
    const FREE_MAX_SIZE = 20 * 1024 * 1024;      // 20 MB
    const M365_MIN_SIZE = 25 * 1024 * 1024;       // 25 MB threshold

    if (maxMessageSize <= FREE_MAX_SIZE) {
        return {
            ...currentInfo,
            accountType: "free",
            dailyLimit: TIER_LIMITS.outlook_free,
            tier: "outlook_free",
            confidence: "high",
            limitSource: "mailtips_probe",
        };
    }

    if (maxMessageSize >= M365_MIN_SIZE) {
        // Large message limit confirms M365
        const tier = maxMessageSize >= 150 * 1024 * 1024
            ? "m365_business"    // Enterprise-level (150 MB)
            : "m365_business";   // Standard M365 (35 MB)

        return {
            ...currentInfo,
            accountType: "workplace",
            dailyLimit: TIER_LIMITS[tier],
            tier,
            confidence: "high",
            limitSource: "mailtips_probe",
        };
    }

    return currentInfo; // Ambiguous size, keep existing detection
};

/**
 * Returns the tier-based daily limit for a given tier string.
 * Useful for lookups without running full detection.
 *
 * @param {string} tier
 * @returns {number}
 */
export const getTierDailyLimit = (tier) => {
    return TIER_LIMITS[tier] ?? TIER_LIMITS.unknown;
};
