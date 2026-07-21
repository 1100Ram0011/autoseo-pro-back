import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

export const getApiKey = async (req: Request, res: Response): Promise<void> => {
  try {
    const email = req.query.email as string;
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
  } catch (error) {
    console.error('Error fetching API key:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const generateApiKey = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    const newKey = 'sk_live_' + crypto.randomBytes(24).toString('hex');

    const updatedUser = await prisma.user.update({
      where: { email },
      data: { apiKey: newKey },
      select: { apiKey: true }
    });

    res.json({ apiKey: updatedUser.apiKey });
  } catch (error) {
    console.error('Error generating API key:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const revokeApiKey = async (req: Request, res: Response): Promise<void> => {
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
  } catch (error) {
    console.error('Error revoking API key:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
