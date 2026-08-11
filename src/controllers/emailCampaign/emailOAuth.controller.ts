import { Request, Response } from "express";
import { google } from "googleapis";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import axios from "axios";

const prisma = new PrismaClient();

// ─── GOOGLE OAUTH ────────────────────────────────────────────────────────────

const getGoogleOAuthClient = () => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Google OAuth env variables not configured: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI");
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
};

/**
 * STEP 1 — Redirect user to Google consent screen
 * GET /api/email-campaign/auth/google
 */
export const googleOAuthRedirect = (req: Request, res: Response) => {
  try {
    const oauth2Client = getGoogleOAuthClient();
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    // Encode userId in state param (signed JWT)
    const state = jwt.sign({ userId }, process.env.JWT_SECRET || "secret", { expiresIn: "10m" });

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "select_account consent",
      scope: [
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://mail.google.com/",
      ],
      state,
    });

    return res.redirect(authUrl);
  } catch (error: any) {
    console.error("Google OAuth redirect failed:", error.message);
    return res.status(500).json({ message: error.message || "Failed to start Google OAuth" });
  }
};

/**
 * STEP 2 — Google redirects back with code
 * GET /api/email-campaign/auth/google/callback
 */
export const googleOAuthCallback = async (req: Request, res: Response) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  try {
    const { code, state, error } = req.query as Record<string, string>;

    if (error) {
      return res.redirect(`${frontendUrl}/dashboard/campaigns/email?error=${encodeURIComponent(error)}&tab=connectmails`);
    }

    if (!code || !state) {
      return res.redirect(`${frontendUrl}/dashboard/campaigns/email?error=missing_code&tab=connectmails`);
    }

    // Verify state JWT
    let userId: string;
    try {
      const payload = jwt.verify(state, process.env.JWT_SECRET || "secret") as any;
      userId = payload.userId;
    } catch {
      return res.redirect(`${frontendUrl}/dashboard/campaigns/email?error=invalid_state&tab=connectmails`);
    }

    const oauth2Client = getGoogleOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user email from Google
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();
    const email = userInfo.email;
    if (!email) {
      return res.redirect(`${frontendUrl}/dashboard/campaigns/email?error=no_email&tab=connectmails`);
    }

    // Detect tier (free vs workspace)
    const isWorkspace = !email.endsWith("@gmail.com");

    // Save token to DB
    await prisma.emailToken.upsert({
      where: {
        userId_provider_email: { userId, provider: "google", email },
      },
      update: {
        accessToken: tokens.access_token ?? undefined,
        refreshToken: tokens.refresh_token ?? undefined,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
        scope: tokens.scope ?? undefined,
        tier: isWorkspace ? "google_workspace" : "gmail_free",
        accountType: isWorkspace ? "workplace" : "free",
        isActive: true,
        status: "active",
      },
      create: {
        userId,
        provider: "google",
        email,
        accessToken: tokens.access_token ?? undefined,
        refreshToken: tokens.refresh_token ?? undefined,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
        scope: tokens.scope ?? undefined,
        tier: isWorkspace ? "google_workspace" : "gmail_free",
        accountType: isWorkspace ? "workplace" : "free",
        isActive: true,
        status: "active",
        dailyLimit: isWorkspace ? 2000 : 500,
      },
    });

    return res.redirect(`${frontendUrl}/dashboard/campaigns/email?success=gmail_connected&tab=connectmails`);
  } catch (error: any) {
    console.error("Google OAuth callback failed:", error.message);
    return res.redirect(`${frontendUrl}/dashboard/campaigns/email?error=oauth_failed&tab=connectmails`);
  }
};

// ─── MICROSOFT OAUTH ─────────────────────────────────────────────────────────

const MICROSOFT_BASE_URL = "https://login.microsoftonline.com/common/oauth2/v2.0";
const MICROSOFT_GRAPH_URL = "https://graph.microsoft.com/v1.0";

/**
 * STEP 1 — Redirect user to Microsoft consent screen
 * GET /api/email-campaign/auth/microsoft
 */
export const microsoftOAuthRedirect = (req: Request, res: Response) => {
  try {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const redirectUri = process.env.MICROSOFT_REDIRECT_URI;

    if (!clientId || !redirectUri) {
      throw new Error("Microsoft OAuth env variables not configured: MICROSOFT_CLIENT_ID, MICROSOFT_REDIRECT_URI");
    }

    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const state = jwt.sign({ userId }, process.env.JWT_SECRET || "secret", { expiresIn: "10m" });

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: "offline_access Mail.Send User.Read openid email profile",
      state,
      prompt: "select_account",
    });

    return res.redirect(`${MICROSOFT_BASE_URL}/authorize?${params.toString()}`);
  } catch (error: any) {
    console.error("Microsoft OAuth redirect failed:", error.message);
    return res.status(500).json({ message: error.message || "Failed to start Microsoft OAuth" });
  }
};

/**
 * STEP 2 — Microsoft redirects back with code
 * GET /api/email-campaign/auth/microsoft/callback
 */
export const microsoftOAuthCallback = async (req: Request, res: Response) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  try {
    const { code, state, error } = req.query as Record<string, string>;

    if (error) {
      return res.redirect(`${frontendUrl}/dashboard/campaigns/email?error=${encodeURIComponent(error)}&tab=connectmails`);
    }
    if (!code || !state) {
      return res.redirect(`${frontendUrl}/dashboard/campaigns/email?error=missing_code&tab=connectmails`);
    }

    // Verify state JWT
    let userId: string;
    try {
      const payload = jwt.verify(state, process.env.JWT_SECRET || "secret") as any;
      userId = payload.userId;
    } catch {
      return res.redirect(`${frontendUrl}/dashboard/campaigns/email?error=invalid_state&tab=connectmails`);
    }

    const clientId = process.env.MICROSOFT_CLIENT_ID!;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET!;
    const redirectUri = process.env.MICROSOFT_REDIRECT_URI!;

    // Exchange code for tokens
    const tokenResponse = await axios.post(
      `${MICROSOFT_BASE_URL}/token`,
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const tokens = tokenResponse.data;

    // Get user profile from Graph API
    const profileResponse = await axios.get(`${MICROSOFT_GRAPH_URL}/me`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    const email = profileResponse.data.mail || profileResponse.data.userPrincipalName;
    if (!email) {
      return res.redirect(`${frontendUrl}/dashboard/campaigns/email?error=no_email&tab=connectmails`);
    }

    const isM365 = !email.toLowerCase().endsWith("@outlook.com") && !email.toLowerCase().endsWith("@hotmail.com");

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    await prisma.emailToken.upsert({
      where: {
        userId_provider_email: { userId, provider: "microsoft", email },
      },
      update: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt,
        scope: tokens.scope,
        tier: isM365 ? "m365_business" : "outlook_free",
        accountType: isM365 ? "workplace" : "free",
        isActive: true,
        status: "active",
      },
      create: {
        userId,
        provider: "microsoft",
        email,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt,
        scope: tokens.scope,
        tier: isM365 ? "m365_business" : "outlook_free",
        accountType: isM365 ? "workplace" : "free",
        isActive: true,
        status: "active",
        dailyLimit: isM365 ? 2000 : 300,
      },
    });

    return res.redirect(`${frontendUrl}/dashboard/campaigns/email?success=outlook_connected&tab=connectmails`);
  } catch (error: any) {
    console.error("Microsoft OAuth callback failed:", error.message);
    return res.redirect(`${frontendUrl}/dashboard/campaigns/email?error=oauth_failed&tab=connectmails`);
  }
};
