"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const users_controller_1 = require("../controllers/users.controller");
const router = (0, express_1.Router)();
router.get('/api-key', users_controller_1.getApiKey);
router.post('/api-key/generate', users_controller_1.generateApiKey);
router.delete('/api-key/revoke', users_controller_1.revokeApiKey);
exports.default = router;
//# sourceMappingURL=users.routes.js.map