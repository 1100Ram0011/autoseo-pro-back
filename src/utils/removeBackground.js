/**
 * Removes the background from a base64 encoded image string.
 * Returns a base64 encoded PNG image with transparency.
 * 
 * @param {string} base64String - The base64 image (with or without data URI prefix)
 * @returns {Promise<string>} - Cleaned base64 string
 */
export async function removeBackgroundFromBase64(base64String) {
  try {
    let base64Data = base64String;

    if (base64String.startsWith("data:")) {
      const parts = base64String.split(",");
      base64Data = parts[1];
    }

    const buffer = Buffer.from(base64Data, "base64");
    
    // Import rembg dynamically as seen in pixverseVideoService.js
    const rembgModule = await import('rembg');
    
    // Some versions of rembg export default, others export removeBackground
    const removeBg = rembgModule.default || rembgModule.removeBackground || rembgModule.rembg;
    
    // rembg natively accepts a Buffer and returns a Buffer (with transparency)
    const resultBuffer = await removeBg(buffer);

    return resultBuffer.toString("base64");
  } catch (error) {
    console.error("Background removal failed:", error);
    throw error;
  }
}
