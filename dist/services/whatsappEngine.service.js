"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const waApi = axios_1.default.create({
    baseURL: process.env.WHATSAPP_ENGINE_URL || 'http://localhost:3001',
    headers: {
        'x-api-key': process.env.WHATSAPP_ENGINE_KEY || '',
    },
    timeout: 60000,
});
exports.default = waApi;
//# sourceMappingURL=whatsappEngine.service.js.map