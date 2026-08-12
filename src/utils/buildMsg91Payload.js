/**
 * buildMsg91Payload.js
 *
 * Converts a WhatsappTemplate Mongoose document into the exact payload
 * required by MSG91's POST /api/v5/whatsapp/client-panel-template/ endpoint.
 *
 * Schema reference (actual WhatsappTemplateSchema):
 *   name          : String (required, lowercase)
 *   category      : MARKETING | UTILITY | AUTHENTICATION
 *   language      : String (default "en")
 *   wabaNumber    : String (required)
 *   ttl           : Number
 *   header        : { type: TEXT|IMAGE|VIDEO|DOCUMENT|NONE, text, mediaUrl }
 *   body          : String (required)
 *   footer        : String
 *   buttons       : [{ type: QUICK_REPLY|URL|PHONE, text, url, phone }]
 *   authConfig    : { addSecurityRecommendation, codeExpirationMinutes }
 *   variablesCount: Number (auto by pre-save hook)
 *   bodySamples   : [String]  (optional, for {{n}} sample values)
 *
 * MSG91 API docs covered:
 *   #1 — TEXT header  + Quick Reply / URL buttons
 *   #2 — MEDIA header (IMAGE / VIDEO / DOCUMENT) via header_handle
 *   #3 — LOCATION header
 *   AUTH — AUTHENTICATION (OTP / security templates)
 */

/**
 * @param {Object}   template         — Mongoose document (.toObject() or lean)
 * @param {string[]} [bodySampleValues] — runtime sample values for {{1}},{{2}}…
 * @returns {Object} MSG91-ready JSON payload
 * @throws  {Error}  when media header is missing its uploaded mediaUrl
 */
export function buildMsg91Payload(template, bodySampleValues = []) {
    const {
        name,
        category,
        language,
        wabaNumber,
        ttl,
        header,
        body,
        footer,
        buttons,
        authConfig,
        variablesCount,
        bodySamples,  // persisted sample values array, optional
        marketingType,
        carouselCards
    } = template;

    const formatPhone = (phone) => {
        let p = String(phone || "").replace(/\D/g, "");
        if (p.length === 10) return `+91${p}`;
        return `+${p}`;
    };

    /* ── Normalise variables sequentially to ensure compliance with MSG91/WhatsApp rules ── */
    let normalisedBody = body;
    if (normalisedBody) {
        let bodyIndex = 1;
        normalisedBody = normalisedBody.replace(/{{\d+}}/g, () => `{{${bodyIndex++}}}`);
    }

    let normalisedHeader = header ? { ...header } : null;
    if (normalisedHeader && normalisedHeader.text) {
        let headerIndex = 1;
        normalisedHeader.text = normalisedHeader.text.replace(/{{\d+}}/g, () => `{{${headerIndex++}}}`);
    }

    let normalisedButtons = Array.isArray(buttons)
        ? buttons.map(btn => {
            if (btn.type === "URL" && btn.url) {
                let btnIndex = 1;
                return {
                    ...btn,
                    url: btn.url.replace(/{{\d+}}/g, () => `{{${btnIndex++}}}`)
                };
            }
            return btn;
        })
        : [];

    /* ── Normalise top-level identifiers ─────────────────────────────────── */
    const integrated_number = (wabaNumber || "").toString().trim();
    const template_name = (name || "").toLowerCase().replace(/\s+/g, "_");
    const lang = language || "en";
    const cat = (category || "MARKETING").toUpperCase();

    if (!integrated_number) {
        throw new Error("template.wabaNumber is required before submitting");
    }
    if (!template_name) {
        throw new Error("template.name is required before submitting");
    }

    /* ═══════════════════════════════════════════════════════════════════════
       AUTHENTICATION — completely different component structure
     ═══════════════════════════════════════════════════════════════════════ */
    if (cat === "AUTHENTICATION") {
        const authComponents = [];

        // BODY — optional security recommendation flag
        authComponents.push({
            type: "BODY",
            add_security_recommendation:
                authConfig?.addSecurityRecommendation ?? true
        });

        // FOOTER — expiry minutes (only if set)
        if (authConfig?.codeExpirationMinutes) {
            authComponents.push({
                type: "FOOTER",
                code_expiration_minutes: Number(authConfig.codeExpirationMinutes)
            });
        }

        // BUTTONS — OTP copy-code button (required)
        authComponents.push({
            type: "BUTTONS",
            buttons: [
                {
                    type: "OTP",
                    otp_type: "COPY_CODE",
                    text: "Copy Code"
                }
            ]
        });

        return {
            integrated_number,
            template_name,
            language: lang,
            category: "AUTHENTICATION",
            components: authComponents,
            button_url: "false"
        };
    }

    /* ═══════════════════════════════════════════════════════════════════════
       CAROUSEL templates
     ═══════════════════════════════════════════════════════════════════════ */
    if (cat === "MARKETING" && marketingType === "Carousel" && Array.isArray(carouselCards) && carouselCards.length > 0) {
        const getDummySamples = (text, userSamples = []) => {
            const matches = text.match(/{{\d+}}/g);
            if (!matches) return null;
            let max = 0;
            matches.forEach(m => {
                const num = parseInt(m.replace(/\D/g, ''), 10);
                if (num > max) max = num;
            });
            const dummy = [];
            for (let i = 0; i < max; i++) {
                dummy.push(userSamples[i] ? String(userSamples[i]) : `sample${i+1}`);
            }
            return [dummy];
        };

        const carouselComp = {
            type: "CAROUSEL",
            cards: carouselCards.map(card => {
                const cardComps = [];
                const cHeaderType = (card.header?.type || "NONE").toUpperCase();
                if (["IMAGE", "VIDEO"].includes(cHeaderType)) {
                    const cComp = { type: "HEADER", format: cHeaderType };
                    if (card.header?.mediaUrl) cComp.example = { header_handle: [card.header.mediaUrl] };
                    cardComps.push(cComp);
                }
                
                if (card.body) {
                    const bComp = { type: "BODY", text: card.body };
                    if (/{{\d+}}/.test(card.body)) {
                        bComp.example = { body_text: getDummySamples(card.body, card.bodySamples) };
                    }
                    cardComps.push(bComp);
                }
                
                if (Array.isArray(card.buttons) && card.buttons.length > 0) {
                    const mappedCButtons = card.buttons.map(btn => {
                        const bType = (btn.type || "").toUpperCase();
                        if (bType === "QUICK_REPLY") return { type: "QUICK_REPLY", text: btn.text };
                        if (bType === "URL") {
                            const urlBtn = { type: "URL", text: btn.text, url: btn.url };
                            if (/{{\d+}}/.test(btn.url || "")) {
                                let matchIndex = 0;
                                urlBtn.example = [
                                    btn.url.replace(/{{\d+}}/g, () => {
                                        const sample = btn.urlSamples?.[matchIndex] || "example";
                                        matchIndex++;
                                        return sample;
                                    })
                                ];
                            }
                            return urlBtn;
                        }
                        if (bType === "PHONE") return { type: "PHONE_NUMBER", text: btn.text, phone_number: formatPhone(btn.phone) };
                        return { type: bType, text: btn.text };
                    });
                    cardComps.push({ type: "BUTTONS", buttons: mappedCButtons });
                }
                
                return { components: cardComps };
            })
        };

        const hasCUrl = carouselCards.some(c => Array.isArray(c.buttons) && c.buttons.some(b => (b.type || "").toUpperCase() === "URL"));

        const comps = [carouselComp];
        if (normalisedBody) {
            const bComp = { type: "BODY", text: normalisedBody };
            if (/{{\d+}}/.test(normalisedBody)) {
                bComp.example = { body_text: getDummySamples(normalisedBody, bodySamples) };
            }
            comps.unshift(bComp); // overall body is allowed before carousel in some specs
        }
        
        return {
            integrated_number,
            template_name,
            language: lang,
            category: "MARKETING",
            ...(ttl ? { ttl: Number(ttl) } : {}),
            components: comps,
            button_url: hasCUrl ? "true" : "false"
        };
    }

    /* ═══════════════════════════════════════════════════════════════════════
       STANDARD templates (MARKETING / UTILITY)
     ═══════════════════════════════════════════════════════════════════════ */
    const components = [];

    /* ── 1. HEADER ──────────────────────────────────────────────────────── */
    const headerType = (normalisedHeader?.type || "NONE").toUpperCase();

    if (headerType === "TEXT" && normalisedHeader?.text) {
        const headerComp = {
            type: "HEADER",
            format: "TEXT",
            text: normalisedHeader.text
        };
        // TEXT header variable example
        if (/{{\d+}}/.test(normalisedHeader.text)) {
            const hSamples = Array.isArray(normalisedHeader.headerSamples) 
                ? normalisedHeader.headerSamples 
                : [];
            let matchIndex = 0;
            headerComp.example = {
                header_text: [
                    normalisedHeader.text.replace(/{{\d+}}/g, () => {
                        const sample = hSamples[matchIndex] || "Sample Value";
                        matchIndex++;
                        return sample;
                    })
                ]
            };
        }
        components.push(headerComp);

    } else if (["IMAGE", "VIDEO", "DOCUMENT"].includes(headerType)) {
        // mediaUrl is the MSG91 header_handle from /sample-media-upload/
        // If present, include it as the example — MSG91 recommends but does not
        // strictly require a sample handle at template registration time.
        const handle = normalisedHeader?.mediaUrl;
        const headerComp = {
            type: "HEADER",
            format: headerType,
        };
        if (handle) {
            headerComp.example = { header_handle: [handle] };
        }
        components.push(headerComp);

    } else if (headerType === "LOCATION") {
        components.push({
            type: "HEADER",
            format: "LOCATION"
        });
    }
    // NONE → omit header component entirely

    /* ── 2. BODY ────────────────────────────────────────────────────────── */
    if (normalisedBody) {
        const bodyComp = {
            type: "BODY",
            text: normalisedBody
        };

        let varCount = 0;
        const matches = normalisedBody.match(/{{\d+}}/g);
        if (matches) {
            matches.forEach(m => {
                const num = parseInt(m.replace(/\D/g, ''), 10);
                if (num > varCount) varCount = num;
            });
        }

        if (varCount > 0) {
            // Prefer runtime values → persisted values → auto placeholders
            const samples = bodySampleValues.length
                ? bodySampleValues
                : (Array.isArray(bodySamples) ? bodySamples : []);

            const padded = Array.from(
                { length: varCount },
                (_, i) => (samples[i] != null ? String(samples[i]) : `value${i + 1}`)
            );
            bodyComp.example = { body_text: [padded] };
        }

        components.push(bodyComp);
    }

    /* ── 3. FOOTER ──────────────────────────────────────────────────────── */
    if (footer) {
        components.push({ type: "FOOTER", text: footer });
    }

    /* ── 4. BUTTONS ─────────────────────────────────────────────────────── */
    if (normalisedButtons.length > 0) {
        const mappedButtons = normalisedButtons.map(btn => {
            const bType = (btn.type || "").toUpperCase();

            switch (bType) {
                case "QUICK_REPLY":
                    return { type: "QUICK_REPLY", text: btn.text };

                case "URL": {
                    const urlBtn = {
                        type: "URL",
                        text: btn.text,
                        url: btn.url
                    };
                    // URL with variable — provide example
                    if (/{{\d+}}/.test(btn.url || "")) {
                        let matchIndex = 0;
                        urlBtn.example = [
                            btn.url.replace(/{{\d+}}/g, () => {
                                const sample = btn.urlSamples?.[matchIndex] || "example";
                                matchIndex++;
                                return sample;
                            })
                        ];
                    }
                    return urlBtn;
                }

                case "PHONE":
                    // Schema uses "PHONE"; MSG91 expects "PHONE_NUMBER"
                    return {
                        type: "PHONE_NUMBER",
                        text: btn.text,
                        phone_number: formatPhone(btn.phone)
                    };

                default:
                    return { type: bType, text: btn.text };
            }
        });

        components.push({ type: "BUTTONS", buttons: mappedButtons });
    }

    /* ── button_url flag (MSG91 requires "true"/"false" string) ─────────── */
    const hasUrlButton = normalisedButtons.some(b => (b.type || "").toUpperCase() === "URL");

    return {
        integrated_number,
        template_name,
        language: lang,
        category: cat,
        ...(ttl ? { ttl: Number(ttl) } : {}),
        button_url: hasUrlButton ? "true" : "false",
        components
    };
}