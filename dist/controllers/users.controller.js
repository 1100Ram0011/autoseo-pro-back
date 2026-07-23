"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.revokeApiKey = exports.generateApiKey = exports.getApiKey = void 0;
const client_1 = require("@prisma/client");
const crypto_1 = __importDefault(require("crypto"));
const prisma = new client_1.PrismaClient();
const getApiKey = async (req, res) => {
    try {
        const email = req.query.email;
        if (!email) {
            res.status(400).json({ error: 'Email is required' });
            return;
        }
        const user = await prisma.user.findUnique({
            where: { email },
            select: { apiKey: true }
        });
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        res.json({ apiKey: user.apiKey });
    }
    catch (error) {
        console.error('Error fetching API key:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.getApiKey = getApiKey;
const generateApiKey = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            res.status(400).json({ error: 'Email is required' });
            return;
        }
        const newKey = 'sk_live_' + crypto_1.default.randomBytes(24).toString('hex');
        const updatedUser = await prisma.user.update({
            where: { email },
            data: { apiKey: newKey },
            select: { apiKey: true }
        });
        res.json({ apiKey: updatedUser.apiKey });
    }
    catch (error) {
        console.error('Error generating API key:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.generateApiKey = generateApiKey;
const revokeApiKey = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            res.status(400).json({ error: 'Email is required' });
            return;
        }
        await prisma.user.update({
            where: { email },
            data: { apiKey: null }
        });
        res.json({ success: true });
    }
    catch (error) {
        console.error('Error revoking API key:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.revokeApiKey = revokeApiKey;
//# sourceMappingURL=users.controller.js.map