import { Router } from 'express';
import { getLeads, generateMapLeads, getMapLeads, deleteMapLead, getMapLeadProgress, verifyMapLeadWhatsApp, getGooglePlacesAutocomplete, getTargetMarketSuggestions, validateTargetMarket, getLinkedinLead, generateLinkedinLead, enrichLinkedinEmployee } from '../controllers/leads.controller';

const router = Router();

router.get('/', getLeads);

// Map Leads API
router.post('/map/generate', generateMapLeads);
router.get('/map', getMapLeads);
router.delete('/map/:id', deleteMapLead);
router.get('/map/progress', getMapLeadProgress);
router.post('/map/:id/verify-wa', verifyMapLeadWhatsApp);

// Utils
router.get('/map/autocomplete', getGooglePlacesAutocomplete);
router.post('/map/suggest-target-market', getTargetMarketSuggestions);
router.post('/map/validate-target-market', validateTargetMarket);

// LinkedIn Leads API
router.get('/linkedin/:mapLeadId', getLinkedinLead);
router.post('/linkedin/generate', generateLinkedinLead);
router.post('/linkedin/enrich', enrichLinkedinEmployee);

export default router;
