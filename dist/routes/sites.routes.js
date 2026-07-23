"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const sites_controller_1 = require("../controllers/sites.controller");
const dashboard_controller_1 = require("../controllers/dashboard.controller");
const wp_controller_1 = require("../controllers/wp.controller");
const router = (0, express_1.Router)();
router.get('/', sites_controller_1.getSites);
router.post('/', sites_controller_1.addSite);
router.get('/:id/pages', sites_controller_1.getSitePages);
router.get('/:id/dashboard', dashboard_controller_1.getDashboardData);
router.put('/:id/settings', sites_controller_1.updateSiteSettings);
router.post('/:id/auto-detect-gsc', sites_controller_1.autoDetectGscProperty);
router.post('/:id/auto-detect-ga4', sites_controller_1.autoDetectGa4Property);
router.post('/:id/wp-sync', wp_controller_1.syncToWordPress);
exports.default = router;
//# sourceMappingURL=sites.routes.js.map