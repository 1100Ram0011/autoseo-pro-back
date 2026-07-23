"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const leads_controller_1 = require("../controllers/leads.controller");
const router = (0, express_1.Router)();
router.get('/', leads_controller_1.getLeads);
// Map Leads API
router.post('/map/generate', leads_controller_1.generateMapLeads);
router.get('/map', leads_controller_1.getMapLeads);
router.delete('/map/:id', leads_controller_1.deleteMapLead);
router.get('/map/progress', leads_controller_1.getMapLeadProgress);
router.post('/map/:id/verify-wa', leads_controller_1.verifyMapLeadWhatsApp);
// Utils
router.get('/map/autocomplete', leads_controller_1.getGooglePlacesAutocomplete);
router.post('/map/suggest-target-market', leads_controller_1.getTargetMarketSuggestions);
router.post('/map/validate-target-market', leads_controller_1.validateTargetMarket);
// LinkedIn Leads API
router.get('/linkedin/:mapLeadId', leads_controller_1.getLinkedinLead);
router.post('/linkedin/generate', leads_controller_1.generateLinkedinLead);
router.post('/linkedin/enrich', leads_controller_1.enrichLinkedinEmployee);
exports.default = router;
//# sourceMappingURL=leads.routes.js.map