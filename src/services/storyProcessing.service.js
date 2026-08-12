import fs from "fs";
import path from "path";
import os from "os";
import axios from "axios";
import sharp from "sharp";
import ffmpeg from "fluent-ffmpeg";
import { uploadFileToS3 } from "./s3.service.js";

/**
 * Downloads a file from a URL to the local filesystem
 */
const downloadMedia = async (mediaUrl, outputPath) => {
  const response = await axios({
    url: mediaUrl,
    method: "GET",
    responseType: "stream",
    timeout: 1000 * 60 * 10,
  });

  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(outputPath);
    response.data.pipe(writer);
    writer.on("finish", () => resolve(outputPath));
    writer.on("error", reject);
  });
};

/**
 * Processes an image to 9:16 aspect ratio (1080x1920)
 * Uses a blurred, darkened version of the original image as the background.
 */
export const processImageForStory = async (imageUrl, processedVideoId = Date.now()) => {
  const tempDir = path.join(os.tmpdir(), `story_processing_${processedVideoId}`);
  await fs.promises.mkdir(tempDir, { recursive: true });

  const inputPath = path.join(tempDir, "input_image.jpg");
  const outputPath = path.join(tempDir, "output_image.jpg");

  try {
    await downloadMedia(imageUrl, inputPath);

    const originalBuffer = await sharp(inputPath).toBuffer();

    // Create blurred background
    const backgroundBuffer = await sharp(originalBuffer)
      .resize(1080, 1920, { fit: "cover" })
      .blur(40)
      .modulate({ brightness: 0.6 }) // Darken it slightly to make foreground pop
      .toBuffer();

    // Create foreground fitted image
    const foregroundBuffer = await sharp(originalBuffer)
      .resize(1080, 1920, { fit: "inside" })
      .toBuffer();

    // Composite
    await sharp(backgroundBuffer)
      .composite([{ input: foregroundBuffer, gravity: "center" }])
      .jpeg({ quality: 90 })
      .toFile(outputPath);

    // Upload to S3
    const s3Key = `processed-stories/${processedVideoId}/story_image.jpg`;
    const url = await uploadFileToS3({
      filePath: outputPath,
      s3Key,
      contentType: "image/jpeg",
    });

    return url;
  } catch (error) {
    console.error("Error processing story image:", error);
    throw error;
  } finally {
    // Cleanup
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
};

/**
 * Processes a video to 9:16 aspect ratio (1080x1920)
 * Uses a blurred version of the video as the background.
 */
export const processVideoForStory = async (videoUrl, processedVideoId = Date.now()) => {
  const tempDir = path.join(os.tmpdir(), `story_processing_${processedVideoId}`);
  await fs.promises.mkdir(tempDir, { recursive: true });

  const inputPath = path.join(tempDir, "input_video.mp4");
  const outputPath = path.join(tempDir, "output_video.mp4");

  try {
    await downloadMedia(videoUrl, inputPath);

    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .complexFilter([
          // Background: Scale to fill (crop if needed), blur heavily, darken
          "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=20,colorchannelmixer=rr=0.6:gg=0.6:bb=0.6[bg]",
          // Foreground: Scale to fit inside
          "[0:v]scale=1080:1920:force_original_aspect_ratio=decrease[fg]",
          // Overlay foreground onto background centered
          "[bg][fg]overlay=(W-w)/2:(H-h)/2[outv]",
        ])
        .outputOptions([
          "-map [outv]",
          "-map 0:a?", // Include audio if present
          "-c:v libx264",
          "-preset fast",
          "-crf 23",
          "-c:a aac",
          "-b:a 128k",
          "-movflags +faststart",
        ])
        .output(outputPath)
        .on("end", () => {
          console.log(`Story video processing completed for ${processedVideoId}`);
          resolve();
        })
        .on("error", (err) => {
          console.error("FFmpeg error:", err);
          reject(err);
        })
        .run();
    });

    // Upload to S3
    const s3Key = `processed-stories/${processedVideoId}/story_video.mp4`;
    const url = await uploadFileToS3({
      filePath: outputPath,
      s3Key,
      contentType: "video/mp4",
    });

    return url;
  } catch (error) {
    console.error("Error processing story video:", error);
    throw error;
  } finally {
    // Cleanup
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
};
