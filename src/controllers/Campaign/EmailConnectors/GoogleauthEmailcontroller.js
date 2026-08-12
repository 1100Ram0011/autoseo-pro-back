import { google } from "googleapis";
import nodemailer from "nodemailer";
import EmailToken from "../../../models/Campaign/EmailCampaign/emailTokenSchema.js";
import { encrypt, decrypt } from "../../../utils/encryptionForMail.js";
import config from "../../../config/config.js";
import { verifyRefreshToken } from "../../../utils/jwt.js";
import jwt from "jsonwebtoken";
import { getValidMicrosoftToken } from "./Microsoftauthcontroller.js";
import axios from "axios";
import userModel from "../../../models/userModel.js";
import { autoResumePausedCampaigns } from "../../../utils/resumeCampaignsHelper.js";
import { generateToken } from "../../../utils/generateToken.js";
// import { signAccessToken } from '../../../utils/jwt.js'  
import CryptoJS from 'crypto-js'
import { agenda } from "../../../jobs/agenda/agenda.js";
import { scheduleTokenExpiryJob, cancelTokenExpiryJob } from "../../../jobs/emailTokenSync.job.js";
import { detectEmailAccountInfo } from "../../../utils/emailTypeDetector.js";

const getOAuthClient = () => {
    return new google.auth.OAuth2(
        config.GOOGLE_CLIENT_ID_FOR_OAUTH,
        config.GOOGLE_CLIENT_SECRET_FOR_OAUTH,
        config.GOOGLE_REDIRECT_URI_FOR_OAUTH
    );
};

const getOAuthClientForApk = () => {
    return new google.auth.OAuth2(
        config.GOOGLE_CLIENT_ID_FOR_OAUTH,
        config.GOOGLE_CLIENT_SECRET_FOR_OAUTH,
        config.GOOGLE_REDIRECT_URI_FOR_OAUTH_APK
    );
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
 * STEP 1 — Redirect to Google
 */
export const googleConnect = (req, res) => {
    try {
        const oauth2Client = getOAuthClient();
        const isApk = String(req.query?.apk || "").trim() === "1";

        const refreshToken = req.cookies?.refreshToken;


        if (!refreshToken) {
            return res.status(401).json({ message: "Auth missing" });
        }

        const payload = verifyRefreshToken(refreshToken);
        if (!payload?.id) {
            return res.status(401).json({ message: "Invalid token" });
        }

        // Signed JWT state (secure)
        const state = jwt.sign(
            { userId: payload.id, isApk },
            config.JWT_SECRET,
            { expiresIn: config.MAIL_COMAPAIGN_CONNECT_TOKEN_EXPIRY }
        );

        const authUrl = oauth2Client.generateAuthUrl({
            access_type: "offline",
            prompt: "select_account consent",
            scope: [
                "https://www.googleapis.com/auth/gmail.send",
                "https://www.googleapis.com/auth/userinfo.email",
                "https://www.googleapis.com/auth/userinfo.profile",
                "openid",
            ],
            state,
        });

        res.redirect(authUrl);
    } catch (err) {
        console.error("[Google OAuth] Connect error:", err.message);
        res.status(500).json({ message: "Failed to initiate Google OAuth" });
    }
};

/**
 * STEP 2 — Google Callback
 */
export const googleCallback = async (req, res) => {
    const { code, state, error } = req.query;

    console.log("[Google OAuth] Callback req.query:", req.query);

    if (error) return res.redirect(buildEmailCampaignRedirect({ isApk: false, error: "access_denied" }));

    if (!code || !state) return res.redirect(buildEmailCampaignRedirect({ isApk: false, error: "invalid_callback" }));

    let userId;
    let isApk = false;

    try {
        // ✅ Verify JWT state (NOT base64 decode)
        const decoded = jwt.verify(state, config.JWT_SECRET);
        userId = decoded.userId;
        isApk = Boolean(decoded?.isApk);
    } catch (err) {
        return res.redirect(buildEmailCampaignRedirect({ isApk: false, error: "invalid_state" }));
    }

    try {
        const oauth2Client = getOAuthClient();

        // Exchange code for tokens
        const { tokens } = await oauth2Client.getToken(code);

        console.log("[Google OAuth] Raw Tokens object:", JSON.stringify(tokens, null, 2));

        if (!tokens.refresh_token) {
            return res.redirect(buildEmailCampaignRedirect({ isApk, error: "no_refresh_token" }));
        }

        oauth2Client.setCredentials(tokens);

        // Get user email
        const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
        const userinfoRes = await oauth2.userinfo.get();
        console.log("[Google OAuth] Full Userinfo Response:", JSON.stringify(userinfoRes, null, 2));

        const profile = userinfoRes.data;

        let refreshTokenToSave = tokens.refresh_token ? encrypt(tokens.refresh_token) : null;

        if (!refreshTokenToSave) {
            // Search if an existing EmailToken has a refresh token saved for this email address
            const existingToken = await EmailToken.findOne({
                provider: "google",
                email: profile.email.toLowerCase(),
            }).sort({ createdAt: -1 });

            if (existingToken && existingToken.refreshToken) {
                refreshTokenToSave = existingToken.refreshToken;
                console.log(`[Google OAuth] Reused existing refresh token for ${profile.email}`);
            }
        }

        if (!refreshTokenToSave) {
            console.error(`[Google OAuth] No refresh token returned and none found in DB for ${profile.email}`);
            return res.redirect(buildEmailCampaignRedirect({ isApk, error: "no_refresh_token" }));
        }

        let idTokenDecoded = null;
        try {
            if (tokens.id_token) {
                idTokenDecoded = jwt.decode(tokens.id_token);
                console.log("[Google OAuth] Decoded ID Token payload:", JSON.stringify(idTokenDecoded, null, 2));
            }
        } catch (jwtErr) {
            console.error("[Google OAuth] Failed to decode id_token:", jwtErr.message);
        }

        const combinedProfile = { ...profile, ...(idTokenDecoded || {}) };
        const accountInfo = detectEmailAccountInfo(profile.email, "google", combinedProfile);
        const { accountType, dailyLimit, tier, confidence: limitConfidence, limitSource } = accountInfo;

        console.log("[Google OAuth] Connected Email Details:", {
            email: profile.email,
            name: combinedProfile.name,
            picture: combinedProfile.picture,
            hostedDomain: combinedProfile.hd,
            accountType,
            tier,
            dailyLimit,
            limitConfidence,
            limitSource,
            scopes: tokens.scope,
            tokenExpiry: new Date(tokens.expiry_date).toLocaleString(),
        });

        const metadata = {
            name: combinedProfile.name || null,
            picture: combinedProfile.picture || null,
            hd: combinedProfile.hd || null,
            locale: combinedProfile.locale || null,
            verifiedEmail: combinedProfile.verified_email || combinedProfile.email_verified || null,
        };

        const expiresAt = new Date(tokens.expiry_date);

        let tokenRecord = await EmailToken.findOne({
            userId,
            provider: "google",
            email: profile.email.toLowerCase()
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
            console.log(`[Google OAuth] Updated existing token record for ${profile.email} (User: ${userId})`);
        } else {
            tokenRecord = await EmailToken.create({
                userId,
                provider: "google",
                accountType,
                tier,
                email: profile.email.toLowerCase(),
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
            console.log(`[Google OAuth] Created new token record for ${profile.email} (User: ${userId})`);
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
        // try {
        //     const expiryMs = parseExpiryToMs(config.MAIL_COMAPAIGN_CONNECT_TOKEN_EXPIRY);
        //     const sessionExpiresAt = new Date(Date.now() + expiryMs);
        //     await scheduleTokenExpiryJob(userId.toString(), profile.email, "google", sessionExpiresAt);
        // } catch (agendaErr) {
        //     console.error("[Agenda] Failed to schedule token expiry job:", agendaErr.message);
        // }

        await autoResumePausedCampaigns(userId);
        return res.redirect(buildEmailCampaignRedirect({ isApk, success: "google_connected" }));
    } catch (err) {
        console.error("[Google OAuth] Callback error:", err.message);
        return res.redirect(buildEmailCampaignRedirect({ isApk, error: "auth_failed" }));
    }
};

export const googleapkCallback = async (req, res) => {
    try {
        const code = req.query.code
        const oauth2Client = getOAuthClientForApk()
        const { tokens } = await oauth2Client.getToken(code)
        oauth2Client.setCredentials(tokens)

        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
        const { data: profile } = await oauth2.userinfo.get()

        console.log("[Google APK OAuth] Received tokens:", JSON.stringify(tokens, null, 2));
        console.log("[Google APK OAuth] Received profile:", JSON.stringify(profile, null, 2));

        let user = await userModel.findOne({ email: profile.email })
        if (!user) {
            user = await userModel.create({
                email: profile.email,
                name: profile.name,
            })
        }

        console.log("[Google APK OAuth] User record:", JSON.stringify(user, null, 2));

        const accessToken = generateToken(user)

        const userObj = {
            _id: user._id,
            email: user.email,
            name: user.name,
            role: user.role || 'user',
        }

        // ✅ Encrypt with the SAME key your frontend uses
        const encryptedUser = CryptoJS.AES.encrypt(
            JSON.stringify(userObj),
            process.env.CREDENTIAL_ENCRYPTION_KEY  // same key as frontend
        ).toString()

        // ✅ Base64 encode the encrypted string so it's URL-safe
        const userPayload = Buffer.from(encryptedUser).toString('base64')

        return res.redirect(
            `boradeai://callback?success=true&token=${accessToken}&user=${encodeURIComponent(userPayload)}`
        )

    } catch (err) {
        console.error('[Google OAuth] APK Callback error:', err.message)
        return res.redirect(`https://ai.mytek.in/apk/login?error=auth_failed`)
    }
}

/**
 * Disconnect Google
 */
export const googleDisconnect = async (req, res) => {
    try {
        if (!req.body) {
            return res.status(400).json({ success: false, message: "Request body missing" });
        }
        const { email } = req.body;
        const userId = req.user.id;

        if (!email) {
            return res.status(400).json({ message: "Email is required" });
        }

        const token = await EmailToken.findOne({
            userId,
            provider: "google",
            email: email.toLowerCase(),
        });

        if (token) {
            try {
                const oauth2Client = getOAuthClient();
                oauth2Client.setCredentials({
                    access_token: decrypt(token.accessToken),
                });
                // run in background to speed up disconnect API
                oauth2Client.revokeCredentials().catch(err => {
                    console.error("[Google OAuth] Token revocation failed in background:", err.message);
                });
            } catch (revokeErr) {
                console.error("[Google OAuth] Token revocation failed:", revokeErr.message);
            }

            token.isActive = false;
            token.status = "disconnected";
            await token.save();

            // Cancel scheduled expiry job in background
            cancelTokenExpiryJob(userId, email, "google");

            console.log(`[Google OAuth] Disconnected - User: ${userId}, Email: ${email}`);
        }

        res.json({ success: true, message: "Google account disconnected", email });
    } catch (err) {
        console.error("[Google OAuth] Disconnect error:", err.message);
        res.status(500).json({ success: false, message: "Failed to disconnect" });
    }
};

/**
 * Get Valid Access Token (Auto Refresh)
 */
export const getValidGoogleToken = async (userId, email = null) => {
    const query = {
        userId,
        provider: "google",
    };

    if (email) {
        query.email = email.toLowerCase();
    }

    const record = await EmailToken.findOne(query).sort({ lastUsedAt: -1 });

    if (!record) throw new Error(`No Google token found for user ${userId}`);

    if (!record.isActive) {
        throw new Error("RECONNECT_REQUIRED");
    }

    const oauth2Client = getOAuthClient();

    oauth2Client.setCredentials({
        access_token: decrypt(record.accessToken),
        refresh_token: decrypt(record.refreshToken),
    });

    try {
        const { token, res } = await oauth2Client.getAccessToken();

        // If a new access token was issued (e.g. it was expired)
        if (res && res.data && res.data.access_token) {
            record.accessToken = encrypt(res.data.access_token);
            if (res.data.expiry_date) {
                record.expiresAt = new Date(res.data.expiry_date);
            }
            record.status = "active";
            record.lastUsedAt = new Date();
            await record.save();
        }

        return {
            accessToken: token,
            email: record.email,
            oauth2Client,
        };
    } catch (err) {
        console.error("[Google OAuth] Refresh error:", err.message);

        // Handle invalid_grant etc
        if (err.message.includes("invalid_grant") || err.message.includes("revoked")) {
            record.isActive = false;
            record.status = "expired";
            await record.save();
            throw new Error("RECONNECT_REQUIRED");
        }

        record.status = "error";
        await record.save();
        throw err;
    }
};

export const sendTestEmail = async (req, res) => {
    try {
        const { provider, email: targetEmail } = req.body;

        if (!provider) {
            return res.status(400).json({ message: "Provider required" });
        }

        const userId = req.user.id;
        const testDate = new Date().toLocaleString();

        const htmlContent = `
            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
                <div style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 30px 20px; text-align: center; color: #ffffff;">
                    <h1 style="margin: 0; font-size: 24px; font-weight: 700;">Connection Verified!</h1>
                    <p style="margin: 10px 0 0 0; opacity: 0.9; font-size: 16px;">Your email integration is working perfectly.</p>
                </div>
                <div style="padding: 30px; color: #333333; line-height: 1.6;">
                    <p style="margin-bottom: 20px;">Hello,</p>
                    <p style="margin-bottom: 20px;">This is a test email sent from <strong>Borade AI</strong> to verify that your <strong>${provider === 'google' ? 'Gmail' : 'Outlook'}</strong> account is correctly connected and authorized to send emails.</p>
                    
                    <div style="background-color: #f8fafc; border-radius: 8px; padding: 20px; border-left: 4px solid #4f46e5; margin: 25px 0;">
                        <h3 style="margin: 0 0 10px 0; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b;">Technical Details</h3>
                        <p style="margin: 5px 0; font-size: 14px;"><strong>Provider:</strong> ${provider === 'google' ? 'Google Workspace / Gmail' : 'Microsoft 365 / Outlook'}</p>
                        <p style="margin: 5px 0; font-size: 14px;"><strong>Platform:</strong> Borade AI</p>
                        <p style="margin: 5px 0; font-size: 14px;"><strong>Timestamp:</strong> ${testDate}</p>
                        <p style="margin: 5px 0; font-size: 14px;"><strong>Status:</strong> ✅ Active & Authorized</p>
                    </div>

                    <p style="margin-bottom: 20px;">You are now ready to start sending automated campaigns and professional messages to your audience using Borade AI's powerful automation tools.</p>
                    
                    <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 30px 0;" />
                    <p style="font-size: 12px; color: #94a3b8; text-align: center;">This is an automated message. Please do not reply to this email.</p>
                </div>
                <div style="background-color: #f1f5f9; padding: 20px; text-align: center; font-size: 12px; color: #64748b;">
                    &copy; ${new Date().getFullYear()} Mytek Innovations Private Limited. All rights reserved.
                </div>
            </div>
        `;

        // ================= GOOGLE =================
        if (provider === "google") {
            const { oauth2Client, email } = await getValidGoogleToken(userId, targetEmail);

            const gmail = google.gmail({ version: "v1", auth: oauth2Client });

            const subject = "✅ Connection Verified: Your Borade AI Integration is Ready";
            const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;

            const messageParts = [
                `From: Borade AI <${email}>`,
                `To: ${email}`,
                `Content-Type: text/html; charset=utf-8`,
                `MIME-Version: 1.0`,
                `Subject: ${utf8Subject}`,
                "",
                htmlContent,
            ];
            const message = messageParts.join("\n");

            const encodedMessage = Buffer.from(message)
                .toString("base64")
                .replace(/\+/g, "-")
                .replace(/\//g, "_")
                .replace(/=+$/, "");

            await gmail.users.messages.send({
                userId: "me",
                requestBody: { raw: encodedMessage },
            });

            return res.json({
                success: true,
                message: "Professional Borade AI test email sent to your inbox.",
            });
        }

        // ================= MICROSOFT =================
        if (provider === "microsoft") {
            const { accessToken, email } = await getValidMicrosoftToken(userId, targetEmail);

            await axios.post(
                "https://graph.microsoft.com/v1.0/me/sendMail",
                {
                    message: {
                        subject: "✅ Connection Verified: Your Borade AI Integration is Ready",
                        body: {
                            contentType: "HTML",
                            content: htmlContent,
                        },
                        toRecipients: [
                            {
                                emailAddress: {
                                    address: email,
                                },
                            },
                        ],
                    },
                    saveToSentItems: true,
                },
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        "Content-Type": "application/json",
                    },
                }
            );

            return res.json({
                success: true,
                message: "Professional Borade AI test email sent to your inbox.",
            });
        }

        // ================= CUSTOM (SMTP) =================
        if (provider === "custom") {
            const token = await EmailToken.findOne({ userId, email: targetEmail.toLowerCase(), provider: "custom" });
            if (!token) return res.status(400).json({ message: "Custom email account not found" });

            const smtpPortNum = Number(token.metadata.smtpPort);
            const transporter = nodemailer.createTransport({
                host: token.metadata.smtpHost,
                port: smtpPortNum || token.metadata.smtpPort,
                secure: smtpPortNum === 465 || token.metadata.smtpPort === 465,
                ...(smtpPortNum === 587 && { requireTLS: true }),
                auth: {
                    user: token.email,
                    pass: decrypt(token.appPassword),
                },
                tls: {
                    rejectUnauthorized: false,
                },
            });

            await transporter.sendMail({
                from: `Borade AI <${token.email}>`,
                to: token.email,
                subject: "✅ Connection Verified: Your Borade AI Integration is Ready",
                html: htmlContent,
            });

            return res.json({
                success: true,
                message: "Professional Borade AI test email sent to your inbox.",
            });
        }

        return res.status(400).json({ message: "Unsupported provider" });
    } catch (err) {
        console.error("[Test Email] Error:", err.message);
        return res.status(500).json({
            success: false,
            message: err.message === "RECONNECT_REQUIRED" ? "Connection expired. Please reconnect." : "Failed to send test email"
        });
    }
};