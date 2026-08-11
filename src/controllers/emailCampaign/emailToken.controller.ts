import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ==============================
// GET ALL CONNECTED EMAIL ACCOUNTS
// ==============================
export const getEmailTokens = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const tokens = await prisma.emailToken.findMany({
      where: { userId, isActive: true },
      select: {
        id: true,
        email: true,
        provider: true,
        accountType: true,
        tier: true,
        status: true,
        dailyLimit: true,
        lifetimeSent: true,
        lifetimeFailed: true,
        lastUsedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
    return res.json({ success: true, data: tokens });
  } catch (error: any) {
    console.error("Get email tokens failed:", error.message);
    return res.status(500).json({ message: "Failed to fetch email accounts" });
  }
};

// ==============================
// CONNECT CUSTOM SMTP
// ==============================
export const connectCustomSmtp = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const { email, appPassword, dailyLimit } = req.body;

    if (!email || !appPassword) {
      return res.status(400).json({ message: "Email and app password are required" });
    }

    const token = await prisma.emailToken.upsert({
      where: {
        userId_provider_email: { userId, provider: "custom", email },
      },
      update: {
        appPassword,
        isActive: true,
        status: "active",
        dailyLimit: dailyLimit ?? 500,
      },
      create: {
        userId,
        provider: "custom",
        email,
        appPassword,
        tier: "custom_smtp",
        status: "active",
        isActive: true,
        dailyLimit: dailyLimit ?? 500,
      },
    });

    return res.json({ success: true, message: "Custom SMTP connected", token });
  } catch (error: any) {
    console.error("Connect custom SMTP failed:", error.message);
    return res.status(500).json({ message: "Failed to connect custom SMTP" });
  }
};

// ==============================
// DISCONNECT EMAIL ACCOUNT
// ==============================
export const disconnectEmailToken = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const token = await prisma.emailToken.findFirst({
      where: { id: (req.params.id as string), userId },
    });
    if (!token) {
      return res.status(404).json({ message: "Email account not found" });
    }

    await prisma.emailToken.update({
      where: { id: (req.params.id as string) },
      data: { isActive: false, status: "disconnected" },
    });

    return res.json({ success: true, message: "Email account disconnected" });
  } catch (error: any) {
    console.error("Disconnect email token failed:", error.message);
    return res.status(500).json({ message: "Failed to disconnect email account" });
  }
};

// ==============================
// GOOGLE OAUTH CALLBACK (Save token after OAuth)
// ==============================
export const saveGoogleToken = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const { email, accessToken, refreshToken, expiresAt, scope, tier } = req.body;

    if (!email || !accessToken) {
      return res.status(400).json({ message: "email and accessToken are required" });
    }

    const token = await prisma.emailToken.upsert({
      where: {
        userId_provider_email: { userId, provider: "google", email },
      },
      update: {
        accessToken,
        refreshToken,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        scope,
        tier: tier ?? "gmail_free",
        isActive: true,
        status: "active",
      },
      create: {
        userId,
        provider: "google",
        email,
        accessToken,
        refreshToken,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        scope,
        tier: tier ?? "gmail_free",
        accountType: "free",
        isActive: true,
        status: "active",
      },
    });

    return res.json({ success: true, message: "Google email connected", token });
  } catch (error: any) {
    console.error("Save Google token failed:", error.message);
    return res.status(500).json({ message: "Failed to save Google token" });
  }
};

// ==============================
// MICROSOFT OAUTH CALLBACK (Save token after OAuth)
// ==============================
export const saveMicrosoftToken = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const { email, accessToken, refreshToken, expiresAt, scope, tier } = req.body;

    if (!email || !accessToken) {
      return res.status(400).json({ message: "email and accessToken are required" });
    }

    const token = await prisma.emailToken.upsert({
      where: {
        userId_provider_email: { userId, provider: "microsoft", email },
      },
      update: {
        accessToken,
        refreshToken,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        scope,
        tier: tier ?? "outlook_free",
        isActive: true,
        status: "active",
      },
      create: {
        userId,
        provider: "microsoft",
        email,
        accessToken,
        refreshToken,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        scope,
        tier: tier ?? "outlook_free",
        accountType: "free",
        isActive: true,
        status: "active",
      },
    });

    return res.json({ success: true, message: "Microsoft email connected", token });
  } catch (error: any) {
    console.error("Save Microsoft token failed:", error.message);
    return res.status(500).json({ message: "Failed to save Microsoft token" });
  }
};

// ==============================
// UNSUBSCRIBE (Public — no auth)
// ==============================
export const unsubscribeEmail = async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const record = await prisma.emailUnsubscribe.findUnique({ where: { token: token as string } });
    if (!record) {
      return res.status(404).json({ message: "Invalid unsubscribe token" });
    }

    if (record.unsubscribedAt) {
      return res.json({ message: "Already unsubscribed" });
    }

    await prisma.emailUnsubscribe.update({
      where: { token: token as string },
      data: { unsubscribedAt: new Date() },
    });

    return res.json({ success: true, message: "Successfully unsubscribed" });
  } catch (error: any) {
    console.error("Unsubscribe failed:", error.message);
    return res.status(500).json({ message: "Failed to process unsubscribe" });
  }
};

// ==============================
// GET UNSUBSCRIBES FOR USER
// ==============================
export const getUnsubscribes = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const unsubscribes = await prisma.emailUnsubscribe.findMany({
      where: { userId, unsubscribedAt: { not: null } },
      orderBy: { unsubscribedAt: "desc" },
    });
    return res.json({ success: true, data: unsubscribes });
  } catch (error: any) {
    console.error("Get unsubscribes failed:", error.message);
    return res.status(500).json({ message: "Failed to fetch unsubscribes" });
  }
};
