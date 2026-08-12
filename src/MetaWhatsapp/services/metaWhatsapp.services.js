import MetaGraphClient from "./metaFbWhatsapp.client.js";

// ─── SUBMIT TEMPLATE TO META ──────────────────────────────────────────────────
export const submitTemplateToMeta = async ({ wabaId, payload, accessToken }) => {
    return MetaGraphClient.createTemplate(wabaId, accessToken, payload);
};

// ─── FETCH TEMPLATE STATUS FROM META ─────────────────────────────────────────
export const fetchTemplateFromMeta = async ({ wabaId, metaTemplateId, accessToken }) => {
    try {
        return await MetaGraphClient.fetchTemplates(wabaId, accessToken, metaTemplateId);
    } catch (error) {
        console.log(error, "error");
        throw error;
    }
};

// ─── DELETE TEMPLATE FROM META ────────────────────────────────────────────────
export const deleteTemplateFromMeta = async ({ wabaId, templateName, accessToken }) => {
    return MetaGraphClient.deleteTemplate(wabaId, accessToken, templateName);
};

// ─── SEND TEMPLATE MESSAGE ────────────────────────────────────────────────────
export const sendTemplateMessage = async ({
    phoneNumberId,
    to,
    templateName,
    templateLanguage,
    components = [],
    accessToken
}) => {
    const payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to.replace(/\D/g, ""),
        type: "template",
        template: {
            name: templateName,
            language: { code: templateLanguage },
            ...(components.length > 0 && { components })
        }
    };
    return MetaGraphClient.sendMessage(phoneNumberId, accessToken, payload);
};

export default {
    submitTemplateToMeta,
    fetchTemplateFromMeta,
    deleteTemplateFromMeta,
    sendTemplateMessage
};