import axios from "axios";
import EmailToken from "../../../models/Campaign/EmailCampaign/emailTokenSchema.js";
import { encrypt, decrypt } from "../../../utils/encryptionForMail.js";
import config from "../../../config/config.js";
import { verifyRefreshToken } from "../../../utils/jwt.js";
import jwt from "jsonwebtoken";
import { scheduleTokenExpiryJob, cancelTokenExpiryJob } from "../../../jobs/emailTokenSync.job.js";
import { detectEmailAccountInfo, refineWithMailTips } from "../../../utils/emailTypeDetector.js";
import { autoResumePausedCampaigns } from "../../../utils/resumeCampaignsHelper.js";

// Use 'common' to allow any Microsoft account
const TENANT_ID = "common";
const MICROSOFT_BASE_URL = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0`;
const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";

// Constants
const TOKEN_REFRESH_BUFFER = 5 * 60 * 1000; // 5 minutes
const MAX_ACCOUNTS_PER_USER = 10;


/**
 * OAuth Config with validation
 */
const getMicrosoftOAuthParams = () => {
    const {
        BORADE_MICROSOFT_CLIENT_ID,
        BORADE_MICROSOFT_CLIENT_SECRET,
        BORADE_MICROSOFT_REDIRECT_URI
    } = config;

    if (!BORADE_MICROSOFT_CLIENT_ID || !BORADE_MICROSOFT_CLIENT_SECRET || !BORADE_MICROSOFT_REDIRECT_URI) {
        throw new Error("Microsoft OAuth configuration is incomplete");
    }

    return {
        clientId: BORADE_MICROSOFT_CLIENT_ID,
        clientSecret: BORADE_MICROSOFT_CLIENT_SECRET,
        redirectUri: BORADE_MICROSOFT_REDIRECT_URI,
        tenantId: TENANT_ID,
    };
};

/**
 * Validate user authentication
 */
const validateUserAuth = (req) => {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
        throw new Error("MISSING_AUTH");
    }

    const payload = verifyRefreshToken(refreshToken);
    if (!payload?.id) {
        throw new Error("INVALID_AUTH");
    }

    return payload.id;
};

const buildEmailCampaignRedirect = ({ isApk, success, error }) => {
    if (isApk) {
        const params = new URLSearchParams({ route: "/emailcampaign" });
        if (success) params.set("success", success);
        if (error) params.set("error", error);
        return `boradeai://callback?${params.toString()}`;
    }
    const params = new URLSearchParams();
    if (success) params.set("success", success);
    if (error) params.set("error", error);
    return `${config.FRONTEND_BASE_URL}/emailcampaign${params.toString() ? `?${params.toString()}` : ""}`;
};


/**
 * =========================
 * STEP 1 — Redirect to Microsoft
 * =========================
 */
export const microsoftConnect = async (req, res) => {
    try {
        const userId = validateUserAuth(req);

        // Check account limit
        const accountCount = await EmailToken.countDocuments({
            userId,
            provider: "microsoft",
            isActive: true,
        });

        if (accountCount >= MAX_ACCOUNTS_PER_USER) {
            return res.status(400).json({
                message: `Maximum ${MAX_ACCOUNTS_PER_USER} Microsoft accounts allowed`,
                code: "MAX_ACCOUNTS_REACHED"
            });
        }

        const { clientId, redirectUri } = getMicrosoftOAuthParams();
        const isApk = String(req.query?.apk || "").trim() === "1";

        const refreshToken = req.cookies?.refreshToken;
        if (!refreshToken) {
            return res.status(401).json({ message: "Authentication missing" });
        }

        const payload = verifyRefreshToken(refreshToken);
        if (!payload?.id) {
            return res.status(401).json({ message: "Invalid authentication token" });
        }

        // Secure state token
        const state = jwt.sign(
            { userId, isApk, timestamp: Date.now() },
            config.JWT_SECRET,
            { expiresIn: config.MAIL_COMAPAIGN_CONNECT_TOKEN_EXPIRY }
        );

        const authUrl = new URL(`${MICROSOFT_BASE_URL}/authorize`);
        authUrl.searchParams.append("client_id", clientId);
        authUrl.searchParams.append("response_type", "code");
        authUrl.searchParams.append("redirect_uri", redirectUri);
        authUrl.searchParams.append("response_mode", "query");
        authUrl.searchParams.append("scope", "openid profile email offline_access User.Read Mail.Send");
        authUrl.searchParams.append("state", state);
        authUrl.searchParams.append("prompt", "select_account"); // Always show account picker

        console.log(`[Microsoft OAuth] Initiating connection for user ${userId} with tenant: ${TENANT_ID}`);

        return res.redirect(authUrl.toString());
    } catch (error) {
        console.error("[Microsoft OAuth] Connect error:", {
            message: error.message,
            stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
        });

        if (error.message === "MISSING_AUTH" || error.message === "INVALID_AUTH") {
            return res.status(401).json({
                message: "Authentication required",
                code: error.message
            });
        }

        return res.status(500).json({
            message: "Failed to initiate Microsoft OAuth",
            code: "OAUTH_INIT_FAILED"
        });
    }
};

/**
 * =========================
 * STEP 2 — Callback Handler
 * =========================
 */
export const microsoftCallback = async (req, res) => {
    const { code, state, error, error_description } = req.query;

    // Handle OAuth errors
    if (error) {
        console.error("[Microsoft OAuth] User denied or error:", {
            error,
            description: error_description
        });
        return res.redirect(buildEmailCampaignRedirect({ isApk: false, error: `access_denied&details=${encodeURIComponent(error_description || error)}` }));
    }

    if (!code || !state) return res.redirect(buildEmailCampaignRedirect({ isApk: false, error: "invalid_callback" }));

    let userId;
    let isApk = false;

    // Verify state token
    try {
        const decoded = jwt.verify(state, config.JWT_SECRET);
        userId = decoded.userId;
        isApk = Boolean(decoded?.isApk);

        if (!userId) {
            throw new Error("Missing userId in state");
        }
    } catch (err) {
        console.error("[Microsoft OAuth] Invalid state token:", err.message);
        return res.redirect(buildEmailCampaignRedirect({ isApk: false, error: "invalid_state" }));
    }

    try {
        const { clientId, clientSecret, redirectUri } = getMicrosoftOAuthParams();

        // Exchange authorization code for tokens
        const tokenResponse = await axios.post(
            `${MICROSOFT_BASE_URL}/token`,
            new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                code,
                redirect_uri: redirectUri,
                grant_type: "authorization_code",
            }),
            {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                timeout: 10000,
                validateStatus: (status) => status < 500,
            }
        );

        if (tokenResponse.status !== 200) {
            console.error("[Microsoft OAuth] Token exchange failed:", {
                status: tokenResponse.status,
                error: tokenResponse.data?.error,
                description: tokenResponse.data?.error_description,
            });

            return res.redirect(buildEmailCampaignRedirect({ isApk, error: "token_exchange_failed" }));
        }

        const tokens = tokenResponse.data;

        // Validate refresh token
        if (!tokens.refresh_token) {
            console.error("[Microsoft OAuth] No refresh token - check offline_access scope");
            return res.redirect(buildEmailCampaignRedirect({ isApk, error: "no_refresh_token" }));
        }

        // Fetch user profile
        let profileResponse;
        try {
            profileResponse = await axios.get(`${GRAPH_BASE_URL}/me`, {
                headers: {
                    Authorization: `Bearer ${tokens.access_token}`,
                },
                timeout: 10000,
            });
        } catch (profileError) {
            console.error("[Microsoft OAuth] Profile fetch failed:", profileError.message);
            return res.redirect(buildEmailCampaignRedirect({ isApk, error: "profile_fetch_failed" }));
        }

        const profile = profileResponse.data;
        const email = profile.mail || profile.userPrincipalName;

        if (!email) {
            console.error("[Microsoft OAuth] No email in profile");
            return res.redirect(buildEmailCampaignRedirect({ isApk, error: "no_email" }));
        }

        let refreshTokenToSave = tokens.refresh_token ? encrypt(tokens.refresh_token) : null;

        if (!refreshTokenToSave) {
            const existingToken = await EmailToken.findOne({
                provider: "microsoft",
                email: email.toLowerCase(),
            }).sort({ createdAt: -1 });

            if (existingToken && existingToken.refreshToken) {
                refreshTokenToSave = existingToken.refreshToken;
                console.log(`[Microsoft OAuth] Reused existing refresh token for ${email}`);
            }
        }

        if (!refreshTokenToSave) {
            console.error("[Microsoft OAuth] No refresh token returned by Microsoft and none found in DB");
            return res.redirect(buildEmailCampaignRedirect({ isApk, error: "no_refresh_token" }));
        }

        // Extract domain for logging
        const domain = email.split('@')[1];

        // ─── Layer 1: Profile-based account detection ────────────────────────────
        const expiresAt = new Date(Date.now() + (tokens.expires_in * 1000));
        let accountInfo = detectEmailAccountInfo(email, "microsoft", profile);

        // ─── Layer 2: MailTips probe to refine tier via maxMessageSize ────────────
        // Free Outlook = 20 MB, M365 Business = 35 MB, M365 Enterprise = up to 150 MB
        try {
            const mailTipsResponse = await axios.post(
                `${GRAPH_BASE_URL}/me/getMailTips`,
                {
                    EmailAddresses: [email],
                    MailTipsOptions: "maxMessageSize",
                },
                {
                    headers: {
                        Authorization: `Bearer ${tokens.access_token}`,
                        "Content-Type": "application/json",
                    },
                    timeout: 8000,
                    validateStatus: (status) => status < 500,
                }
            );

            if (mailTipsResponse.status === 200 && mailTipsResponse.data?.value?.length > 0) {
                const maxMessageSize = mailTipsResponse.data.value[0]?.maxMessageSize;
                if (maxMessageSize) {
                    const refined = refineWithMailTips(accountInfo, maxMessageSize);
                    console.log(`[Microsoft OAuth] MailTips probe - maxMessageSize: ${maxMessageSize} bytes, tier refined: ${accountInfo.tier} → ${refined.tier}`);
                    accountInfo = refined;
                }
            }
        } catch (mailTipsErr) {
            // Non-blocking — MailTips may not be available for all account types
            console.warn(`[Microsoft OAuth] MailTips probe failed (non-blocking): ${mailTipsErr.message}`);
        }

        const { accountType, dailyLimit, tier, confidence: limitConfidence, limitSource } = accountInfo;

        const metadata = {
            displayName: profile.displayName || email,
            profilePhoto: profile.photo || null,
            domain,
            msAccountType: profile.userPrincipalName?.includes('#EXT#') ? 'external' : 'native',
            jobTitle: profile.jobTitle || null,
            officeLocation: profile.officeLocation || null,
        };

        let tokenRecord = await EmailToken.findOne({
            userId,
            provider: "microsoft",
            email: email.toLowerCase()
        });

        if (tokenRecord) {
            tokenRecord.accountType = accountType;
            tokenRecord.tier = tier;
            tokenRecord.accessToken = encrypt(tokens.access_token);
            tokenRecord.refreshToken = refreshTokenToSave;
            tokenRecord.expiresAt = expiresAt;
            tokenRecord.scope = tokens.scope;
            tokenRecord.isActive = true;
            tokenRecord.status = "active";
            tokenRecord.dailyLimit = dailyLimit;
            tokenRecord.limitConfidence = limitConfidence;
            tokenRecord.limitSource = limitSource;
            tokenRecord.metadata = metadata;
            tokenRecord.lastUsedAt = new Date();
            await tokenRecord.save();
            console.log(`[Microsoft OAuth] Updated existing token record for ${email} (User: ${userId})`);
        } else {
            tokenRecord = await EmailToken.create({
                userId,
                provider: "microsoft",
                accountType,
                tier,
                email: email.toLowerCase(),
                accessToken: encrypt(tokens.access_token),
                refreshToken: refreshTokenToSave,
                expiresAt,
                scope: tokens.scope,
                isActive: true,
                status: "active",
                dailyLimit,
                limitConfidence,
                limitSource,
                metadata,
                lastUsedAt: new Date(),
            });
            console.log(`[Microsoft OAuth] Created new token record for ${email} (User: ${userId})`);
        }

        // Parse the dynamic expiry config string (e.g., "7d", "1h") into milliseconds
        const parseExpiryToMs = (str) => {
            if (!str) return 7 * 24 * 60 * 60 * 1000;
            const match = str.match(/^(\d+)([smhd])$/);
            if (!match) return 7 * 24 * 60 * 60 * 1000;
            const val = parseInt(match[1], 10);
            const unit = match[2];
            if (unit === 'd') return val * 24 * 60 * 60 * 1000;
            if (unit === 'h') return val * 60 * 60 * 1000;
            if (unit === 'm') return val * 60 * 1000;
            if (unit === 's') return val * 1000;
            return 7 * 24 * 60 * 60 * 1000;
        };

        // Schedule expiry job for dynamic session expiry instead of access token expiry
        try {
            const expiryMs = parseExpiryToMs(config.MAIL_COMAPAIGN_CONNECT_TOKEN_EXPIRY);
            const sessionExpiresAt = new Date(Date.now() + expiryMs);
            await scheduleTokenExpiryJob(userId.toString(), email.toLowerCase(), "microsoft", sessionExpiresAt);
        } catch (agendaErr) {
            console.error("[Agenda] Failed to schedule token expiry job:", agendaErr.message);
        }

        console.log(`[Microsoft OAuth] Successfully connected - User: ${userId}, Email: ${email}, Domain: ${domain}, Tier: ${tier}, DailyLimit: ${dailyLimit}, Confidence: ${limitConfidence}, Tenant: ${TENANT_ID}`);

        await autoResumePausedCampaigns(userId);
        return res.redirect(buildEmailCampaignRedirect({ isApk, success: "microsoft_connected" }));
    } catch (err) {
        console.error("[Microsoft OAuth] Callback error:", {
            message: err.message,
            stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
        });

        return res.redirect(buildEmailCampaignRedirect({ isApk, error: "auth_failed" }));
    }
};

/**
 * =========================
 * Get All Connected Microsoft Accounts
 * =========================
 */
export const getMicrosoftAccounts = async (req, res) => {
    try {
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
            });
        }

        const accounts = await EmailToken.find({
            userId,
            provider: "microsoft",
        })
            .select("email status isActive metadata createdAt lastUsedAt")
            .sort({ createdAt: -1 })
            .lean();

        return res.json({
            success: true,
            accounts: accounts.map(acc => ({
                email: acc.email,
                domain: acc.metadata?.domain,
                displayName: acc.metadata?.displayName || acc.email,
                accountType: acc.metadata?.accountType || 'unknown',
                isActive: acc.isActive,
                status: acc.status || (acc.isActive ? 'active' : 'expired'),
                connectedAt: acc.createdAt,
                lastUsed: acc.lastUsedAt,
            })),
            total: accounts.length,
            maxAllowed: MAX_ACCOUNTS_PER_USER,
        });
    } catch (err) {
        console.error("[Microsoft OAuth] Get accounts error:", err.message);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch Microsoft accounts",
        });
    }
};

/**
 * =========================
 * Disconnect Specific Account
 * =========================
 */
export const microsoftDisconnect = async (req, res) => {
    try {
        const userId = req.user?.id;

        if (!req.body) {
            return res.status(400).json({ success: false, message: "Request body missing" });
        }

        const { email } = req.body;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
            });
        }

        if (!email) {
            return res.status(400).json({
                success: false,
                message: "Email address is required",
            });
        }

        const result = await EmailToken.findOneAndUpdate(
            {
                userId,
                provider: "microsoft",
                email: email.toLowerCase(),
            },
            {
                isActive: false,
                status: "disconnected"
            },
            { new: true }
        );

        if (!result) {
            return res.status(404).json({
                success: false,
                message: "Microsoft account not found",
            });
        }

        // Cancel scheduled expiry job in background
        cancelTokenExpiryJob(userId, email, "microsoft");

        console.log(`[Microsoft OAuth] Disconnected - User: ${userId}, Email: ${email}`);

        return res.json({
            success: true,
            message: "Microsoft account disconnected",
            email: result.email,
        });
    } catch (err) {
        console.error("[Microsoft OAuth] Disconnect error:", err.message);
        return res.status(500).json({
            success: false,
            message: "Failed to disconnect Microsoft account",
        });
    }
};

/**
 * =========================
 * Get Valid Access Token (Auto Refresh)
 * =========================
 */
export const getValidMicrosoftToken = async (userId, email = null) => {
    try {
        const query = {
            userId,
            provider: "microsoft",
        };

        if (email) {
            query.email = email.toLowerCase();
        }

        const record = await EmailToken.findOne(query).sort({ lastUsedAt: -1 });

        if (!record) {
            throw new Error(
                email
                    ? `No Microsoft account found for: ${email}`
                    : `No Microsoft account found for user ${userId}`
            );
        }

        // If explicitly inactive, don't even try
        if (!record.isActive) {
            throw new Error("RECONNECT_REQUIRED");
        }

        // Check if refresh needed (5 mins buffer)
        const needsRefresh = new Date() >= new Date(record.expiresAt.getTime() - TOKEN_REFRESH_BUFFER);

        if (!needsRefresh) {
            record.lastUsedAt = new Date();
            record.status = "active";
            await record.save();

            return {
                accessToken: decrypt(record.accessToken),
                email: record.email,
                domain: record.metadata?.domain,
            };
        }

        // Refresh token
        const { clientId, clientSecret } = getMicrosoftOAuthParams();

        try {
            const tokenResponse = await axios.post(
                `${MICROSOFT_BASE_URL}/token`,
                new URLSearchParams({
                    client_id: clientId,
                    client_secret: clientSecret,
                    refresh_token: decrypt(record.refreshToken),
                    grant_type: "refresh_token",
                }),
                {
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                    timeout: 10000,
                    validateStatus: (status) => status < 500,
                }
            );

            if (tokenResponse.status !== 200) {
                const errorData = tokenResponse.data;
                console.error("[Microsoft OAuth] Refresh failed:", {
                    email: record.email,
                    error: errorData?.error,
                    description: errorData?.error_description,
                });

                // Handle specific error codes that require re-authentication
                const fatalErrors = ["invalid_grant", "interaction_required", "login_required", "account_selection_required"];

                if (fatalErrors.includes(errorData?.error)) {
                    record.isActive = false;
                    record.status = "expired";
                    await record.save();
                    throw new Error("RECONNECT_REQUIRED");
                }

                record.status = "error";
                await record.save();
                throw new Error(`Token refresh failed: ${errorData?.error_description || errorData?.error}`);
            }

            const newTokens = tokenResponse.data;

            record.accessToken = encrypt(newTokens.access_token);
            record.expiresAt = new Date(Date.now() + (newTokens.expires_in * 1000));
            record.lastUsedAt = new Date();
            record.status = "active";
            record.isActive = true;

            if (newTokens.refresh_token) {
                record.refreshToken = encrypt(newTokens.refresh_token);
            }

            await record.save();

            console.log(`[Microsoft OAuth] Token refreshed for ${record.email}`);

            return {
                accessToken: newTokens.access_token,
                email: record.email,
                domain: record.metadata?.domain,
            };
        } catch (refreshErr) {
            if (refreshErr.message === "RECONNECT_REQUIRED") throw refreshErr;

            console.error(`[Microsoft OAuth] Refresh network/other error:`, refreshErr.message);
            record.status = "error";
            await record.save();
            throw refreshErr;
        }
    } catch (error) {
        console.error("[Microsoft OAuth] Token validation error:", {
            message: error.message,
            userId,
            email,
        });
        throw error;
    }
};

/**
 * =========================
 * Get All Valid Tokens
 * =========================
 */
export const getAllValidMicrosoftTokens = async (userId) => {
    const accounts = await EmailToken.find({
        userId,
        provider: "microsoft",
        isActive: true,
    }).sort({ lastUsedAt: -1 });

    const tokens = [];

    for (const account of accounts) {
        try {
            const tokenData = await getValidMicrosoftToken(userId, account.email);
            tokens.push(tokenData);
        } catch (error) {
            console.error(`[Microsoft OAuth] Failed for ${account.email}:`, error.message);
        }
    }

    return tokens;
};