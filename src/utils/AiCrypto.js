import crypto from "crypto";
import config from "../config/config.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Derive encryption key from password using PBKDF2
 */
const getKey = (salt) => {
    return crypto.pbkdf2Sync(
        config.CREDENTIAL_ENCRYPTION_KEY,
        salt,
        100000,
        KEY_LENGTH,
        "sha512"
    );
};

/**
 * Encrypt sensitive data (like access tokens)
 */
export const encrypt = (text) => {
    if (!text) return null;

    const salt = crypto.randomBytes(SALT_LENGTH);
    const key = getKey(salt);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");

    const tag = cipher.getAuthTag();

    // Combine: salt + iv + tag + encrypted data
    return (
        salt.toString("hex") +
        iv.toString("hex") +
        tag.toString("hex") +
        encrypted
    );
};

/**
 * Decrypt sensitive data
 */
export const decrypt = (encryptedData) => {
    if (!encryptedData) return null;

    try {
        // Extract components
        const saltHex = encryptedData.slice(0, SALT_LENGTH * 2);
        const ivHex = encryptedData.slice(
            SALT_LENGTH * 2,
            SALT_LENGTH * 2 + IV_LENGTH * 2
        );
        const tagHex = encryptedData.slice(
            SALT_LENGTH * 2 + IV_LENGTH * 2,
            SALT_LENGTH * 2 + IV_LENGTH * 2 + TAG_LENGTH * 2
        );
        const encrypted = encryptedData.slice(
            SALT_LENGTH * 2 + IV_LENGTH * 2 + TAG_LENGTH * 2
        );

        const salt = Buffer.from(saltHex, "hex");
        const iv = Buffer.from(ivHex, "hex");
        const tag = Buffer.from(tagHex, "hex");

        const key = getKey(salt);
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);

        let decrypted = decipher.update(encrypted, "hex", "utf8");
        decrypted += decipher.final("utf8");

        return decrypted;
    } catch (err) {
        console.error("Decryption Error:", err);
        throw new Error("Failed to decrypt data");
    }
};

/**
 * Hash password (for user authentication)
 */
export const hashPassword = (password) => {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto
        .pbkdf2Sync(password, salt, 100000, 64, "sha512")
        .toString("hex");
    return `${salt}:${hash}`;
};

/**
 * Verify password
 */
export const verifyPassword = (password, hashedPassword) => {
    const [salt, originalHash] = hashedPassword.split(":");
    const hash = crypto
        .pbkdf2Sync(password, salt, 100000, 64, "sha512")
        .toString("hex");
    return hash === originalHash;
};