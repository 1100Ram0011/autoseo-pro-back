import axios from "axios";
import logger from "../config/logger.js";
import { getAccessToken, refreshAccessToken } from "../config/mailer.js";

const MAX_RETRIES = 3;
const REQUEST_TIMEOUT = 30000; // 30 seconds
const BASE_DELAY = 3000; // base backoff

// Per-sender refresh locking (supports multi-mailbox)
const refreshMap = new Map();

/**
 * Safely refresh token (one refresh per sender at a time)
 */
async function safeRefresh(from) {
    if (!from) {
        throw new Error("Sender email (from) is required");
    }

    if (!refreshMap.has(from)) {
        const refreshPromise = refreshAccessToken(from)
            .then((newToken) => {
                logger.info(`[Auth] Token refreshed successfully for ${from}`);
                return newToken;
            })
            .catch((err) => {
                logger.error(
                    `[Auth] Token refresh failed for ${from}: ${err.message}`
                );
                throw err;
            })
            .finally(() => {
                refreshMap.delete(from);
            });

        refreshMap.set(from, refreshPromise);
    }

    return refreshMap.get(from);
}

/**
 * Send email via Microsoft Graph API
 */
export const sendOutlookMailDirect = async ({
    from,
    to,
    cc = "",
    subject,
    htmlBody,
    attachments = [],
}) => {
    if (!from) throw new Error("Sender email (from) is required");
    if (!to) throw new Error("Recipient email (to) is required");

    const graphUrl = `https://graph.microsoft.com/v1.0/users/${from}/sendMail`;

    // Build CC recipients
    const ccRecipients = cc
        ? cc.split(",").map((email) => ({
            emailAddress: { address: email.trim() },
        }))
        : [];

    // Build base email payload
    const emailData = {
        message: {
            subject,
            body: {
                contentType: "HTML",
                content: htmlBody,
            },
            toRecipients: [{ emailAddress: { address: to } }],
            ccRecipients,
        },
    };

    // Add attachments if provided
    // if (attachments?.length) {
    //     emailData.message.attachments = attachments.map((att) => ({
    //         "@odata.type": "#microsoft.graph.fileAttachment",
    //         name: att.filename,
    //         contentType: att.contentType || "application/octet-stream",
    //         contentBytes: Buffer.isBuffer(att.content)
    //             ? att.content.toString("base64")
    //             : att.content,
    //         isInline: att.isInline || false,
    //         contentId: att.contentId,
    //     }));
    // }

    if (attachments?.length) {

        const formattedAttachments = [];

        for (const att of attachments) {

            let base64Content;

            // if URL provided → download file
            if (att?.url) {
                logger.info(`[Attachment] Downloading from ${att.url}`);

                let finalUrl = att.url.trim();

                if (!/^https?:\/\//i.test(finalUrl)) {
                    finalUrl = `https://${finalUrl}`;
                }

                try {
                    const response = await axios.get(finalUrl, {
                        responseType: "arraybuffer",
                        timeout: 60000,
                    });

                    base64Content = Buffer.from(response.data).toString("base64");
                } catch (error) {
                    logger.error(`[Attachment] Failed to download from ${finalUrl}`, error.message);
                    throw error;
                }
            }
            //  If buffer provided (fallback)
            else if (att.content) {
                base64Content = Buffer.isBuffer(att.content)
                    ? att.content.toString("base64")
                    : att.content;
            }

            else {
                continue;
            }

            formattedAttachments.push({
                "@odata.type": "#microsoft.graph.fileAttachment",
                name: att.filename,
                contentType: att.contentType || "application/octet-stream",
                contentBytes: base64Content,
            });
        }

        emailData.message.attachments = formattedAttachments;
    }


    // Helper to send request
    const sendRequest = async (token) => {
        return axios.post(graphUrl, emailData, {
            timeout: REQUEST_TIMEOUT,
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
        });
    };

    let attempt = 0;
    let accessToken = getAccessToken(from);

    // If token missing initially → refresh
    if (!accessToken) {
        accessToken = await safeRefresh(from);
        if (!accessToken) {
            throw new Error(`No access token available for ${from}`);
        }
    }

    while (attempt < MAX_RETRIES) {
        try {
            attempt++;

            logger.info(
                `[Graph] Attempt ${attempt} | Sending to ${to}`
            );

            const response = await sendRequest(accessToken);

            if (response.status === 202) {
                logger.info(`[Graph] Email sent successfully to ${to}`);
                return { success: true };
            }

            throw new Error(`Unexpected status ${response.status}`);

        } catch (err) {
            const status = err.response?.status;
            const errorMsg =
                err.response?.data?.error?.message || err.message;

            logger.warn(
                `[Graph] Attempt ${attempt} failed | To: ${to} | Status: ${status} | ${errorMsg}`
            );

            // Token expired / unauthorized
            if (status === 401) {
                if (attempt === MAX_RETRIES) {
                    throw new Error("Token refresh failed after retries");
                }

                logger.warn("[Auth] Access token expired. Refreshing...");
                accessToken = await safeRefresh(from);
                continue;
            }

            // Rate limited
            if (status === 429) {
                const retryAfter =
                    parseInt(err.response?.headers?.["retry-after"]) || 5;

                const waitTime = retryAfter * 1000;

                logger.warn(
                    `[Graph] Rate limited. Waiting ${waitTime}ms before retry`
                );

                await new Promise((res) => setTimeout(res, waitTime));
                continue;
            }

            // Temporary server errors
            if ([500, 502, 503, 504].includes(status)) {
                const backoff = BASE_DELAY * attempt;

                logger.warn(
                    `[Graph] Server error ${status}. Retrying in ${backoff}ms`
                );

                await new Promise((res) => setTimeout(res, backoff));
                continue;
            }

            // Network error (no response object)
            if (!status) {
                const backoff = BASE_DELAY * attempt;

                logger.warn(
                    `[Graph] Network error. Retrying in ${backoff}ms`
                );

                await new Promise((res) => setTimeout(res, backoff));
                continue;
            }

            // Permanent failure
            throw new Error(`Graph API error: ${errorMsg}`);
        }
    }

    throw new Error(
        `Email failed after ${MAX_RETRIES} attempts for ${to}`
    );
};
