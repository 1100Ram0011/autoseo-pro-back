import crypto from "crypto";
import config from "../config/config.js";

const ALGORITHM = "aes-256-gcm";

const SECRET_KEY = Buffer.from(
    config.CREDENTIAL_ENCRYPTION_KEY,
    "hex"
);

export const encrypt = (text) => {
    if (!SECRET_KEY || SECRET_KEY.length !== 32) {
        throw new Error("CREDENTIAL_ENCRYPTION_KEY must be 32 bytes (64 hex chars)");
    }

    const iv = crypto.randomBytes(12); // GCM standard = 12 bytes
    const cipher = crypto.createCipheriv(ALGORITHM, SECRET_KEY, iv);

    const encrypted = Buffer.concat([
        cipher.update(text, "utf8"),
        cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    // Store: iv:authTag:cipherText
    return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
};

export const decrypt = (encryptedText) => {
    if (!SECRET_KEY || SECRET_KEY.length !== 32) {
        throw new Error("CREDENTIAL_ENCRYPTION_KEY must be 32 bytes (64 hex chars)");
    }

    const [ivHex, tagHex, encryptedHex] = encryptedText.split(":");

    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(tagHex, "hex");
    const encryptedBuffer = Buffer.from(encryptedHex, "hex");

    const decipher = crypto.createDecipheriv(ALGORITHM, SECRET_KEY, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
        decipher.update(encryptedBuffer),
        decipher.final(),
    ]);

    return decrypted.toString("utf8");
};