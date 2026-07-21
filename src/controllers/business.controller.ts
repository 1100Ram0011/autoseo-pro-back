import { Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';

// Mock OAuth logic for the MVP
export const connectBusiness = async (req: Request, res: Response) => {
  // In a real app, this initiates the Google OAuth2 flow
  // scope: 'https://www.googleapis.com/auth/business.manage'
  
  return res.json({
    success: true,
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth?client_id=MOCK_CLIENT_ID&redirect_uri=MOCK_REDIRECT&response_type=code&scope=https://www.googleapis.com/auth/business.manage",
    message: "Initiated OAuth flow for Google Business Profile"
  });
};

export const getBusinessProfile = async (req: Request, res: Response) => {
  // Mock fetching the user's Google Business Profile
  return res.json({
    success: true,
    profile: {
      name: "AutoSEO Agency (Demo)",
      category: "Marketing Agency",
      location: "New York, NY",
      status: "VERIFIED"
    }
  });
};

export const generateDailyPost = async (req: Request, res: Response) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY is missing' });

  const { category, customPrompt } = req.body;
  const ai = new GoogleGenAI({ apiKey });

  const prompt = 'You are an expert Social Media and Local SEO Manager.\n' +
    'Write a highly engaging, converting daily update post for a Google Business Profile.\n' +
    'Business Category: ' + (category || 'Local Business') + '\n' +
    'Additional Context: ' + (customPrompt || 'Create a general informative post about our services.') + '\n\n' +
    'Format:\n' +
    '- Keep it under 1500 characters (Google\'s limit)\n' +
    '- Use 2-3 relevant emojis\n' +
    '- Include a clear Call to Action (CTA) at the end\n' +
    '- Do not use markdown formatting (no bold/italics), just plain text that looks good on Google Search.';

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    const resultText = response.text;
    
    if (resultText) {
       return res.json({ success: true, postContent: resultText });
    }

    return res.status(500).json({ error: 'Empty response from Gemini' });
  } catch (error: any) {
    console.error('Gemini API Error (Local Post):', error);
    
    // Fallback if API fails
    return res.json({
      success: true,
      postContent: "?? We are excited to help local businesses scale with our new SEO tools! Our platform automates everything from Core Web Vitals to Local Search rankings. \n\nReady to dominate Google Maps? Contact us today to get started! ??\n\nCall now: (555) 123-4567"
    });
  }
};

export const publishPost = async (req: Request, res: Response) => {
  // Mock publishing to Google Business API
  // In a real app, uses google.mybusiness.locations.localPosts.create()
  const { content } = req.body;
  
  if (!content) {
    return res.status(400).json({ error: 'Content is required' });
  }

  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 800));

  return res.json({
    success: true,
    message: "Post successfully published to Google Business Profile!",
    status: "LIVE"
  });
};

export const getReviews = async (req: Request, res: Response) => {
  // Mock fetching reviews from Google Business Profile
  return res.json({
    success: true,
    reviews: [
      {
        id: "rev_1",
        author: "Sarah Jenkins",
        rating: 1,
        comment: "Absolutely terrible experience. I waited for 2 hours and no one helped me. The staff was rude. Never coming back here again!!!",
        date: "2 days ago",
        status: "UNANSWERED"
      },
      {
        id: "rev_2",
        author: "Michael T.",
        rating: 5,
        comment: "Great service and amazing products! The team really knows what they are doing. Highly recommend to anyone looking for quality work.",
        date: "1 week ago",
        status: "UNANSWERED"
      },
      {
        id: "rev_3",
        author: "Emily R.",
        rating: 3,
        comment: "It was okay. The product is fine but the delivery took much longer than expected. Might give them another try in the future.",
        date: "2 weeks ago",
        status: "ANSWERED"
      }
    ]
  });
};

export const generateReviewReply = async (req: Request, res: Response) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY is missing' });

  const { reviewText, rating, authorName } = req.body;
  const ai = new GoogleGenAI({ apiKey });

  const prompt = 'You are a professional customer service manager.\\n' +
    'Write a response to a customer review on Google Business Profile.\\n' +
    'Customer Name: ' + authorName + '\\n' +
    'Rating: ' + rating + ' Stars\\n' +
    'Review Text: ' + reviewText + '\\n\\n' +
    'Rules:\\n' +
    '- If 1-2 stars: Apologize sincerely, do not get defensive, offer to make it right offline (ask them to email support@autoseo.pro).\\n' +
    '- If 4-5 stars: Be enthusiastic, thank them for their business, and say we look forward to serving them again.\\n' +
    '- If 3 stars: Thank them for feedback and ask how we can improve next time.\\n' +
    '- Keep the reply under 400 characters.\\n' +
    '- Be highly professional and polite.\\n' +
    '- Do not use markdown.';

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    const resultText = response.text;
    
    if (resultText) {
       return res.json({ success: true, replyContent: resultText });
    }

    return res.status(500).json({ error: 'Empty response from Gemini' });
  } catch (error: any) {
    console.error('Gemini API Error (Review Reply):', error);
    
    // Fallback if API fails
    return res.json({
      success: true,
      replyContent: "Thank you for your feedback! We appreciate you taking the time to review us. Please contact our support team so we can assist you further."
    });
  }
};
