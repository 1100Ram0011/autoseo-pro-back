"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_controller_1 = require("../controllers/auth.controller");
const router = (0, express_1.Router)();
router.get('/google', auth_controller_1.googleAuth);
router.get('/google/callback', auth_controller_1.googleAuthCallback);
router.get('/google/status', auth_controller_1.checkGoogleAuthStatus);
router.get('/google/properties', auth_controller_1.getGoogleProperties);
router.get('/google/gsc-properties', auth_controller_1.getGscProperties);
exports.default = router;
//# sourceMappingURL=auth.routes.js.map