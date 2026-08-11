import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

/**
 * Saves a file buffer to the local disk in the public/uploads directory.
 * @param fileBuffer The raw file buffer (e.g., from multer memory storage)
 * @param originalName The original file name
 * @param subfolder Optional subfolder inside uploads (e.g., 'email-attachments')
 * @returns The public URL and the relative file path
 */
export const uploadLocalFile = async (
  fileBuffer: Buffer,
  originalName: string,
  subfolder: string = "general"
): Promise<{ url: string; key: string }> => {
  return new Promise((resolve, reject) => {
    try {
      // Define the base upload directory (public/uploads)
      const baseDir = path.join(process.cwd(), "public", "uploads", subfolder);
      
      // Ensure the directory exists
      if (!fs.existsSync(baseDir)) {
        fs.mkdirSync(baseDir, { recursive: true });
      }

      // Generate a unique file name to avoid collisions
      const ext = path.extname(originalName) || "";
      const fileName = `${uuidv4()}${ext}`;
      const filePath = path.join(baseDir, fileName);

      // Write the file to disk
      fs.writeFileSync(filePath, fileBuffer);

      // The public URL path (assuming express.static('public') is configured in app.ts)
      const publicUrl = `/uploads/${subfolder}/${fileName}`;

      resolve({ url: publicUrl, key: filePath });
    } catch (error) {
      reject(error);
    }
  });
};
