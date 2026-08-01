import { Router } from 'express';
import { getTitleSuggestions, generateBlogContent } from '../controllers/blog/blogGeneration.controller';
import { getSession, saveTitles, saveDraft, setActiveJob } from '../controllers/blog/blogSession.controller';
import { bloggerLogin, bloggerCallback, getBloggerStatus } from '../controllers/blog/bloggerAuth.controller';
import { authMiddleware } from '../middlewares/auth.middleware';

const router = Router();

// Blogger Auth (Callback doesn't require JWT usually, but we pass state)
router.get('/blogger/callback', bloggerCallback);

// Apply auth middleware for the rest
router.use(authMiddleware);

// Blogger Connection Routes
router.get('/blogger/login', bloggerLogin);
router.get('/blogger/status', getBloggerStatus);

// Blog Generation Routes
router.get('/titles/:siteId', getTitleSuggestions);
router.post('/generate', generateBlogContent);

// Session Routes
router.get('/session', getSession);
router.patch('/session/titles', saveTitles);
router.patch('/session/draft', saveDraft);
router.patch('/session/active-job', setActiveJob);

export default router;
