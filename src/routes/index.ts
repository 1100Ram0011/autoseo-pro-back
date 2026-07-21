import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.middleware';

import authRoutes from './auth.routes';
import sitesRoutes from './sites.routes';
import keywordsRoutes from './keywords.routes';
import gscRoutes from './gsc.routes';
import analyticsRoutes from './analytics.routes';
import seoRoutes from './seo.routes';
import aiRoutes from './ai.routes';
import agentsRoutes from './agents.routes';
import billingRoutes from './billing.routes';
import leadsRoutes from './leads.routes';
import campaignsRoutes from './campaigns.routes';
import clarityRoutes from './clarity.routes';
import businessRoutes from './business.routes';
import autopilotRoutes from './autopilot.routes';
import competitorsRoutes from './competitors.routes';
import linksRoutes from './links.routes';
import gmbRoutes from './gmb.routes';
import backlinksRoutes from './backlinks.routes';
import alertsRoutes from './alerts.routes';
import autoseoRoutes from './autoseo.routes';
import anomalyRoutes from './anomaly.routes';
import whatsappRoutes from './whatsapp.routes';

const router = Router();

import usersRoutes from './users.routes';

import publicApiRoutes from './public-api.routes';

// --- Public Routes (no auth required) ---
router.use('/auth', authRoutes);
router.use('/v1', publicApiRoutes);

// --- Apply auth middleware to all subsequent routes ---
router.use(authMiddleware);

// --- Protected Routes ---
router.use('/users', usersRoutes);
router.use('/sites', sitesRoutes);
router.use('/sites/:id/competitors', competitorsRoutes);
router.use('/sites/:id/internal-links', linksRoutes);
router.use('/sites/:id/gmb', gmbRoutes);
router.use('/sites/:id/backlinks', backlinksRoutes);
router.use('/sites/:id/alerts', alertsRoutes);
router.use('/', keywordsRoutes);
router.use('/leads', leadsRoutes);
router.use('/campaigns', campaignsRoutes);
router.use('/clarity', clarityRoutes);
router.use('/anomalies', anomalyRoutes);
router.use('/business', businessRoutes);
router.use('/', gscRoutes);
router.use('/', analyticsRoutes);
router.use('/', seoRoutes);
router.use('/ai', aiRoutes);
router.use('/agents', agentsRoutes);
router.use('/', billingRoutes);
router.use('/autopilot', autopilotRoutes);
router.use('/', autoseoRoutes);
import scraperRoutes from './scraper.routes';

router.use('/whatsapp', whatsappRoutes);
router.use('/scraper', scraperRoutes);

export default router;
