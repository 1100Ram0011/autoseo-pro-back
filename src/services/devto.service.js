// import axios from 'axios';  

// const devtoApi = axios.create({
//   baseURL: 'https://dev.to/api',
//   timeout: 30000, 
//   headers: {
//     'Content-Type': 'application/json',
//     'api-key': process.env.DEVTO_API_KEY 
//   }
// });

// export const publishArticle = async (blogData) => { // <--    
//   try {
//     const payload = {
//       article: {
//         title: blogData.title,
//         body_markdown: blogData.content, 
//         published: true, 
//         tags: blogData.tags || []
//       }
//     };

//     console.log('📤 Sending to Dev.to API...');

//     const response = await devtoApi.post('/articles', payload);

//     if (response.status === 201) {
//       console.log('✅ Dev.to publish successful!');
//       const article = response.data;

//       return {
//         success: true,
//         id: article.id,
//         url: article.url, 
//       };
//     }
//   } catch (error) {
//     console.error('❌ Dev.to API Error:', error.message);
//     if (error.response?.status === 401) throw new Error('API Key Invalid hai');
//     throw error;
//   }
// };
















import axios from 'axios';

const devtoApi = axios.create({
  baseURL: 'https://dev.to/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    'api-key': process.env.DEVTO_API_KEY,
  },
});

export const publishArticle = async (blogData) => {
  try {
    const payload = {
      article: {
        title: blogData.title,
        body_markdown: blogData.content,
        published: true,
        // Dev.to only allows max 4 tags
        tags: (blogData.tags || []).map(t => t.toLowerCase().trim().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '')).filter(Boolean).slice(0, 4),
        // Cloudinary URL seedha Dev.to ko bhejta hai
        ...(blogData.coverImage && { main_image: blogData.coverImage }),
        ...(blogData.coverImageUrl && { main_image: blogData.coverImageUrl }), // dono check kar lete hain
      },
    };

    const response = await devtoApi.post('/articles', payload);

    if (response.status === 201) {
      const article = response.data;
      return { success: true, devtoId: article.id, devtoUrl: article.url };
    }
  } catch (error) {
    const errorDetails = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    console.error('Dev.to response:', errorDetails);
    if (error.response?.status === 401) throw new Error('DEVTO_API_KEY invalid hai');
    throw new Error(`Dev.to API Error: ${errorDetails}`);
  }
};