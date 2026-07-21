import { Request, Response } from 'express';
import { google } from 'googleapis';
import prisma from '../config/prisma';

export const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.BACKEND_URL ? `${process.env.BACKEND_URL}/api/auth/google/callback` : 'http://localhost:4000/api/auth/google/callback'
);

export const googleAuth = (req: Request, res: Response) => {
  const email = req.query.email as string;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const redirectTarget = req.query.redirect as string || "search-console";
  const siteId = req.query.siteId as string || "";
  
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline', // Required to receive a refresh token
    prompt: 'consent', // Force consent to get refresh token
    scope: [
      'https://www.googleapis.com/auth/webmasters.readonly',
      'https://www.googleapis.com/auth/webmasters',
      'https://www.googleapis.com/auth/analytics.readonly'
    ],
    state: `${email}:${redirectTarget}:${siteId}` // Pass email, redirect target and siteId
  });
  
  res.redirect(url);
};

export const googleAuthCallback = async (req: Request, res: Response) => {
  const { code, state } = req.query;
  const [email, redirectTarget, siteId] = (state as string || "").split(':');
  
  try {
    const { tokens } = await oauth2Client.getToken(code as string);
    
    // Save refresh token to user in database
    if (tokens && tokens.refresh_token && email) {
      await prisma.user.update({
        where: { email: email as string },
        data: { googleRefreshToken: tokens.refresh_token }
      });
    }

    // Auto-fetch and save first GA4 property if siteId exists
    if (siteId) {
       try {
         const tempClient = new google.auth.OAuth2();
         tempClient.setCredentials(tokens);
         const admin = google.analyticsadmin({ version: 'v1beta', auth: tempClient });
         const adminRes = await admin.accountSummaries.list();
         if (adminRes.data.accountSummaries) {
           let firstProperty = null;
           for (const account of adminRes.data.accountSummaries) {
             if (account.propertySummaries && account.propertySummaries.length > 0) {
               firstProperty = account.propertySummaries[0]!.property || null;
               break;
             }
           }
           if (firstProperty) {
             await prisma.site.update({
               where: { id: siteId },
               data: { ga4PropertyId: firstProperty }
             });
             console.log(`Auto-saved GA4 property ${firstProperty} for site ${siteId}`);
           }
         }
       } catch (propErr) {
         console.error('Auto-fetch properties failed during callback:', propErr);
       }
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/dashboard/${redirectTarget || 'search-console'}?success=true`);
  } catch (error) {
    console.error('Error during Google OAuth callback:', error);
    res.status(500).send('Authentication failed');
  }
};

export const checkGoogleAuthStatus = async (req: Request, res: Response) => {
  const email = req.query.email as string;
  if (!email) return res.json({ connected: false });
  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { googleRefreshToken: true }
    });
    res.json({ connected: !!user?.googleRefreshToken });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check status' });
  }
};

export const getGoogleProperties = async (req: Request, res: Response) => {
  const email = req.query.email as string;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.googleRefreshToken) {
      return res.status(400).json({ error: 'Not connected to Google' });
    }

    const tempClient = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    tempClient.setCredentials({ refresh_token: user.googleRefreshToken });

    const admin = google.analyticsadmin({ version: 'v1beta', auth: tempClient });
    const adminRes = await admin.accountSummaries.list();
    
    const properties: {id: string, name: string}[] = [];
    if (adminRes.data.accountSummaries) {
      for (const account of adminRes.data.accountSummaries) {
        if (account.propertySummaries) {
          for (const prop of account.propertySummaries) {
            if (prop.property && prop.displayName) {
              properties.push({ id: prop.property, name: prop.displayName });
            }
          }
        }
      }
    }
    
    res.json({ properties });
  } catch (error) {
    console.error('Error fetching GA4 properties:', error);
    res.status(500).json({ error: 'Failed to fetch properties' });
  }
};

export const getGscProperties = async (req: Request, res: Response) => {
  const email = req.query.email as string;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.googleRefreshToken) {
      return res.status(400).json({ error: 'Not connected to Google' });
    }

    const tempClient = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    tempClient.setCredentials({ refresh_token: user.googleRefreshToken });

    const searchconsole = google.searchconsole({ version: 'v1', auth: tempClient });
    const resData = await searchconsole.sites.list({});
    const entries = resData.data.siteEntry || [];

    const properties = entries.map(e => ({
      id: e.siteUrl,
      name: e.siteUrl,
      permissionLevel: e.permissionLevel
    }));

    res.json({ properties });
  } catch (error) {
    console.error('Error fetching GSC properties:', error);
    res.status(500).json({ error: 'Failed to fetch GSC properties' });
  }
};