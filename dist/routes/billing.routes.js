"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_2 = __importDefault(require("express"));
const billing_controller_1 = require("../controllers/billing.controller");
const router = (0, express_1.Router)();
router.post('/checkout', billing_controller_1.createCheckout);
router.post('/webhook', express_2.default.raw({ type: 'application/json' }), billing_controller_1.handleWebhook);
exports.default = router;
//# sourceMappingURL=billing.routes.js.map