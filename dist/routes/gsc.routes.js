"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const gsc_controller_1 = require("../controllers/gsc.controller");
const router = (0, express_1.Router)();
router.get('/gsc/sites', gsc_controller_1.getSitesList);
router.get('/sites/:id/gsc/overview', gsc_controller_1.getOverview);
router.get('/sites/:id/gsc/keywords', gsc_controller_1.getKeywords);
router.get('/sites/:id/gsc/pages', gsc_controller_1.getPages);
router.get('/sites/:id/gsc/coverage', gsc_controller_1.getCoverage);
router.get('/sites/:id/gsc/countries', gsc_controller_1.getCountries);
router.get('/sites/:id/gsc/devices', gsc_controller_1.getDevices);
router.post('/sites/:id/gsc/query', gsc_controller_1.getQuery);
router.get('/sites/:id/gsc/sitemaps', gsc_controller_1.getSitemaps);
router.post('/sites/:id/gsc/inspect', gsc_controller_1.inspectUrlEndpoint);
router.get('/sites/:id/gsc/insights', gsc_controller_1.getInsights);
router.get('/seo/gsc/:siteId', gsc_controller_1.getFullSeoGsc);
exports.default = router;
//# sourceMappingURL=gsc.routes.js.map