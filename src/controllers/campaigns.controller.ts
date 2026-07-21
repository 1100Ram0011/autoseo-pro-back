import { Request, Response } from 'express';
import prisma from '../config/prisma';

export const getCampaigns = async (req: Request, res: Response) => {
  const userId = req.query.userId as string || "1";
  try {
    let campaigns = await prisma.campaign.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });

    if (campaigns.length === 0) {
      // Seed default campaigns for MVP
      const defaultCampaigns = [
        {name:'Mumbai Restaurant Owners',subject:'Your website is losing customers (Free Audit inside)',sent:42,opened:18,replied:5,converted:2,status:'Active'},
        {name:'Local Salon SEO Outreach',subject:'Get 3x more bookings with SEO — Here is proof',sent:28,opened:11,replied:3,converted:1,status:'Active'},
        {name:'Auto Parts Cold Email',subject:'Why your website is on page 5 (and how to fix it)',sent:15,opened:4,replied:1,converted:0,status:'Paused'},
      ];
      
      for (const cmp of defaultCampaigns) {
        await prisma.campaign.create({
          data: { ...cmp, userId }
        });
      }
      campaigns = await prisma.campaign.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    }

    res.json(campaigns);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
};
