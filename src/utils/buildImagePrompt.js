export function buildImagePrompt(image, businessContext) {
  return `
Cinematic B2B commercial photograph, social media advertising quality,
scroll-stopping visual hierarchy.

SUBJECT: ${image?.visual_description}
Photorealistic. Professional context. Zero stock-photo aesthetics.

LAYOUT STYLE:
${image?.image_type || "AUTO"}

The layout should naturally adapt based on this style.
Do NOT follow rigid templates — interpret creatively.

General expectations:
- Strong visual hierarchy (headline → supporting → CTA)
- Intelligent subject placement
- Natural negative space for text
- Clean, uncluttered composition
- No overlap between text and key subject

LOGO (STRICT REQUIREMENT):

* If a primary brand logo is provided, place it ONLY in the TOP-RIGHT corner.
* Maintain consistent padding from the top and right edges (approximately 3–5% of the image dimensions).
* Preserve the logo's original proportions, colors, and transparency.
* Do NOT crop, stretch, distort, rotate, redesign, or recreate the logo.
* Keep the logo small but clearly visible (roughly 5–8% of the image width).
* Ensure sufficient contrast for visibility while keeping the logo subtle and premium.
* Never place the logo anywhere other than the top-right corner.

CAMERA: 85mm, eye-level, shallow background blur f/2.8.

LIGHTING: ${businessContext?.lighting_tone || "Auto"},
professional cinematic lighting with subject separation.

TYPOGRAPHY — flat surface, typeset precision, zero distortion:

"${image?.headline_text}" — Bold, high contrast

"${image?.supporting_text}" — Medium weight

"${image?.cta_text}" — solid ${businessContext?.accent_color} CTA badge

Text must:

* Be placed in clean, readable areas
* Be fully legible on mobile
* Never interfere with the subject
* Stay outside the reserved overlay safe area
* Position text dynamically based on available negative space and subject placement
* Avoid repetitive or template-like positioning patterns

NO DISTORTED LETTERS.
NO BUSY BACKGROUNDS.
NO WATERMARKS.
NO GENERIC STOCK LOOK.

Ultra-realistic.
HD.
LinkedIn / Instagram / Meta ad ready.
`;
}