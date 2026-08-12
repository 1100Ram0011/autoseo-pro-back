import axios from "axios";
import config from "../config/config.js";
import logger from "../config/logger.js";
import BusinessSummaryProfile from "../models/BusinessSummaryProfile.js";

/**
 * Generate an email template using Claude Haiku based on a prompt
 * and the user's business profile data.
 */
// export async function generateEmailTemplateWithAI({ prompt, businessProfile, userId, saveAs }) {
//   const brandName = businessProfile?.analysis?.business_overview?.brand_name || "the business";
//   const summary = businessProfile?.analysisSummary || "";
//   const brandColors = businessProfile?.analysis?.branding_guidelines?.brand_colors || [];
//   const fonts = businessProfile?.analysis?.branding_guidelines?.fonts || [];
//   const contactInfo = businessProfile?.analysis?.contact_info || {};
//   const valueProposition = businessProfile?.analysis?.business_overview?.core_value_proposition || "";
//   const visualStyle = businessProfile?.analysis?.branding_guidelines?.visual_style || "";
//   const logoUrl = businessProfile?.analysis?.branding_guidelines?.logo_url || "";

//   const systemPrompt = `You are a world-class email template designer, an expert at creating professional, high-converting email templates. You create beautiful, professional, responsive HTML email templates.
// carry the structure like unlayer editor every template should support according to Unlayer Editor.
// BUSINESS CONTEXT:
// - Brand Name: ${brandName}
// - Value Proposition: ${valueProposition}
// - Visual Style: ${visualStyle}
// - Brand Colors: ${brandColors.join(", ")}
// - Fonts: ${fonts.join(", ")}
// - Logo URL: ${logoUrl}
// - Contact Info: ${JSON.stringify(contactInfo)}
// - Business Summary: ${summary.slice(0, 800)}
// - Don't Add Unsubscribe from marketing emails for this
// - Dont add any links unnecessory which are not found
// - Don't Add BoradeAI branding or footer for other brands
// - Don't Add Unnecessary text in the email & background color also.
// - Make the email looks professional and modern.
// - Make sure Email are responsive and good looking.
// - Make sure the subject line is catchy and relevant to the email content.
// - Make sure the design is simple, clean, and modern.
// - Template Variable Should be Combined No Spaces And Gaps Example : [FIRSTNAME] not [FIRST NAME]

// RULES:
// 1. Return ONLY a JSON object with this exact schema — no markdown, no explanations:
// {
//   "name": "string (template name, max 60 chars)",
//   "subject": "string (email subject line)",
//   "html": "string (complete responsive HTML email template)",
//   "description": "string (1-2 sentence description of the template)",
//   "design": {
//     "body": {
//       "rows": [
//         {
//           "cells": [1],
//           "columns": [
//             {
//               "contents": [
//                 {
//                   "type": "text",
//                   "values": { "text": "string (HTML content for this text block)" }
//                 }
//               ]
//             }
//           ]
//         }
//       ]
//     }
//   }
// }

// 2. The HTML must be:
//    - Fully responsive using inline CSS
//    - Professional, modern, and visually appealing
//    - Include placeholder variables using {{variable_name}} syntax

// 3. Output ONLY valid JSON. No markdown fences.`;

//   const response = await axios.post(
//     "https://api.anthropic.com/v1/messages",
//     {
//       model: "claude-haiku-4-5-20251001",
//       max_tokens: 8000,
//       temperature: 0.4,
//       system: systemPrompt,
//       messages: [{ role: "user", content: `Generate an email template for: ${prompt}` }],
//     },
//     {
//       headers: {
//         "Content-Type": "application/json",
//         "x-api-key": config.ANTHROPIC_API_KEY,
//         "anthropic-version": "2023-06-01",
//       },
//       timeout: 120000,
//     }
//   );

//   const blocks = response?.data?.content;
//   if (!Array.isArray(blocks)) throw new Error("Invalid Claude response");

//   let text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
//   text = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

//   const parsed = JSON.parse(text);

//   if (!parsed.name || !parsed.subject || !parsed.html) {
//     throw new Error("Incomplete template data from AI");
//   }

//   // Final Normalization: Repair design and inject locked BoradeAI footer
//   const finalDesign = await normalizeUnlayerDesign(parsed.design, parsed.html, brandName, userId, saveAs);

//   return {
//     name: parsed.name,
//     subject: parsed.subject,
//     html: parsed.html,
//     design: finalDesign,
//     description: parsed.description || "",
//   };
// }

export async function generateEmailTemplateWithAI({
  prompt,
  businessProfile,
  userId,
  saveAs,
}) {
  const brandName =
    businessProfile?.analysis?.business_overview?.brand_name || "the business";
  const summary = businessProfile?.analysisSummary || "";
  const brandColors =
    businessProfile?.analysis?.branding_guidelines?.brand_colors || [];
  const fonts = businessProfile?.analysis?.branding_guidelines?.fonts || [];
  const contactInfo = businessProfile?.analysis?.contact_info || {};
  const valueProposition =
    businessProfile?.analysis?.business_overview?.core_value_proposition || "";
  const visualStyle =
    businessProfile?.analysis?.branding_guidelines?.visual_style || "";
  const logoUrl =
    businessProfile?.analysis?.branding_guidelines?.logo_url || "";

  // Extract clean hex colors
  const extractHex = (colorStr) => {
    const match = colorStr.match(/#[0-9A-Fa-f]{6}/);
    return match ? match[0] : null;
  };
  const hexColors = brandColors.map((c) => extractHex(c)).filter(Boolean);
  const primaryColor = hexColors[0] || "#1f2631";
  const accentColor = hexColors[1] || "#e5873a";

  const systemPrompt = `You are an expert Unlayer email template designer. You create professional, responsive email templates that work perfectly in the Unlayer editor.

BUSINESS CONTEXT:
- Brand Name: ${brandName}
- Value Proposition: ${valueProposition}
- Visual Style: ${visualStyle}
- Brand Colors: ${hexColors.join(", ")}
- Primary Color: ${primaryColor}
- Accent Color: ${accentColor}
- Fonts: ${fonts.join(", ")}
- Logo URL: ${logoUrl}
- Contact Info: ${JSON.stringify(contactInfo)}
- Business Summary: ${summary.slice(0, 800)}

CRITICAL RULES:
1. Return ONLY valid JSON - no markdown fences, no explanations
2. Use ONLY Unlayer-native block types: "text", "image", "button", "divider"
3. DO NOT use custom CSS classes - use inline styles only
4. DO NOT add unnecessary links, BoradeAI branding, or unsubscribe text
5. Variables must be: {{variableName}} with NO SPACES (e.g., {{firstName}} not {{first name}})
6. Keep design clean, modern, and professional
7. ESCAPE all quotes and newlines (\\n) in string values properly. NO raw line breaks in strings.
8. Return MINIFIED JSON (no unnecessary whitespace) to ensure the response isn't truncated.
COPYWRITING RULES - HUMANIZED CONTENT:
1. HUMAN TONE: Write like a knowledgeable friend, not a corporate bot. The email should sound like it was written by a real person (warm, direct, empathetic).
2. NO AI CLICHES: ABSOLUTELY DO NOT use stereotypical AI words like "Unlock", "Elevate", "Dive into", "Delve", "Discover", "Revolutionize", "Unleash", "Embark", or "Seamless". Use simple, everyday conversational language.
3. PERSONALIZATION: Always open with "Hi {{firstName}}," on its own line. Follow with a warm opening sentence acknowledging the reader's situation.
4. BODY COPY: Keep paragraphs short (2-4 sentences max). Use active voice. Include at least one specific benefit, not just a feature.
5. NO FILLER: Do not add placeholder lorem ipsum text or generic disclaimers. Use specific, persuasive language.
6. CTA BUTTON: One primary CTA per email. Text should be action-oriented and specific (e.g., "Start My Free Trial", "See My Results").
7. STRICTLY NO AI FORMATTING OR TICS: ABSOLUTELY DO NOT use em dashes (— or -) for emphasis. Do NOT use AI introductory phrases (e.g., "Here is..."). Do NOT include any meta-commentary, notes, or filler words. Output ONLY the clean, final text.

EXACT JSON SCHEMA:
{
  "name": "string (max 60 chars)",
  "subject": "string (catchy email subject)",
  "html": "string (complete responsive HTML with inline CSS only)",
  "description": "string (1-2 sentences)",
  "design": {
    "counters": {
      "u_column": 3,
      "u_row": 3,
      "u_content_text": 5,
      "u_content_image": 1,
      "u_content_button": 1
    },
    "body": {
      "id": "u_body",
      "rows": [
        {
          "id": "u_row_1",
          "cells": [1],
          "columns": [{
            "id": "u_column_1",
            "contents": [
              {
                "id": "u_content_image_1",
                "type": "image",
                "values": {
                  "src": { "url": "${logoUrl}", "width": 140, "height": 50 },
                  "altText": "${brandName} Logo",
                  "textAlign": "center",
                  "containerPadding": "40px 10px 20px 10px",
                  "_meta": { "htmlID": "u_content_image_1", "htmlClassNames": "u_content_image" }
                }
              },
              {
                "id": "u_content_text_1",
                "type": "text",
                "values": {
                  "text": "<h1 style=\\"margin:0;color:${primaryColor};font-size:24px;font-weight:600;\\">Your Heading</h1>",
                  "textAlign": "center",
                  "containerPadding": "10px 30px 30px 30px",
                  "_meta": { "htmlID": "u_content_text_1", "htmlClassNames": "u_content_text" }
                }
              }
            ],
            "values": {
              "backgroundColor": "${primaryColor}",
              "padding": "0px",
              "_meta": { "htmlID": "u_column_1", "htmlClassNames": "u_column" }
            }
          }],
          "values": {
            "backgroundColor": "transparent",
            "padding": "0px",
            "_meta": { "htmlID": "u_row_1", "htmlClassNames": "u_row" }
          }
        },
        {
          "id": "u_row_2",
          "cells": [1],
          "columns": [{
            "id": "u_column_2",
            "contents": [
              {
                "id": "u_content_text_2",
                "type": "text",
                "values": {
                  "text": "<p style=\\"margin:0;color:#374151;font-size:16px;line-height:1.6;\\">Hi {{firstName}},</p>",
                  "textAlign": "left",
                  "containerPadding": "40px 30px 20px 30px",
                  "_meta": { "htmlID": "u_content_text_2", "htmlClassNames": "u_content_text" }
                }
              },
              {
                "id": "u_content_text_3",
                "type": "text",
                "values": {
                  "text": "<p style=\\"margin:0;color:#374151;font-size:16px;line-height:1.8;\\">Your main message content here...</p>",
                  "textAlign": "left",
                  "containerPadding": "10px 30px 20px 30px",
                  "_meta": { "htmlID": "u_content_text_3", "htmlClassNames": "u_content_text" }
                }
              },
              {
                "id": "u_content_button_1",
                "type": "button",
                "values": {
                  "text": "<strong><span style=\\"font-size:16px;\\">Call to Action</span></strong>",
                  "href": { "name": "web", "values": { "href": "", "target": "_blank" } },
                  "buttonColors": {
                    "color": "#ffffff",
                    "backgroundColor": "${accentColor}",
                    "hoverColor": "#ffffff",
                    "hoverBackgroundColor": "${accentColor}"
                  },
                  "size": { "autoWidth": true, "width": "100%" },
                  "textAlign": "center",
                  "padding": "14px 40px",
                  "borderRadius": "8px",
                  "containerPadding": "20px 30px 40px 30px",
                  "_meta": { "htmlID": "u_content_button_1", "htmlClassNames": "u_content_button" }
                }
              }
            ],
            "values": {
              "backgroundColor": "#ffffff",
              "padding": "0px",
              "_meta": { "htmlID": "u_column_2", "htmlClassNames": "u_column" }
            }
          }],
          "values": {
            "backgroundColor": "transparent",
            "padding": "0px",
            "_meta": { "htmlID": "u_row_2", "htmlClassNames": "u_row" }
          }
        }
      ],
      "values": {
        "contentWidth": "600px",
        "fontFamily": { "label": "Arial", "value": "arial,helvetica,sans-serif" },
        "textColor": "#374151",
        "backgroundColor": "#f8f9fa",
        "linkStyle": {
          "body": true,
          "linkColor": "${accentColor}",
          "linkHoverColor": "${accentColor}",
          "linkUnderline": true,
          "linkHoverUnderline": true
        },
        "_meta": { "htmlID": "u_body", "htmlClassNames": "u_body" }
      }
    },
    "schemaVersion": 16
  }
}

BLOCK TYPE RULES:

**TEXT BLOCK**: Use for all text content
{
  "id": "u_content_text_N",
  "type": "text",
  "values": {
    "text": "<p style=\\"margin:0;color:#374151;font-size:16px;line-height:1.6;\\">Content with INLINE STYLES ONLY</p>",
    "textAlign": "left",
    "containerPadding": "15px 30px",
    "_meta": { "htmlID": "u_content_text_N", "htmlClassNames": "u_content_text" }
  }
}

**IMAGE BLOCK**: Use for logos and images
{
  "id": "u_content_image_N",
  "type": "image",
  "values": {
    "src": { "url": "https://...", "width": 140, "height": 50 },
    "altText": "Description",
    "textAlign": "center",
    "containerPadding": "20px 10px",
    "_meta": { "htmlID": "u_content_image_N", "htmlClassNames": "u_content_image" }
  }
}

**BUTTON BLOCK**: Use for CTAs
{
  "id": "u_content_button_N",
  "type": "button",
  "values": {
    "text": "<strong><span style=\\"font-size:16px;\\">Button Text</span></strong>",
    "href": { "name": "web", "values": { "href": "{{url}}", "target": "_blank" } },
    "buttonColors": {
      "color": "#ffffff",
      "backgroundColor": "${accentColor}",
      "hoverColor": "#ffffff",
      "hoverBackgroundColor": "${accentColor}"
    },
    "size": { "autoWidth": true },
    "textAlign": "center",
    "padding": "14px 40px",
    "borderRadius": "8px",
    "containerPadding": "20px 30px",
    "_meta": { "htmlID": "u_content_button_N", "htmlClassNames": "u_content_button" }
  }
}

**DIVIDER BLOCK**: Use for visual separation
{
  "id": "u_content_divider_N",
  "type": "divider",
  "values": {
    "width": "100%",
    "border": {
      "borderTopWidth": "1px",
      "borderTopStyle": "solid",
      "borderTopColor": "#e5e7eb"
    },
    "containerPadding": "10px",
    "_meta": { "htmlID": "u_content_divider_N", "htmlClassNames": "u_content_divider" }
  }
}

STYLING RULES:
- Use ONLY inline styles in the "text" HTML: style="margin:0;color:#374151;font-size:16px;"
- NO custom CSS classes (no class="hero-section" or class="cta-button")
- Colors must be hex codes: ${primaryColor}, ${accentColor}, #ffffff, #374151
- Padding format: "40px 30px 20px 30px" (top right bottom left)
- Increment IDs properly: u_row_1, u_row_2, u_content_text_1, u_content_text_2, etc.
- Keep counters accurate based on how many of each element type you create
- Add the social media icons and social media also if data exist

TEMPLATE STRUCTURE:
1. Header row (logo + title) with brand colors
2. Content row (greeting + body + CTA) with white background
3. Optional: Trust/social proof row with light gray background
4. DO NOT add footer or unsubscribe - that's added separately

Now generate a professional email template for: ${prompt}

Return ONLY the JSON object - no markdown, no explanations.`;

  const response = await axios.post(
    "https://api.anthropic.com/v1/messages",
    {
      model: "claude-sonnet-4-5-20250929", // Use Sonnet for better structure following
      max_tokens: 8000,
      temperature: 0.3, // Lower temperature for more consistent output
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Generate a professional, humanized Unlayer-compatible email template for: ${prompt}

Remember:
- Copy must sound like a real person wrote it (warm, direct, benefit-focused)
- STRICTLY NO AI TICS: Do NOT use em dashes (—), introductory phrases, or meta-commentary.
- Open with "Hi {{firstName}}," personalization
- Use ONLY native Unlayer blocks (text, image, button, divider)
- Use ONLY inline styles in text content
- NO custom CSS classes
- Increment IDs properly (u_row_1, u_row_2, u_content_text_1, etc.)
- Keep counters accurate
- Escape all quotes and newlines (\\n) in text fields. DO NOT use raw newlines in strings.
- Return ONLY valid, MINIFIED JSON (no unnecessary whitespace).`,
        },
      ],
    },
    {
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      timeout: 120000,
    },
  );

  const blocks = response?.data?.content;
  if (!Array.isArray(blocks)) throw new Error("Invalid Claude response");

  let text = blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  // Clean up any markdown
  text = text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  // Try to extract JSON if wrapped in extra text
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    text = jsonMatch[0];
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    console.error("JSON Parse Error:", error);
    console.error("Raw response:", text);
    throw new Error(`Failed to parse AI response: ${error.message}`);
  }

  if (!parsed.name || !parsed.subject || !parsed.html || !parsed.design) {
    throw new Error("Incomplete template data from AI");
  }

  // Validate design structure
  if (!parsed.design.body?.rows || !Array.isArray(parsed.design.body.rows)) {
    throw new Error("Invalid design structure - missing body.rows array");
  }

  // Add counters if missing
  if (!parsed.design.counters) {
    parsed.design.counters = {
      u_column: parsed.design.body.rows.length + 1,
      u_row: parsed.design.body.rows.length + 1,
      u_content_text: 1,
      u_content_image: 1,
      u_content_button: 1,
      u_content_divider: 1,
    };
  }

  // Ensure schemaVersion
  if (!parsed.design.schemaVersion) {
    parsed.design.schemaVersion = 16;
  }

  // Final normalization (add footer, ensure compliance row, etc.)
  const finalDesign = await normalizeUnlayerDesign(
    parsed.design,
    parsed.html,
    brandName,
    userId,
    saveAs,
  );

  return {
    name: parsed.name.slice(0, 60),
    subject: parsed.subject,
    html: parsed.html,
    design: finalDesign,
    description: parsed.description || "",
  };
}

/**
 * Returns a UI-locked, non-editable footer row for brand compliance.
 */
// function buildLockedFooterRow(companyName) {
//   return {
//     id: "borade-ai-locked-footer",
//     cells: [1],
//     columns: [
//       {
//         id: "footer-col",
//         contents: [
//           {
//             id: "footer-text",
//             type: "text",
//             values: {
//               textAlign: "center",
//               containerPadding: "30px 20px",
//               text: `
//                 <p style="margin: 0 0 10px; font-size: 12px; color: #666;">
//                   This email was sent by <strong>${companyName}</strong>.
//                 </p>
//                 <p style="margin: 0; font-size: 12px; color: #999;">
//                   This message was delivered using the <strong>BoradeAI</strong> Marketing Automation Platform on behalf of <strong>${companyName}</strong>.
//                 </p>
//                 <p style="margin:0;font-size:12px;line-height:1.6;text-decoration:underline;">
//                   Unsubscribe
//               </p>
//               `,
//               selectable: false,
//               draggable: false,
//               duplicatable: false,
//               deletable: false,
//               hideable: false,
//               _meta: { htmlID: "u_content_footer_compliance", htmlClassNames: "u_content_text locked-footer" },
//             },
//           },
//         ],
//         values: {
//           backgroundColor: "#f9f9f9",
//           padding: "0px",
//           selectable: false,
//           draggable: false,
//           duplicatable: false,
//           deletable: false,
//         },
//       },
//     ],
//     values: {
//       backgroundColor: "#f9f9f9",
//       selectable: false,
//       draggable: false,
//       duplicatable: false,
//       deletable: false,
//       _meta: { htmlID: "u_row_footer", htmlClassNames: "u_row" },
//     },
//   };
// }

export async function getBusinessProfileByUserId(userId) {
  if (!userId) {
    throw new Error("userId is required");
  }

  const profile = await BusinessSummaryProfile.findOne({
    userId,
    status: "COMPLETED",
    isActive: true,
  }).lean();

  if (!profile) {
    return null;
  }

  return profile;
}

function mapBusinessProfileToFooter(profile) {
  const analysis = profile?.analysis || {};

  return {
    brandName: analysis?.business_overview?.brand_name || "Your Company",

    legalName:
      analysis?.business_overview?.legal_name ||
      analysis?.business_overview?.brand_name,

    websiteUrl: analysis?.contact_info?.website || profile?.websiteUrl || "",

    socials: {
      linkedin: analysis?.social_links?.linkedin,
      instagram: analysis?.social_links?.instagram,
      youtube: analysis?.social_links?.youtube,
      facebook: analysis?.social_links?.facebook,
      twitter: analysis?.social_links?.twitter,
    },

    brandColors: {
      darkBg: analysis?.branding_guidelines?.primary_color || "#111827",

      lightBg: "#f9fafb",

      textLight: "#ffffff",

      primaryGray: "#9ca3af",

      warmAmber: analysis?.branding_guidelines?.accent_color || "#f59e0b",
    },

    analysis,
  };
}

function buildLockedFooterRow({
  brandName,
  brandColors,
  websiteUrl,
  socials = {},
  legalName,
  analysis = {},
}) {
  const year = new Date().getFullYear();

  return [
    // ═══════════════════════════════════════════════════════════
    // FOOTER SECTION - BRANDING (EDITABLE)
    // ═══════════════════════════════════════════════════════════
    {
      id: "footer-brand-row",
      cells: [1],
      columns: [
        {
          id: "footer-brand-col",
          contents: [
            {
              id: "footer-brand",
              type: "text",
              values: {
                textAlign: "center",
                containerPadding: "30px 20px 10px 20px",
                text: `
                  <p style="margin:0;color:${brandColors.textLight};font-size:16px;font-weight:600;">
                    ${brandName}
                  </p>
                `,
              },
            },

            {
              id: "footer-description",
              type: "text",
              values: {
                textAlign: "center",
                containerPadding: "10px 30px 20px 30px",
                text: `
                  <p style="margin:0;color:${brandColors.primaryGray};font-size:13px;line-height:1.6;">
                    AI-powered business intelligence and marketing automation for modern teams
                  </p>
                `,
              },
            },

            {
              id: "footer-links",
              type: "text",
              values: {
                textAlign: "center",
                containerPadding: "10px 20px 20px 20px",
                text: `
                  <p style="margin:0;font-size:13px;line-height:2;">
                    <a href="${websiteUrl}" style="color:${brandColors.warmAmber};text-decoration:none;">
                      Visit Website
                    </a>
                    <span style="color:${brandColors.primaryGray};"> | </span>
                    <a href="{{privacyUrl}}" style="color:${brandColors.warmAmber};text-decoration:none;">
                      Privacy Policy
                    </a>
                    <span style="color:${brandColors.primaryGray};"> | </span>
                    <a href="{{termsUrl}}" style="color:${brandColors.warmAmber};text-decoration:none;">
                      Terms of Service
                    </a>
                  </p>
                `,
              },
            },

            {
              id: "footer-socials",
              type: "text",
              values: {
                textAlign: "center",
                containerPadding: "0px 20px 20px 20px",
                text: `
                  <p style="margin:0;">
                    ${socials?.linkedin ? `<a href="${socials.linkedin}" target="_blank"><img src="https://cdn-icons-png.flaticon.com/512/174/174857.png" width="20" /></a>` : ""}
                    ${socials?.instagram ? `<a href="${socials.instagram}" target="_blank"><img src="https://cdn-icons-png.flaticon.com/512/2111/2111463.png" width="20" /></a>` : ""}
                    ${socials?.youtube ? `<a href="${socials.youtube}" target="_blank"><img src="https://cdn-icons-png.flaticon.com/512/1384/1384060.png" width="20" /></a>` : ""}
                    ${socials?.facebook ? `<a href="${socials.facebook}" target="_blank"><img src="https://cdn-icons-png.flaticon.com/512/733/733547.png" width="20" /></a>` : ""}
                    ${socials?.twitter ? `<a href="${socials.twitter}" target="_blank"><img src="https://cdn-icons-png.flaticon.com/512/733/733579.png" width="20" /></a>` : ""}
                  </p>
                `,
              },
            },

            {
              id: "footer-legal",
              type: "text",
              values: {
                textAlign: "center",
                containerPadding: "10px 30px 20px 30px",
                text: `
                  <p style="margin:0 0 8px;font-size:12px;color:${brandColors.primaryGray};">
                    You're receiving this email because you interacted with ${brandName}.
                  </p>
                  <p style="margin:0;font-size:12px;color:${brandColors.primaryGray};">
                    © ${year} ${legalName || brandName}. All rights reserved.
                  </p>
                `,
              },
            },
          ],
          values: {
            backgroundColor: brandColors.darkBg,
            padding: "0px",
          },
        },
      ],
    },
  ];
}

/**
 * Fallback: wrap raw HTML in an editable text block + locked footer.
 */
function buildSafeFallbackDesign(html, companyName, footerData) {
  const defaultFooter = footerData || {
    brandName: companyName || "Demo Company",
    brandColors: {
      textLight: "#fff",
      primaryGray: "#9ca3af",
      darkBg: "#111827",
      warmAmber: "#f59e0b",
    },
    websiteUrl: "",
    legalName: companyName,
    socials: {},
  };
  const footerRows = buildLockedFooterRow(defaultFooter);

  return {
    schemaVersion: 16,
    body: {
      id: "body",
      rows: [
        {
          id: "content-row-fallback",
          cells: [1],
          columns: [
            {
              contents: [
                {
                  type: "text",
                  values: {
                    containerPadding: "20px",
                    text: html,
                  },
                },
              ],
            },
          ],
        },
        // ...footerRows
      ],
      values: {
        contentWidth: "600px",
        fontFamily: { label: "Arial", value: "arial,helvetica,sans-serif" },
      },
    },
  };
}

/**
 * Sanitizes and normalizes the AI design JSON.
 * Ensures the BoradeAI footer is present and structural integrity is maintained.
 */
async function normalizeUnlayerDesign(
  design,
  html,
  companyName,
  userId,
  saveAs,
) {
  let footerData;
  if (saveAs === "ai_template") {
    footerData = {
      brandName: "Demo Company",
      brandColors: {
        textLight: "#fff",
        primaryGray: "#9ca3af",
        darkBg: "#111827",
        warmAmber: "#f59e0b",
      },
      websiteUrl: "https://example.com",
      legalName: "Demo Company Inc.",
      socials: {},
    };
  } else {
    const userProfile = await getBusinessProfileByUserId(userId);
    footerData = mapBusinessProfileToFooter(userProfile);
  }

  // 1. If design is missing or broken, use the safe fallback
  if (!design || !design.body || !Array.isArray(design.body.rows)) {
    return buildSafeFallbackDesign(html, companyName, footerData);
  }

  // 2. Remove any existing footers to avoid duplication
  design.body.rows = design.body.rows.filter(
    (r) => r.id !== "borade-ai-locked-footer",
  );

  // 3. Inject the locked footer
  const footerRows = buildLockedFooterRow(footerData);

  // design.body.rows.push(...footerRows);

  // 4. Ensure schema version
  if (!design.schemaVersion) design.schemaVersion = 16;

  return design;
}
