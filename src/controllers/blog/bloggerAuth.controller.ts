import { Request, Response } from 'express';
import { google } from 'googleapis';
import prisma from '../../config/prisma';
import jwt from 'jsonwebtoken';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_CALLBACK_URL?.replace('/auth/callback/google', '/blogs/blogger/callback') || 'http://localhost:4000/api/blogs/blogger/callback'
);

export const bloggerLogin = (req: Request, res: Response) => {
  try {
    const token = req.query.token as string;
    if (!token) return res.status(401).json({ message: 'Token missing' });

    // Verify token to ensure user is authenticated
    const decoded: any = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
    if (!decoded?.userId) return res.status(400).json({ message: 'User ID not found in token' });

    const state = token;
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/blogger'],
      state,
    });

    return res.redirect(url);
  } catch (error) {
    console.error('Blogger Login Error:', error);
    return res.status(500).json({ message: 'Failed to initiate Blogger login' });
  }
};

export const bloggerCallback = async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) return res.status(400).send('Invalid request');

    let userId: string;
    try {
      const decoded: any = jwt.verify(state as string, process.env.JWT_SECRET || 'fallback_secret');
      userId = decoded.userId;
    } catch (err) {
      return res.status(400).send('Invalid or expired state');
    }

    const { tokens } = await oauth2Client.getToken(code as string);
    oauth2Client.setCredentials(tokens);

    // Verify blogger profile
    const blogger = google.blogger({ version: 'v3', auth: oauth2Client });
    try {
      const blogsResponse = await blogger.blogs.listByUser({ userId: 'self' });
      const blogs = blogsResponse.data.items || [];
      if (blogs.length === 0) {
        return res.redirect(`${process.env.FRONTEND_URL}/dashboard/ai-blog?error=no_blogger_profile`);
      }
    } catch (err: any) {
      if (err.response?.status === 403 || err.message.includes('permission')) {
        return res.redirect(`${process.env.FRONTEND_URL}/dashboard/ai-blog?error=no_blogger_profile`);
      }
      throw err;
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        bloggerAccessToken: tokens.access_token,
        bloggerRefreshToken: tokens.refresh_token || undefined,
        bloggerExpiryDate: tokens.expiry_date ? BigInt(tokens.expiry_date) : undefined,
        isBloggerConnected: true,
      },
    });

    return res.redirect(`${process.env.FRONTEND_URL}/dashboard/ai-blog?blogger_connect=true`);
  } catch (error) {
    console.error('Blogger Callback Error:', error);
    return res.redirect(`${process.env.FRONTEND_URL}/dashboard/ai-blog?error=blogger_auth_failed`);
  }
};

export const getBloggerStatus = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user || !user.isBloggerConnected) {
      return res.json({ success: true, connected: false });
    }

    return res.json({ success: true, connected: true });
  } catch (error: any) {
    console.error('Blogger Status Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
