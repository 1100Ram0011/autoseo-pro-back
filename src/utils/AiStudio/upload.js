import multer from "multer";
import httpStatus from "http-status";

import ApiError from "../ApiError.js";

const storage = multer.memoryStorage();

const ALLOWED_IMAGE_TYPES = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
];

const ALLOWED_VIDEO_TYPES = [
    "video/mp4",
    "video/quicktime",
    "video/x-msvideo",      // .avi
    "video/x-matroska",     // .mkv
    "video/webm",
];

const ALLOWED_AUDIO_TYPES = [
    "audio/mpeg",           // .mp3
    "audio/mp3",
    "audio/wav",
    "audio/x-wav",
    "audio/wave",
    "audio/x-pn-wav",
    "audio/mp4",            // .m4a
    "audio/x-m4a",
    "audio/aac",
    "audio/ogg",
    "audio/webm",
];

const fileFilter = (req, file, cb) => {

    try {

        const field = file.fieldname;

        switch (field) {

            case "front":
            case "left":
            case "right":
            case "back":
            case "full_body":

                if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {

                    return cb(
                        new ApiError(
                            httpStatus.BAD_REQUEST,
                            `${field} must be a JPG, PNG or WEBP image.`
                        ),
                        false
                    );

                }

                break;

            case "video":

                if (!ALLOWED_VIDEO_TYPES.includes(file.mimetype)) {

                    return cb(
                        new ApiError(
                            httpStatus.BAD_REQUEST,
                            "Video must be MP4, MOV, AVI, MKV or WEBM."
                        ),
                        false
                    );

                }

                break;

            case "audio":

                if (!ALLOWED_AUDIO_TYPES.includes(file.mimetype)) {

                    return cb(
                        new ApiError(
                            httpStatus.BAD_REQUEST,
                            "Audio must be MP3, WAV, M4A, AAC, OGG or WEBM."
                        ),
                        false
                    );

                }

                break;

            default:

                return cb(
                    new ApiError(
                        httpStatus.BAD_REQUEST,
                        `Unexpected upload field: ${field}`
                    ),
                    false
                );

        }

        cb(null, true);

    } catch (error) {

        cb(error, false);

    }

};

const upload = multer({

    storage,

    fileFilter,

    limits: {

        fileSize: 100 * 1024 * 1024, // 100MB

        files: 7,

    },

});

export default upload;