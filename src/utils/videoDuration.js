import os from "os";
import path from "path";
import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import ffmpeg from "fluent-ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

ffmpeg.setFfprobePath(ffprobeInstaller.path);

export async function getVideoDurationSecondsFromBuffer(buffer) {
  const tmpFile = path.join(os.tmpdir(), `mytekai-template-${uuidv4()}.mp4`);
  try {
    await fs.writeFile(tmpFile, buffer);
    const duration = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(tmpFile, (err, metadata) => {
        if (err) return reject(err);
        const seconds = metadata?.format?.duration;
        resolve(typeof seconds === "number" ? seconds : Number(seconds));
      });
    });
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error("Could not detect video duration");
    }
    return duration;
  } finally {
    await fs.unlink(tmpFile).catch(() => {});
  }
}

