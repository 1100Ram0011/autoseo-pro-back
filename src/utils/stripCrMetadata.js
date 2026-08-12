import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export async function stripCrMetadata(input, type = 'image') {
    // 1. Normalize input to Buffer
    const inputBuffer = Buffer.isBuffer(input)
        ? input
        : Buffer.from(input.replace(/^data:\w+\/\w+;base64,/, ""), 'base64');

    if (type === 'image') {
        // Sharp handles buffers perfectly without hanging
        return await sharp(inputBuffer).rotate().toBuffer();
    }

    if (type === 'video') {
        // Use temporary files for Video to prevent "infinite" stream hangs
        const tempId = Date.now();
        const inputPath = path.join(os.tmpdir(), `input_${tempId}.mp4`);
        const outputPath = path.join(os.tmpdir(), `output_${tempId}.mp4`);

        try {
            await fs.writeFile(inputPath, inputBuffer);

            await new Promise((resolve, reject) => {
                ffmpeg(inputPath)
                    .outputOptions([
                        '-map_metadata -1', // Strip global metadata
                        '-c:v copy',        // Copy video without re-encoding
                        '-c:a copy',        // Copy audio without re-encoding
                        '-map_chapters -1', // Strip chapters
                        '-movflags +faststart' // Optimizes for web playback
                    ])
                    .on('error', (err) => reject(err))
                    .on('end', () => resolve())
                    .save(outputPath);
            });

            const resultBuffer = await fs.readFile(outputPath);

            // Cleanup temp files asynchronously
            Promise.all([fs.unlink(inputPath), fs.unlink(outputPath)]).catch(console.error);

            return resultBuffer;
        } catch (error) {
            // Ensure cleanup even on failure
            await Promise.all([fs.unlink(inputPath), fs.unlink(outputPath)].map(p => p.catch(() => { })));
            throw new Error(`Video stripping failed: ${error.message}`);
        }
    }
}