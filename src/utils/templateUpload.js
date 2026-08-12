import multer from "multer";

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
    const allowed = [
        // Images
        "image/png",
        "image/jpeg",
        "image/jpg",

        // PDF
        "application/pdf",

        // Videos
        "video/mp4",
        "video/mpeg",
        "video/quicktime",   // .mov
        "video/x-msvideo",   // .avi
        "video/x-matroska",  // .mkv
        "video/webm",


        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
        "text/csv",
    ];

    if (allowed.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error("Only images and PDFs allowed for templates"), false);
    }
};

export const templateUpload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024,
        files: 5,
    },
});
