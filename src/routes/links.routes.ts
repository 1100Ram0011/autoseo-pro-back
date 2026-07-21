import { Router } from 'express';
import { getSuggestions, generateSuggestions, updateSuggestionStatus } from '../controllers/links.controller';

const router = Router({ mergeParams: true });

// Mounted at /api/sites/:id/internal-links
router.get('/', getSuggestions);
router.post('/generate', generateSuggestions);
router.patch('/:suggestionId', updateSuggestionStatus);

export default router;
