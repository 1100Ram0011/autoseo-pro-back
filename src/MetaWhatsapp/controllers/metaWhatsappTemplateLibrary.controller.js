import { MetaGraphClient } from '../services/metaFbWhatsapp.client.js';
import WhatsAppToken from '../models/metaWhatsappCampaignTokenSchema.js';

export const getTemplateLibrary = async (req, res, next) => {
  try {
    const { 
      category, 
      topic, 
      search, 
      numberId, 
      industry,
      language = 'en', 
      page = 1, 
      per_page = 100 
    } = req.query;

    const pageNumber = parseInt(page, 10) || 1;
    const limitNumber = parseInt(per_page, 10) || 100;

    // console.log("getTemplateLibrary query params:", { category, topic, search, numberId, industry, language, page, per_page });

    let userTokenDoc;
    if (numberId) {
      userTokenDoc = await WhatsAppToken.findOne({ _id: numberId, userId: req.user?.id || req.user?._id }).select('+accessToken');
    } else {
      userTokenDoc = await WhatsAppToken.findOne({ userId: req.user?.id || req.user?._id, status: 'active' }).select('+accessToken');
    }

    if (!userTokenDoc || !userTokenDoc.accessToken) {
      return res.status(200).json({
        success: true,
        count: 0,
        data: [],
        meta: { current_page: pageNumber, per_page: limitNumber, total_items: 0, total_pages: 0 },
        message: "No connected WhatsApp Business Account credentials found."
      });
    }

    let rawTemplates = await MetaGraphClient.fetchMetaTemplateLibrary(userTokenDoc.accessToken, {
      category, topic, search, industry, language
    });

    // Deduplicate and filter by exact language match
    const templatesMap = new Map();
    rawTemplates.forEach(t => {
      // MSG91 uses 'en', Meta usually returns 'en_US' or 'en_GB'. We'll match if it starts with the requested language code.
      const langMatch = t.language && t.language.toLowerCase().startsWith(language.toLowerCase());
      if (langMatch) {
        if (!templatesMap.has(t.name)) {
          templatesMap.set(t.name, t);
        } else {
          // Both match the language, just keep the first one
        }
      }
    });
    
    let templates = Array.from(templatesMap.values());

    const allIndustries = new Set();
    templates.forEach(t => {
      if (Array.isArray(t.industry)) {
        t.industry.forEach(ind => allIndustries.add(ind));
      }
    });

    // console.log("Total templates after deduplication:", templates.length);

    // Optional: we can still apply any JS-level filtering if Meta's API didn't fully honor them, 
    // but Meta's API should handle name_or_content, category, topic, and industry.
    
    // Filtering down locally just in case the API returned more due to partial matches
    if (category && category !== 'ALL') {
      const catUpper = category.toUpperCase();
      templates = templates.filter(t => t.category?.toUpperCase() === catUpper);
    }
    if (topic && topic !== 'ALL') {
      const topicUpper = topic.toUpperCase();
      templates = templates.filter(t => t.topic?.toUpperCase() === topicUpper);
    }
    if (industry && industry !== 'ALL') {
      const indUpper = industry.toUpperCase();
      templates = templates.filter(t => t.industry?.some(ind => ind.toUpperCase() === indUpper));
    }
    if (search) {
      const searchLower = search.toLowerCase();
      templates = templates.filter(t => 
        (t.title && t.title.toLowerCase().includes(searchLower)) ||
        (t.name && t.name.toLowerCase().includes(searchLower)) ||
        (t.description && t.description.toLowerCase().includes(searchLower))
      );
    }

    // Pagination Logic
    const totalItems = templates.length;
    const totalPages = Math.ceil(totalItems / limitNumber);
    const startIndex = (pageNumber - 1) * limitNumber;
    const endIndex = startIndex + limitNumber;
    const paginatedTemplates = templates.slice(startIndex, endIndex);

    return res.status(200).json({
      success: true,
      count: paginatedTemplates.length,
      data: paginatedTemplates,
      industries: Array.from(allIndustries),
      meta: {
        current_page: pageNumber,
        per_page: limitNumber,
        total_pages: totalPages,
        total_items: totalItems
      }
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/meta/whatsapp/template-library/seed
export const seedTemplateLibrary = async (req, res, next) => {
  try {
    return res.status(200).json({
      success: true,
      message: "Seeding is disabled. Library templates are fetched directly from Meta's API.",
      data: []
    });
  } catch (err) {
    next(err);
  }
};
