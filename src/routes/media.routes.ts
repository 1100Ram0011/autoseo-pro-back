import { Router } from "express";
import {
  createMedia,
  updateMedia,
  deleteMedia,
  getImagesByUserId,
  restoreMedia,
  permanentlyDeleteMedia,
  getDeletedImagesByUserId,
  updateMediaMeta,
  archiveMedia,
  unarchiveMedia,
  getArchivedMedia,
} from "../controllers/mediaStore.controller";
// Assuming auth middleware is exported from somewhere, typically:
// import { protect } from "../middlewares/auth";
// We'll leave it out for now or apply it at the app level, but ideally we'd apply it here.

const router = Router();

// Retrieve routes
router.get("/images", getImagesByUserId);
router.get("/images/deleted", getDeletedImagesByUserId);
router.get("/archived", getArchivedMedia);

// Write routes
router.post("/", createMedia);
router.put("/:id", updateMedia);
router.delete("/:id", deleteMedia);

// Additional actions
router.put("/:id/restore", restoreMedia);
router.delete("/:id/permanent", permanentlyDeleteMedia);
router.put("/:id/meta", updateMediaMeta);
router.put("/:id/archive", archiveMedia);
router.put("/:id/unarchive", unarchiveMedia);

export default router;
