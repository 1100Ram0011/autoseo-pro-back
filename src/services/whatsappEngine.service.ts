import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const waApi = axios.create({
  baseURL: process.env.WHATSAPP_ENGINE_URL || 'http://localhost:3001',
  headers: {
    'x-api-key': process.env.WHATSAPP_ENGINE_KEY || '',
  },
  timeout: 60000,
});

export default waApi;
