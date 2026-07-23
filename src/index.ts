import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import dotenv from 'dotenv';
import routes from './routes';
import { initClarityCron } from './services/claritySync';
import { initNightlyMonitor } from './jobs/nightlyMonitor';
import './jobs/leadsQueue';
import './jobs/linkedinQueue';
import './jobs/whatsappValidationQueue';
import './jobs/firecrawlQueue';

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

// --- Security & Performance Middleware ---
app.use(helmet());
app.use(compression());

// --- CORS: Only allow known origins ---
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  process.env.FRONTEND_URL,
].filter(Boolean) as string[];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.) in dev
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS blocked: ${origin}`));
    }
  },
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));

// --- Request Logger ---
app.use((req: Request, _res: Response, next: NextFunction) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  next();
});

// Initialize Cron Jobs
initClarityCron();
initNightlyMonitor();

// Basic health check route
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'AutoSEO Pro Backend is running' });
});

// Register API Routes
app.use('/api', routes);

// --- Global Error Handler ---
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || 'Internal Server Error';

  console.error(`[ERROR] ${statusCode}: ${message}`);
  if (process.env.NODE_ENV !== 'production') {
    console.error(err.stack);
  }

  res.status(statusCode).json({
    error: {
      message,
      code: err.code || 'INTERNAL_ERROR',
      ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
    },
  });
});

// Start the server
app.listen(port, () => {
  console.log(`🚀 AutoSEO Pro Backend running on port ${port}`);
  console.log(`   CORS: ${allowedOrigins.join(', ')}`);
});
