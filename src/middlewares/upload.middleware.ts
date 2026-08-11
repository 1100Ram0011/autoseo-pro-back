import multer from "multer";
import { Request, Response, NextFunction } from "express";

// ────────────────────────────────────────────────────────────
// MEMORY STORAGE — files stored in RAM as Buffer (for S3 upload)
// ────────────────────────────────────────────────────────────
const memoryStorage = multer.memoryStorage();

// ────────────────────────────────────────────────────────────
// EXCEL / CSV UPLOAD (Campaign Recipients)
// ────────────────────────────────────────────────────────────
const EXCEL_MIMES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel",                                           // .xls
  "text/csv",                                                            // .csv
  "application/csv",
];

export const excelUpload = multer({
  storage: memoryStorage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB max
  },
  fileFilter: (_req, file, cb) => {
    const isExcel =
      EXCEL_MIMES.includes(file.mimetype) ||
      /\.(xlsx|xls|csv)$/i.test(file.originalname);

    if (!isExcel) {
      return cb(new Error("Only Excel (.xlsx, .xls) or CSV files are allowed"));
    }
    cb(null, true);
  },
});

// ────────────────────────────────────────────────────────────
// IMAGE / GENERAL FILE UPLOAD
// ────────────────────────────────────────────────────────────
const IMAGE_MIMES = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"];

export const imageUpload = multer({
  storage: memoryStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
  },
  fileFilter: (_req, file, cb) => {
    if (!IMAGE_MIMES.includes(file.mimetype)) {
      return cb(new Error("Only image files (JPG, PNG, GIF, WEBP) are allowed"));
    }
    cb(null, true);
  },
});

// ────────────────────────────────────────────────────────────
// GENERIC ATTACHMENT UPLOAD (PDF, images, docs)
// ────────────────────────────────────────────────────────────
export const attachmentUpload = multer({
  storage: memoryStorage,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20 MB
    files: 5,                    // max 5 attachments
  },
});

// ────────────────────────────────────────────────────────────
// ERROR HANDLER MIDDLEWARE for multer errors
// ────────────────────────────────────────────────────────────
export const handleUploadError = (err: any, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ message: "File size too large" });
    }
    if (err.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({ message: "Too many files uploaded" });
    }
    return res.status(400).json({ message: err.message });
  }
  if (err?.message) {
    return res.status(400).json({ message: err.message });
  }
  next(err);
};
