import { Request, Response } from 'express';
import waApi from '../services/whatsappEngine.service';
import prisma from '../config/prisma';
import { uploadToS3 } from '../services/upload.service';
import crypto from 'crypto';
import { whatsappValidationQueue } from '../jobs/whatsappValidationQueue';

export const connectWhatsApp = async (req: Request, res: Response): Promise<any> => {
  try {
    const accountId = (req as any).user?.id?.toString() || '1';
    const response = await waApi.post('/connect', { accountId });
    return res.json(response.data);
  } catch (error: any) {
    console.error('CONNECT ERROR:', error.response?.data || error.message);
    return res.status(500).json({ success: false, message: 'Failed to connect WhatsApp' });
  }
};

export const getWhatsAppConnections = async (req: Request, res: Response): Promise<any> => {
  try {
    const accountId = (req as any).user?.id?.toString() || '1';
    const response = await waApi.get(`/connections/${accountId}`);
    return res.json(response.data);
  } catch (error: any) {
    console.error('CONNECTIONS ERROR:', error.response?.data || error.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch connections' });
  }
};

export const getWhatsAppQRCode = async (req: Request, res: Response): Promise<any> => {
  try {
    const { connectionId } = req.params;
    const accountId = (req as any).user?.id?.toString() || '1';
    const response = await waApi.get(`/qr/${connectionId}`, { headers: { 'x-account-id': accountId } });
    return res.json(response.data);
  } catch (error: any) {
    console.error('QR ERROR:', error.response?.data || error.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch QR' });
  }
};

export const getWhatsappConnectionStatus = async (req: Request, res: Response): Promise<any> => {
  try {
    const { connectionId } = req.params;
    const response = await waApi.get(`/status/${connectionId}`);
    return res.json(response.data);
  } catch (error: any) {
    console.error('STATUS ERROR:', error.response?.data || error.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch status' });
  }
};

export const checkWhatsAppNumber = async (req: Request, res: Response): Promise<any> => {
  const accountId = (req as any).user?.id?.toString() || '1';
  try {
    const { connectionId, number } = req.body;
    if (!number) return res.status(400).json({ success: false, message: 'Number is required' });

    const response = await waApi.post('/check-number', { accountId, connectionId, number });
    return res.json(response.data);
  } catch (error: any) {
    console.error('CHECK NUMBER ERROR:', error.response?.data || error.message);
    return res.status(500).json({ success: false, message: error.response?.data?.message || error.message || 'Failed to check number' });
  }
};

export const logoutWhatsApp = async (req: Request, res: Response): Promise<any> => {
  try {
    const { connectionId } = req.body;
    const response = await waApi.post('/logout', { connectionId });
    return res.json(response.data);
  } catch (error: any) {
    console.error('LOGOUT ERROR:', error.response?.data || error.message);
    return res.status(500).json({ success: false, message: 'Failed to logout' });
  }
};

export const logoutAllWhatsApp = async (req: Request, res: Response): Promise<any> => {
  try {
    const accountId = (req as any).user?.id?.toString() || '1';
    const response = await waApi.post('/logout-all', { accountId });
    return res.json(response.data);
  } catch (error: any) {
    console.error('LOGOUT ALL ERROR:', error.response?.data || error.message);
    return res.status(500).json({ success: false, message: 'Failed to logout all' });
  }
};

export const uploadValidationFile = async (req: Request, res: Response): Promise<any> => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "File required" });
    }

    const accountId = (req as any).user?.id?.toString() || '1';
    const extension = req.file.originalname.split(".").pop()?.toLowerCase();
    const key = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${extension}`;

    const sourceFileUrl = await uploadToS3(
      req.file.buffer,
      key,
      "whatsapp-validator/source",
      req.file.mimetype
    );

    const job = await prisma.whatsappValidationJob.create({
      data: {
        accountId,
        originalFileName: req.file.originalname,
        sourceFileUrl,
      }
    });

    await whatsappValidationQueue.add("validate-whatsapp", {
      jobId: job.id,
      accountId,
    });

    return res.json({ success: true, jobId: job.id });
  } catch (error: any) {
    console.error("[VALIDATOR] Upload Failed", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getValidationStatus = async (req: Request, res: Response): Promise<any> => {
  try {
    const jobId = req.params.jobId as string;
    const job = await prisma.whatsappValidationJob.findUnique({
      where: { id: jobId }
    });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

    return res.json({
      success: true,
      data: {
        status: job.status,
        totalRows: job.totalRows,
        processedRows: job.processedRows,
        downloadUrl: job.resultFileUrl,
      }
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
