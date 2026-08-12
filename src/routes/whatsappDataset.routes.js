import express
    from "express";

import multer
    from "multer";

import {
    uploadDataset,
    getDatasets,
    getDataset,
    getDatasetPreview,
    deleteDataset,
} from "../controllers/whatsappDataset.controller.js";
import { isAuthenticated } from "../middleware/authMiddleware.js";

const router =
    express.Router();

router.use(isAuthenticated)

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 20 * 1024 * 1024, // 20 MB
    },
});

router.post(
    "/upload",
    upload.single(
        "file"
    ),
    uploadDataset
);

router.get(
    "/",
    getDatasets
);

router.get(
    "/:datasetId",
    getDataset
);

router.get(
    "/:datasetId/preview",
    getDatasetPreview
);

router.delete(
    "/:datasetId",
    deleteDataset
);

export default router;