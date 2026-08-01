import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';

export const generateReportPDF = async (siteId: string, type: string, reportName: string): Promise<string> => {
  const uploadsDir = path.join(process.cwd(), 'uploads', 'reports');
  
  // Ensure directory exists
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const safeName = reportName.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_');
  const fileName = `${siteId}_${safeName}_${Date.now()}.pdf`;
  const filePath = path.join(uploadsDir, fileName);

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  
  // URL to a special hidden route on the frontend that renders JUST the report for Puppeteer
  const reportUrl = `${frontendUrl}/report-preview?siteId=${siteId}&type=${type}`;

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    
    // Set viewport to A4 dimensions approximately
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
    
    // Navigate to the report page
    await page.goto(reportUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    
    // Generate PDF
    await page.pdf({
      path: filePath,
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' }
    });

    await browser.close();
    
    return `/uploads/reports/${fileName}`;
  } catch (error) {
    await browser.close();
    console.error('Error generating PDF with Puppeteer:', error);
    throw error;
  }
};
