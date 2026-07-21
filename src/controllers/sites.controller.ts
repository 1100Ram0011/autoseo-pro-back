import { Request, Response } from 'express';
import prisma from '../config/prisma';

export const getSites = async (req: Request, res: Response) => {
  const email = req.query.email as string;
  const userId = req.query.userId as string;
  
  try {
    if (email) {
      let user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        user = await prisma.user.create({
          data: {
            email,
            name: email.split('@')[0] || 'User',
          }
        });
      }
      const sites = await prisma.site.findMany({
        where: { userId: user.id },
        include: { pages: true },
        orderBy: { createdAt: 'desc' }
      });
      return res.json(sites);
    } else if (userId) {
      const sites = await prisma.site.findMany({
        where: { userId },
        include: { pages: true },
        orderBy: { createdAt: 'desc' }
      });
      return res.json(sites);
    } else {
      const sites = await prisma.site.findMany({
        include: { pages: true },
        orderBy: { createdAt: 'desc' }
      });
      return res.json(sites);
    }
  } catch (error) {
    console.error('Failed to fetch sites:', error);
    res.status(500).json({ error: 'Failed to fetch sites' });
  }
};

export const addSite = async (req: Request, res: Response) => {
  const email = req.query.email as string;
  const { url } = req.body;

  if (!email || !url) {
    return res.status(400).json({ error: 'Email and URL are required' });
  }

  try {
    // Ensure User exists
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await prisma.user.create({
        data: { email, name: email.split('@')[0] || 'User' }
      });
    }

    const newSite = await prisma.site.create({
      data: {
        userId: user.id,
        url,
      }
    });

    res.json(newSite);
  } catch (error) {
    console.error('Failed to add site:', error);
    res.status(500).json({ error: 'Failed to add site' });
  }
};

export const getSitePages = async (req: Request, res: Response) => {
  try {
    const site = await prisma.site.findUnique({
      where: { id: req.params.id as string },
      include: { pages: { orderBy: { url: 'asc' } } }
    });
    if (!site) return res.status(404).json({ error: 'Site not found' });
    res.json(site);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch pages' });
  }
};

export const updateSiteSettings = async (req: Request, res: Response) => {
  try {
    const { ga4PropertyId, gscPropertyId } = req.body;
    
    const dataToUpdate: any = {};

    // Server-side normalization of Property ID
    if (ga4PropertyId !== undefined) {
      let normalizedId = ga4PropertyId;
      if (normalizedId && !normalizedId.startsWith('properties/')) {
        normalizedId = `properties/${normalizedId}`;
      }
      dataToUpdate.ga4PropertyId = normalizedId || null;
    }

    if (gscPropertyId !== undefined) {
      dataToUpdate.gscPropertyId = gscPropertyId || null;
    }

    const updatedSite = await prisma.site.update({
      where: { id: req.params.id as string },
      data: dataToUpdate
    });
    res.json(updatedSite);
  } catch (error) {
    console.error('Failed to update site settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
};

export const autoDetectGscProperty = async (req: Request, res: Response) => {
  try {
    const site = await prisma.site.findUnique({ where: { id: req.params.id as string } });
    if (!site) return res.status(404).json({ error: 'Site not found' });

    const { getGscSites } = require('../services/gsc');
    const { siteEntry } = await getGscSites(site.userId);
    
    // Find matching GSC property
    const urlObj = new URL(site.url);
    const domain = urlObj.hostname;
    
    const match = siteEntry.find((s: any) => 
      s.siteUrl === `sc-domain:${domain}` || 
      s.siteUrl === site.url || 
      s.siteUrl === site.url + '/'
    );

    if (match) {
      const updatedSite = await prisma.site.update({
        where: { id: site.id },
        // @ts-ignore - Prisma Client needs to be generated
        data: { gscPropertyId: match.siteUrl }
      });
      return res.json({ success: true, propertyId: match.siteUrl, site: updatedSite });
    }

    res.status(404).json({ error: 'No matching GSC property found. Please add it manually.' });
  } catch (error) {
    console.error('Auto-detect GSC Error:', error);
    res.status(500).json({ error: 'Failed to auto-detect GSC property' });
  }
};

export const autoDetectGa4Property = async (req: Request, res: Response) => {
  try {
    const site = await prisma.site.findUnique({ where: { id: req.params.id as string } });
    if (!site) return res.status(404).json({ error: 'Site not found' });

    const { getAuth } = require('../services/gsc');
    const auth = await getAuth(site.userId);
    if (!auth) return res.status(401).json({ error: 'Google Auth required' });

    const { getGa4AccountsAndProperties } = require('../services/ga4');
    const accounts = await getGa4AccountsAndProperties(auth);
    
    const { google } = require('googleapis');
    const admin = google.analyticsadmin({ version: 'v1beta', auth });

    const urlObj = new URL(site.url);
    const domain = urlObj.hostname.replace('www.', '');

    for (const account of accounts) {
      try {
        const propsRes = await admin.properties.list({ filter: `parent:${account.account}` });
        const properties = propsRes.data.properties || [];
        
        for (const prop of properties) {
           if (
             (prop.displayName && prop.displayName.toLowerCase().includes(domain.toLowerCase())) ||
             (prop.defaultUri && prop.defaultUri.includes(domain))
           ) {
              const updatedSite = await prisma.site.update({
                where: { id: site.id },
                // @ts-ignore
                data: { ga4PropertyId: prop.name }
              });
              return res.json({ success: true, propertyId: prop.name, site: updatedSite });
           }
        }
      } catch (e) {
        console.warn('Error fetching properties for account', account.account, e);
      }
    }

    res.status(404).json({ error: 'No matching GA4 property found. Please add it manually.' });
  } catch (error) {
    console.error('Auto-detect GA4 Error:', error);
    res.status(500).json({ error: 'Failed to auto-detect GA4 property' });
  }
};
