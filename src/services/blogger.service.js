import { google } from 'googleapis';
import BloggerConnection from '../models/blog/BloggerConnection.js';
import config from '../config/config.js';

// ─── Admin Google OAuth2 Client (Fallback) ───────────────────────────────────────────────────
const adminOauth2Client = new google.auth.OAuth2(
  process.env.BLOGGER_CLIENT_ID,
  process.env.BLOGGER_CLIENT_SECRET
);

adminOauth2Client.setCredentials({
  refresh_token: process.env.BLOGGER_REFRESH_TOKEN,
});

const adminBlogger = google.blogger({ version: 'v3', auth: adminOauth2Client });

// ─── Markdown → Basic HTML converter ────────────────────────────────────────
// Blogger markdown support nahi karta, isliye basic HTML conversion
const markdownToHtml = (markdown) => {
  if (!markdown) return '';

  return markdown
    // Code blocks (``` ... ```)
    .replace(/```[\w]*\n([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    // Inline code (`...`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Headers
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold + Italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // Images
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')
    // Unordered lists
    .replace(/^\s*[-*+] (.+)$/gm, '<li>$1</li>')
    // Ordered lists
    .replace(/^\s*\d+\. (.+)$/gm, '<li>$1</li>')
    // Horizontal rule
    .replace(/^[-*_]{3,}$/gm, '<hr />')
    // Paragraphs — double newlines
    .replace(/\n\n+/g, '</p><p>')
    // Single newlines → <br>
    .replace(/\n/g, '<br />')
    // Wrap in paragraph
    .replace(/^(.+)/, '<p>$1')
    .concat('</p>');
};

// ─── Main Publish Function ───────────────────────────────────────────────────
export const publishToBlogger = async (blogData, userId) => {
  try {
    let bloggerClient = adminBlogger;

    // Check if user has connected Blogger
    if (userId) {
      const connection = await BloggerConnection.findOne({ userId }).select('+refresh_token +access_token');
      if (connection && connection.isConnected && connection.refresh_token) {
        const userOauth2Client = new google.auth.OAuth2(
          config.BLOGGER_CLIENT_ID || config.GOOGLE_CLIENT_ID,
          config.BLOGGER_CLIENT_SECRET || config.GOOGLE_CLIENT_SECRET
        );
        userOauth2Client.setCredentials({
          refresh_token: connection.refresh_token,
        });
        bloggerClient = google.blogger({ version: 'v3', auth: userOauth2Client });
      }
    }

    // Dynamically fetch the blog at publish time
    const blogsResponse = await bloggerClient.blogs.listByUser({ userId: 'self' });
    const blogs = blogsResponse.data.items || [];
    
    let blogId;
    if (blogs.length > 0) {
      blogId = blogs[0].id;
    } else {
      throw new Error('Account has no Blogger blogs available to publish to.');
    }

    const htmlContent = markdownToHtml(blogData.content);

    // Cover image Blogger post ke top pe add karo
    const bodyWithImage = blogData.coverImage
      ? `<div style="text-align:center;margin-bottom:24px;"><img src="${blogData.coverImage}" alt="Cover Image" style="max-width:100%;border-radius:8px;" /></div>${htmlContent}`
      : htmlContent;

    const response = await bloggerClient.posts.insert({
      blogId,
      requestBody: {
        title: blogData.title,
        content: bodyWithImage,
        labels: (blogData.tags || []).slice(0, 20), // Blogger max 20 labels allow karta hai
      },
    });

    const post = response.data;
    console.log(`✅ Blogger publish successful! URL: ${post.url}`);

    return {
      success: true,
      bloggerId: post.id,
      bloggerUrl: post.url,
    };
  } catch (error) {
    const status = error.response?.status;
    const msg = error.response?.data?.error?.message || error.message;
    console.error(`❌ Blogger API Error (Status: ${status}):`, msg);
    console.error('Full Error Data:', JSON.stringify(error.response?.data, null, 2));

    if (status === 401) throw new Error('Blogger OAuth credentials invalid hain — refresh token check karo');
    if (status === 403) {
      if (msg.includes('permission')) {
        throw new Error('Blogger API Error: You do not have permission. Please make sure you have visited Blogger.com and created a Blogger Profile for this Google account.');
      }
      throw new Error('Blogger API access denied — API enable karo Google Cloud Console mein');
    }
    throw new Error(`Blogger API Error: ${msg}`);
  }
};

export const deleteFromBlogger = async (postId, userId) => {
  try {
    let bloggerClient = adminBlogger;

    if (userId) {
      const connection = await BloggerConnection.findOne({ userId }).select('+refresh_token +access_token');
      if (connection && connection.isConnected && connection.refresh_token) {
        const userOauth2Client = new google.auth.OAuth2(
          config.BLOGGER_CLIENT_ID || config.GOOGLE_CLIENT_ID,
          config.BLOGGER_CLIENT_SECRET || config.GOOGLE_CLIENT_SECRET
        );
        userOauth2Client.setCredentials({
          refresh_token: connection.refresh_token,
        });
        bloggerClient = google.blogger({ version: 'v3', auth: userOauth2Client });
      }
    }

    const blogsResponse = await bloggerClient.blogs.listByUser({ userId: 'self' });
    const blogs = blogsResponse.data.items || [];
    
    let blogId;
    if (blogs.length > 0) {
      blogId = blogs[0].id;
    } else {
      throw new Error('Account has no Blogger blogs available.');
    }

    await bloggerClient.posts.delete({
      blogId,
      postId,
    });

    console.log(`✅ Blogger post deleted successfully! ID: ${postId}`);
    return true;
  } catch (error) {
    console.error(`❌ Blogger API Error on Delete:`, error.message);
    return false;
  }
};
