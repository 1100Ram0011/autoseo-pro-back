/**
 * routes/whatsapp.routes.js
 *
 * Complete Express router for WhatsApp Template endpoints.
 * Register this in your app entry point, e.g.:
 *   app.use('/api/whatsapp', whatsappRouter)
 */

import { Router } from 'express'
import {
    upload,
    whatsappUploadMedia,
    whatsappGetTemplates,
    whatsappCreateTemplate,
    whatsappUpdateTemplate,
    whatsappSubmitTemplate,
    whatsappCloneTemplate,
    whatsappDeleteTemplate,
    getWhatsappActivation,
} from '../../../../controllers/Campaign/WhatsappCampaign/Msg91/whatsappTemplate.controller.js'
import { isAuthenticated } from '../../../../middleware/authMiddleware.js'
import { checkPlanAccess } from '../../../../middleware/planMiddleware.js'

const router = Router()

/* ── Media upload ─────────────────────────────────────────────────────────────
   POST /api/whatsapp/upload-media
   multipart/form-data: { whatsapp_number, media }
   Returns: { success, header_handle }
   Store header_handle in template.header.mediaUrl before submitting.
─────────────────────────────────────────────────────────────────────── */
router.post('/upload-media', upload.single('media'), isAuthenticated, whatsappUploadMedia)

/* ── Activation ───────────────────────────────────────────────────────────── */
router.get('/activation', isAuthenticated, getWhatsappActivation)

/* ── Template CRUD ────────────────────────────────────────────────────────── */
router.get('/', isAuthenticated, whatsappGetTemplates)        // GET  /api/whatsapp?integrated_number=xxx
router.post('/', isAuthenticated,
    // checkPlanAccess("createTemplates"), 
    whatsappCreateTemplate)      // POST /api/whatsapp
router.patch('/:id', isAuthenticated, whatsappUpdateTemplate)      // PATCH /api/whatsapp/:id  (DRAFT/REJECTED only)
router.delete('/delete', isAuthenticated, whatsappDeleteTemplate)      // DELETE /api/whatsapp/delete?...

/* ── Template lifecycle ───────────────────────────────────────────────────── */
router.post('/:id/submit', isAuthenticated, whatsappSubmitTemplate)    // POST /api/whatsapp/:id/submit
router.post('/:id/clone', isAuthenticated, whatsappCloneTemplate)     // POST /api/whatsapp/:id/clone

export default router