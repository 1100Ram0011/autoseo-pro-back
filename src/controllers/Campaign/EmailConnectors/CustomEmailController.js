import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import tls from "tls";
import net from "net";
import EmailToken from "../../../models/Campaign/EmailCampaign/emailTokenSchema.js";
import { encrypt, decrypt } from "../../../utils/encryptionForMail.js";
import { detectEmailAccountType } from "../../../utils/emailTypeDetector.js";
import { autoResumePausedCampaigns } from "../../../utils/resumeCampaignsHelper.js";

const MAX_ACCOUNTS_PER_USER = 10;
const CONNECTION_TIMEOUT_MS = 15000; // 15 seconds

/**
 * Helper: user-friendly error messages
 */
const formatFriendlyError = (error, type) => {
    const msg = error.message || "";
    const code = error.code || "";

    if (code === "EAUTH" || msg.includes("535") || msg.includes("Authentication")) {
        return `${type} Authentication Failed: Please check your Email and App Password. Note: Some providers like Microsoft require App Passwords to be enabled by an Admin.`;
    }
    if (code === "ETIMEDOUT" || code === "ENOTFOUND" || code === "ECONNREFUSED") {
        return `Could not reach ${type} Server: Please check the Host and Port (e.g., you might be using the wrong port or your network blocks it).`;
    }
    if (msg.includes("UNABLE_TO_VERIFY_LEAF_SIGNATURE") || msg.includes("SELF_SIGNED_CERT") || msg.includes("DEPTH_ZERO")) {
        return `${type} SSL Certificate Error: The server uses a self-signed certificate. Please try again or contact your email administrator.`;
    }
    return `${type} Connection Failed: Verify your server settings. (${msg})`;
};

/**
 * Helper: Verify POP3 credentials via TLS socket
 * Connects to POP3 server and sends USER/PASS commands to validate credentials.
 */
const verifyPop3 = (host, port, user, pass) => {
    return new Promise((resolve, reject) => {
        const portNum = Number(port);
        const useImplicitTLS = portNum === 995;

        let socket;
        let dataBuffer = "";
        let step = "greeting"; // greeting → user → pass → quit
        const timeout = setTimeout(() => {
            socket?.destroy();
            reject(Object.assign(new Error(`POP3 connection timed out after ${CONNECTION_TIMEOUT_MS / 1000}s`), { code: "ETIMEDOUT" }));
        }, CONNECTION_TIMEOUT_MS);

        const cleanup = () => {
            clearTimeout(timeout);
            socket?.destroy();
        };

        const handleData = (data) => {
            dataBuffer += data.toString();
            const lines = dataBuffer.split("\r\n");
            dataBuffer = lines.pop(); // keep incomplete line in buffer

            for (const line of lines) {
                if (!line) continue;

                if (line.startsWith("-ERR")) {
                    cleanup();
                    return reject(Object.assign(new Error(`POP3: ${line}`), { code: "EAUTH" }));
                }

                if (line.startsWith("+OK")) {
                    if (step === "greeting") {
                        step = "user";
                        socket.write(`USER ${user}\r\n`);
                    } else if (step === "user") {
                        step = "pass";
                        socket.write(`PASS ${pass}\r\n`);
                    } else if (step === "pass") {
                        step = "quit";
                        socket.write("QUIT\r\n");
                        cleanup();
                        return resolve(true);
                    }
                }
            }
        };

        const handleError = (err) => {
            cleanup();
            reject(err);
        };

        if (useImplicitTLS) {
            socket = tls.connect({
                host,
                port: portNum,
                rejectUnauthorized: false,
            }, () => {
                // connected, wait for greeting
            });
        } else {
            // For non-standard ports, try plain TCP (net)
            socket = net.connect({ host, port: portNum }, () => {
                // connected, wait for greeting
            });
        }

        socket.setEncoding("utf8");
        socket.on("data", handleData);
        socket.on("error", handleError);
        socket.on("timeout", () => handleError(Object.assign(new Error("POP3 socket timeout"), { code: "ETIMEDOUT" })));
    });
};

/**
 * Connect Custom Email (SMTP & optional IMAP/POP3)
 */
export const connectCustomEmail = async (req, res) => {
    try {
        const {
            email,
            appPassword,
            smtpHost,
            smtpPort,
            receivingProtocol = "none", // "none" | "imap" | "pop3"
            imapHost,
            imapPort,
        } = req.body;

        console.log("[Custom Email] Incoming connection request for:", {
            email, smtpHost, smtpPort, receivingProtocol,
            ...(receivingProtocol !== "none" && { receivingHost: imapHost, receivingPort: imapPort })
        });

        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({ message: "Authentication required" });
        }

        // Validate required fields
        if (!email || !appPassword || !smtpHost || !smtpPort) {
            return res.status(400).json({ message: "Email, password, SMTP host, and SMTP port are required" });
        }

        // If receiving protocol is selected, validate its fields
        if (receivingProtocol !== "none" && (!imapHost || !imapPort)) {
            return res.status(400).json({
                message: `${receivingProtocol.toUpperCase()} host and port are required when receiving protocol is selected`
            });
        }

        // Check account limit
        const accountCount = await EmailToken.countDocuments({
            userId,
            provider: "custom",
            isActive: true,
        });

        if (accountCount >= MAX_ACCOUNTS_PER_USER) {
            return res.status(400).json({
                message: `Maximum ${MAX_ACCOUNTS_PER_USER} custom accounts allowed`,
                code: "MAX_ACCOUNTS_REACHED"
            });
        }

        // ── 1. Verify SMTP ──────────────────────────────────────────────────
        const smtpPortNum = Number(smtpPort);
        const smtpSecure = smtpPortNum === 465;

        const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: smtpPortNum,
            secure: smtpSecure,
            ...(smtpPortNum === 587 && { requireTLS: true }), // STARTTLS for port 587
            auth: {
                user: email,
                pass: appPassword,
            },
            connectionTimeout: CONNECTION_TIMEOUT_MS,
            greetingTimeout: CONNECTION_TIMEOUT_MS,
            socketTimeout: CONNECTION_TIMEOUT_MS,
            tls: {
                rejectUnauthorized: false, // Allow self-signed certificates
            },
        });

        try {
            const success = await transporter.verify();
            console.log("[Custom Email] SMTP verification passed for:", email, "| Result:", success);
        } catch (error) {
            console.error("[Custom Email] SMTP Verification failed:", {
                message: error.message,
                code: error.code,
                command: error.command,
                response: error.response,
            });
            return res.status(400).json({ message: formatFriendlyError(error, "SMTP") });
        }

        // ── 2. Verify Receiving Protocol (IMAP / POP3 / Skip) ───────────────
        if (receivingProtocol === "imap") {
            const imapClient = new ImapFlow({
                host: imapHost,
                port: Number(imapPort),
                secure: Number(imapPort) === 993,
                auth: {
                    user: email,
                    pass: appPassword,
                },
                logger: false,
                connectTimeout: CONNECTION_TIMEOUT_MS,
                tls: {
                    rejectUnauthorized: false,
                },
            });

            try {
                await imapClient.connect();
                console.log("[Custom Email] IMAP verification passed for:", email);
                await imapClient.logout();
            } catch (error) {
                console.error("[Custom Email] IMAP Verification failed:", error.message);
                return res.status(400).json({ message: formatFriendlyError(error, "IMAP") });
            } finally {
                // Ensure IMAP connection is always cleaned up
                try { imapClient.close(); } catch (_) { /* ignore cleanup errors */ }
            }
        } else if (receivingProtocol === "pop3") {
            try {
                await verifyPop3(imapHost, imapPort, email, appPassword);
                console.log("[Custom Email] POP3 verification passed for:", email);
            } catch (error) {
                console.error("[Custom Email] POP3 Verification failed:", error.message);
                return res.status(400).json({ message: formatFriendlyError(error, "POP3") });
            }
        } else {
            console.log("[Custom Email] Receiving protocol skipped (SMTP-only mode) for:", email);
        }

        // ── 3. Save to database ─────────────────────────────────────────────
        const domain = email.split("@")[1];
        const accountType = detectEmailAccountType(email, "custom");

        const metadata = {
            smtpHost,
            smtpPort: smtpPortNum,
            domain,
            receivingProtocol,
        };

        // Only store receiving server details if a protocol was selected
        if (receivingProtocol !== "none") {
            metadata.imapHost = imapHost;
            metadata.imapPort = Number(imapPort);
        }

        await EmailToken.findOneAndUpdate(
            {
                userId,
                provider: "custom",
                email: email.toLowerCase(),
            },
            {
                userId,
                provider: "custom",
                accountType,
                email: email.toLowerCase(),
                appPassword: encrypt(appPassword),
                isActive: true,
                status: "active",
                lastUsedAt: new Date(),
                metadata,
            },
            {
                upsert: true,
                new: true,
            }
        );

        await autoResumePausedCampaigns(userId);

        return res.status(200).json({ success: true, message: "Custom email connected successfully" });

    } catch (error) {
        console.error("[Custom Email] Connect error:", error);
        return res.status(500).json({ message: "Failed to connect custom email" });
    }
};

/**
 * Disconnect Custom Email
 */
export const disconnectCustomEmail = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { email } = req.body;

        if (!userId) {
            return res.status(401).json({ message: "Authentication required" });
        }

        if (!email) {
            return res.status(400).json({ message: "Email address is required" });
        }

        const result = await EmailToken.findOneAndUpdate(
            {
                userId,
                provider: "custom",
                email: email.toLowerCase(),
            },
            {
                isActive: false,
                status: "disconnected"
            },
            { new: true }
        );

        if (!result) {
            return res.status(404).json({ message: "Account not found" });
        }

        return res.json({ success: true, message: "Account disconnected", email: result.email });
    } catch (err) {
        console.error("[Custom Email] Disconnect error:", err.message);
        return res.status(500).json({ message: "Failed to disconnect account" });
    }
};
