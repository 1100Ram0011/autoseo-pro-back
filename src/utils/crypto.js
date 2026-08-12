import crypto from "crypto";
import config from "../config/config.js";
import CryptoJS from "crypto-js";

if (!config.CREDENTIAL_ENCRYPTION_KEY) {
    throw new Error("❌ CREDENTIAL_ENCRYPTION_KEY is missing in environment");
}

const secretKey = Buffer.from(
    config.CREDENTIAL_ENCRYPTION_KEY,
    "hex"
);

if (secretKey.length !== 32) {
    throw new Error("❌ Encryption key must be 32 bytes (64 hex characters)");
}

const algorithm = "aes-256-gcm";

export const encrypt = (text) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(algorithm, secretKey, iv);

    const encrypted = Buffer.concat([
        cipher.update(text, "utf8"),
        cipher.final(),
    ]);

    return {
        iv: iv.toString("hex"),
        content: encrypted.toString("hex"),
        tag: cipher.getAuthTag().toString("hex"),
    };
};



export const decrypt = (hash) => {
    const decipher = crypto.createDecipheriv(
        algorithm,
        secretKey,
        Buffer.from(hash.iv, "hex")
    );

    decipher.setAuthTag(Buffer.from(hash.tag, "hex"));

    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(hash.content, "hex")),
        decipher.final(),
    ]);

    return decrypted.toString("utf8");
};



export const encryptResponse = (data) => {
    const responseData = JSON.stringify(data)
    return CryptoJS.AES.encrypt(responseData, config.CREDENTIAL_ENCRYPTION_KEY).toString();
};
// console.log('encrypt', encryptResponse('hii'))