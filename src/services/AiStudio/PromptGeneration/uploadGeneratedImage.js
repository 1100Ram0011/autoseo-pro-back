import config from "../../../config/config.js";
import { uploadToS3 } from "../../../utils/upload.js";



export const uploadGeneratedImage = async ({
    generationId,
    base64,
    outputFormat = "png",
}) => {
    if (!base64) {
        throw new Error("Generated image is missing.");
    }

    const extension =
        outputFormat || "png";

    const mimeType =
        `image/${extension}`;

    const buffer = Buffer.from(
        base64,
        "base64"
    );

    const fileName =
        `generation-${generationId}-${Date.now()}.${extension}`;

    const folder =
        config?.AWS_S3_GENERATED_IMAGES_FOLDER ||
        "prompt-template-images";

    const url =
        await uploadToS3(
            buffer,
            fileName,
            folder,
            mimeType,
            "inline"
        );

    return {
        url,
        key: `${folder}/${fileName}`,
        mimeType,
        size: buffer.length,
    };
};