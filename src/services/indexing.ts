import { google } from 'googleapis';

const getIndexingClient = async () => {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS missing');
  }

  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/indexing'],
  });

  const client = await auth.getClient();
  return google.indexing({ version: 'v3', auth: client as any });
};

export const submitUrl = async (url: string, type: 'URL_UPDATED' | 'URL_DELETED' = 'URL_UPDATED') => {
  try {
    const indexing = await getIndexingClient();
    const response = await indexing.urlNotifications.publish({
      requestBody: { url, type }
    });
    return response.data;
  } catch (error: any) {
    console.error(`Error submitting URL ${url}:`, error.message);
    throw error;
  }
};

export const getMetadata = async (url: string) => {
  try {
    const indexing = await getIndexingClient();
    const response = await indexing.urlNotifications.getMetadata({ url });
    return response.data;
  } catch (error: any) {
    console.error(`Error getting metadata for ${url}:`, error.message);
    // If it's a 404, it just means no notification was sent before
    return null;
  }
};

export const submitBatch = async (urls: string[], type: 'URL_UPDATED' | 'URL_DELETED' = 'URL_UPDATED') => {
  // Limit to 100 per batch as per Google API limits
  const batchUrls = urls.slice(0, 100);
  
  try {
    console.log(`Submitting batch of ${batchUrls.length} URLs...`);
    
    // Simulate batch using Promise.allSettled for robustness
    const results = await Promise.allSettled(
      batchUrls.map(url => submitUrl(url, type))
    );

    const successful: any[] = [];
    const failed: any[] = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        successful.push({ url: batchUrls[index], data: result.value });
      } else {
        failed.push({ url: batchUrls[index], error: result.reason.message });
      }
    });

    return { successful, failed };
  } catch (error: any) {
    console.error('Batch submission failed:', error);
    throw error;
  }
};
