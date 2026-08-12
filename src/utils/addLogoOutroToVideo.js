// import sharp from "sharp";
// import ffmpeg from "fluent-ffmpeg";
// import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
// import ffprobeInstaller from "@ffprobe-installer/ffprobe";
// import fs from "fs/promises";
// import path from "path";
// import os from "os";
// import { v4 as uuidv4 } from "uuid";
// import BusinessSummaryProfile from "../models/BusinessSummaryProfile.js";

// ffmpeg.setFfmpegPath(ffmpegInstaller.path);
// ffmpeg.setFfprobePath(ffprobeStatic.path);

// const escapeFFmpegText = (text) => {
//     if (!text) return "";
//     return text
//         .replace(/\\/g, "\\\\")
//         .replace(/'/g, "\u2019")
//         .replace(/:/g, "\\:")
//         .replace(/,/g, "\\,");
// };

// // Fetch with timeout (prevents crash)
// async function fetchWithTimeout(url, timeout = 20000) {
//     const controller = new AbortController();
//     const id = setTimeout(() => controller.abort(), timeout);

//     try {
//         const response = await fetch(url, { signal: controller.signal });
//         if (!response.ok) throw new Error(`HTTP ${response.status}`);
//         return Buffer.from(await response.arrayBuffer());
//     } finally {
//         clearTimeout(id);
//     }
// }

// // Wrap long text (for address)
// function wrapText(text, maxChars = 40) {
//     if (!text) return [];
//     const words = text.split(" ");
//     const lines = [];
//     let line = "";

//     for (const word of words) {
//         if ((line + word).length > maxChars) {
//             lines.push(line.trim());
//             line = word + " ";
//         } else {
//             line += word + " ";
//         }
//     }

//     if (line.trim()) lines.push(line.trim());
//     return lines;
// }

// // export async function addLogoOutroToVideo(videoBuffer, logoUrl, textLines = [], userId) {
// //     const profile = await BusinessSummaryProfile.findOne({ userId });
// //     const branding = profile?.analysis?.branding_guidelines ?? {};

// //     const brandColors = ["#ffffff", "#f0f0f0"];
// //     // const brandColors = branding?.brand_colors?.length >= 1
// //     //     ? branding?.brand_colors
// //     //     : ["#ffffff", "#f0f0f0"];
// //     const textColor = branding?.text_color || "#222222";

// //     return new Promise(async (resolve, reject) => {
// //         const tempDir = os.tmpdir();
// //         const videoId = uuidv4();

// //         const paths = {
// //             inputVideo: path.join(tempDir, `${videoId}_input.mp4`),
// //             inputLogo: path.join(tempDir, `${videoId}_logo.png`),
// //             bg: path.join(tempDir, `${videoId}_bg.png`),
// //             output: path.join(tempDir, `${videoId}_output.mp4`),
// //         };

// //         try {
// //             await fs.writeFile(paths.inputVideo, videoBuffer);

// //             // Gradient Background
// //             const gradientSvg = `
// //                 <svg width="1080" height="1920" xmlns="http://www.w3.org/2000/svg">
// //                     <defs>
// //                         <linearGradient id="g" x1="0%" y1="0%" x2="0%" y2="100%">
// //                             <stop offset="0%" style="stop-color:${brandColors[0]};stop-opacity:1" />
// //                             <stop offset="100%" style="stop-color:${brandColors[0] || brandColors[1]};stop-opacity:1" />
// //                         </linearGradient>
// //                     </defs>
// //                     <rect width="100%" height="100%" fill="url(#g)" />
// //                 </svg>`;
// //             await sharp(Buffer.from(gradientSvg)).png().toFile(paths.bg);

// //             // Load Logo (with timeout + fallback)
// //             let logoBuffer;
// //             try {
// //                 if (Buffer.isBuffer(logoUrl)) {
// //                     logoBuffer = logoUrl;
// //                 } else if (typeof logoUrl === "string" && logoUrl.startsWith("data:")) {
// //                     const [header, data] = logoUrl.split(",");
// //                     logoBuffer = Buffer.from(data, header.includes("base64") ? "base64" : "utf8");
// //                 } else if (typeof logoUrl === "string") {
// //                     logoBuffer = await fetchWithTimeout(logoUrl, 20000);
// //                 }
// //             } catch (err) {
// //                 console.log("Logo fetch failed, using blank logo");
// //                 logoBuffer = await sharp({
// //                     create: {
// //                         width: 400,
// //                         height: 400,
// //                         channels: 4,
// //                         background: { r: 0, g: 0, b: 0, alpha: 0 }
// //                     }
// //                 }).png().toBuffer();
// //             }

// //             const processedLogoBuffer = await sharp(logoBuffer)
// //                 .resize({ width: 450, height: 450, fit: "inside" })
// //                 .png()
// //                 .toBuffer();
// //             await fs.writeFile(paths.inputLogo, processedLogoBuffer);

// //             ffmpeg.ffprobe(paths.inputVideo, (err, metadata) => {
// //                 if (err) return reject(err);

// //                 const originalDuration = metadata.format?.duration || 8;
// //                 const outroDuration = 2;
// //                 const targetDuration = originalDuration + outroDuration;
// //                 const width = metadata.streams[0].width || 1080;
// //                 const height = metadata.streams[0].height || 1920;
// //                 const hasAudio = metadata.streams.some(s => s.codec_type === 'audio');

// //                 let complexFilter = [];

// //                 complexFilter.push(`[0:v]tpad=stop_mode=clone:stop_duration=${outroDuration}[padded_v]`);
// //                 complexFilter.push(`[1:v]scale=${width}:${height}[bg_scaled]`);
// //                 complexFilter.push(`[padded_v][bg_scaled]overlay=enable='between(t,${originalDuration},${targetDuration})'[branded_bg]`);
// //                 complexFilter.push(`[2:v]scale=iw*0.7:-1[logo_scaled]`);
// //                 complexFilter.push(`[branded_bg][logo_scaled]overlay=(W-w)/2:(H*0.23)-(h/2):enable='between(t,${originalDuration},${targetDuration})'[with_logo]`);

// //                 let currentStream = "with_logo";

// //                 // Wrap address lines
// //                 let wrappedLines = [];
// //                 textLines.forEach((line, index) => {
// //                     if (index >= 3) {
// //                         wrappedLines.push(...wrapText(line));
// //                     } else {
// //                         wrappedLines.push(line);
// //                     }
// //                 });

// //                 let baseY = "H*0.45";

// //                 wrappedLines.forEach((line, index) => {
// //                     const safeLine = escapeFFmpegText(line);

// //                     let fontSize;
// //                     let fontFile;
// //                     let yOffset;

// //                     if (index === 0) {
// //                         fontSize = 46;
// //                         fontFile = "./fonts/Sora-Bold.ttf";
// //                         yOffset = -40;
// //                     } else if (index === 1) {
// //                         fontSize = 46;
// //                         fontFile = "./fonts/Sora-SemiBold.ttf";
// //                         yOffset = 60;
// //                     } else if (index === 2) {
// //                         fontSize = 46;
// //                         fontFile = "./fonts/Sora-SemiBold.ttf";
// //                         yOffset = 155;
// //                     } else {
// //                         fontSize = 36;
// //                         fontFile = "./fonts/Sora-Regular.ttf";
// //                         yOffset = 230 + ((index - 3) * 45);
// //                     }

// //                     const textFilterName = `v_text_${index}`;

// //                     complexFilter.push(
// //                         `[${currentStream}]drawtext=text='${safeLine}':fontcolor=${textColor}:fontsize=${fontSize}:` +
// //                         `fontfile=${fontFile}:` +
// //                         `shadowcolor=black@0.25:shadowx=2:shadowy=2:` +
// //                         `x=(w-text_w)/2:y=${baseY}+${yOffset}:` +
// //                         `fix_bounds=1:enable='between(t,${originalDuration},${targetDuration})'[${textFilterName}]`
// //                     );

// //                     currentStream = textFilterName;
// //                 });

// //                 let outputOptions = [
// //                     "-y", "-c:v libx264", "-preset ultrafast",
// //                     "-crf 22", "-pix_fmt yuv420p", "-t", `${targetDuration}`
// //                 ];

// //                 if (hasAudio) {
// //                     outputOptions.push("-map", `[${currentStream}]`, "-map", "0:a", "-c:a", "aac");
// //                 } else {
// //                     outputOptions.push("-map", `[${currentStream}]`);
// //                 }

// //                 ffmpeg()
// //                     .input(paths.inputVideo)
// //                     .input(paths.bg)
// //                     .input(paths.inputLogo)
// //                     .complexFilter(complexFilter)
// //                     .outputOptions(outputOptions)
// //                     .on("end", async () => {
// //                         const finalBuffer = await fs.readFile(paths.output);
// //                         await Promise.all(Object.values(paths).map(p => fs.unlink(p).catch(() => { })));
// //                         resolve(finalBuffer);
// //                     })
// //                     .on("error", async (err) => {
// //                         console.error("FFmpeg error:", err);
// //                         await Promise.all(Object.values(paths).map(p => fs.unlink(p).catch(() => { })));
// //                         reject(err);
// //                     })
// //                     .save(paths.output);
// //             });
// //         } catch (error) {
// //             reject(error);
// //         }
// //     });
// // }

// // Move helper outside for reusability and cleaner scope

// const extractHex = (colorStr) => {
//     if (!colorStr || typeof colorStr !== 'string') return null;
//     const match = colorStr.match(/#[0-9A-Fa-f]{6}/);
//     return match ? match[0] : null;
// };

// // Generate banner image from SVG
// async function generateBannerImage(companyName, domainName, bgColor, accentColor, width = 1080, height = 100) {
//     const svg = `
//         <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
//             <defs>
//                 <style>
//                     @font-face {
//                         font-family: 'Bebas';
//                         src: url('./fonts/BebasNeue-Regular.ttf');
//                     }
//                     @font-face {
//                         font-family: 'DM Sans';
//                         src: url('./fonts/DMSans-Regular.ttf');
//                     }
//                 </style>
//             </defs>

//             <!-- Background -->
//             <rect width="${width}" height="${height}" fill="${bgColor}" opacity="0.95"/>

//             <!-- Accent line at bottom -->
//             <rect y="${height - 3}" width="${width}" height="3" fill="${accentColor}"/>

//             <!-- Company name (left side) -->
//             <text 
//                 x="40" 
//                 y="${height / 2}" 
//                 font-family="Bebas, Arial, sans-serif" 
//                 font-size="36" 
//                 font-weight="bold"
//                 fill="white" 
//                 dominant-baseline="middle"
//                 letter-spacing="1">
//                 ${companyName}
//             </text>

//             <!-- Domain (right side) -->
//             <text 
//                 x="${width - 40}" 
//                 y="${height / 2}" 
//                 font-family="DM Sans, Arial, sans-serif" 
//                 font-size="28" 
//                 font-weight="500"
//                 fill="${accentColor}" 
//                 text-anchor="end"
//                 dominant-baseline="middle">
//                 ${domainName}
//             </text>
//         </svg>
//     `;

//     return await sharp(Buffer.from(svg)).png().toBuffer();
// }

// // Generate outro screen from SVG
// async function generateOutroImage(companyName, domainName, textLines, primaryColor, secondaryColor, outroTextColor, width = 1080, height = 1920) {
//     const centerX = width / 2;
//     const centerY = height / 2;

//     // Calculate text positions
//     let textLinesY = centerY + 100;
//     const textLineElements = textLines && textLines.length > 0
//         ? textLines.map((line, index) => {
//             const y = textLinesY + (index * 50);
//             return `<text 
//                 x="${centerX}" 
//                 y="${y}" 
//                 font-family="DM Sans, Arial, sans-serif" 
//                 font-size="36" 
//                 fill="${outroTextColor}" 
//                 text-anchor="middle"
//                 opacity="0.95">
//                 ${line}
//             </text>`;
//         }).join('\n')
//         : '';

//     const svg = `
//         <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
//             <defs>
//                 <linearGradient id="gradient" x1="0%" y1="0%" x2="0%" y2="100%">
//                     <stop offset="0%" style="stop-color:${primaryColor};stop-opacity:1" />
//                     <stop offset="100%" style="stop-color:${secondaryColor};stop-opacity:1" />
//                 </linearGradient>
//                 <style>
//                     @font-face {
//                         font-family: 'Bebas';
//                         src: url('./fonts/BebasNeue-Regular.ttf');
//                     }
//                     @font-face {
//                         font-family: 'DM Sans';
//                         src: url('./fonts/DMSans-Medium.ttf');
//                     }
//                 </style>
//             </defs>

//             <!-- Gradient background -->
//             <rect width="${width}" height="${height}" fill="url(#gradient)"/>

//             <!-- Company name -->
//             <text 
//                 x="${centerX}" 
//                 y="${centerY - 60}" 
//                 font-family="Bebas, Arial, sans-serif" 
//                 font-size="64" 
//                 font-weight="bold"
//                 fill="${outroTextColor}" 
//                 text-anchor="middle"
//                 letter-spacing="2">
//                 ${companyName}
//             </text>

//             <!-- Domain -->
//             <text 
//                 x="${centerX}" 
//                 y="${centerY + 10}" 
//                 font-family="DM Sans, Arial, sans-serif" 
//                 font-size="42" 
//                 font-weight="500"
//                 fill="${outroTextColor}" 
//                 text-anchor="middle">
//                 ${domainName}
//             </text>

//             <!-- Additional text lines -->
//             ${textLineElements}
//         </svg>
//     `;

//     return await sharp(Buffer.from(svg)).png().toBuffer();
// }

// export async function addLogoOutroToVideo(videoBuffer, logoUrl, textLines = [], userId) {
//     const profile = await BusinessSummaryProfile.findOne({ userId });
//     const analysis = profile?.analysis || {};
//     const branding = analysis.branding_guidelines || {};

//     const rawColors = branding.brand_colors || [];

//     const primaryColor = extractHex(rawColors[0]) || "#13132A";
//     const secondaryColor = extractHex(rawColors[1]) || "#2C3E91";
//     const accentColor = extractHex(rawColors[2]) || "#B52775";
//     const bgColor = extractHex(rawColors[3]) || "#0C0C18";

//     const isDarkBg = (hex) => {
//         if (!hex) return true;
//         const cleanHex = hex.replace('#', '');
//         const rgb = parseInt(cleanHex, 16);
//         const r = (rgb >> 16) & 0xff;
//         const g = (rgb >> 8) & 0xff;
//         const b = (rgb >> 0) & 0xff;
//         return (0.2126 * r + 0.7152 * g + 0.0722 * b) < 128;
//     };

//     const outroTextColor = isDarkBg(primaryColor) ? "#FFFFFF" : primaryColor;

//     const companyName = analysis.business_overview?.brand_name || "Mind Your Mind's Business";
//     const domainName = profile?.websiteUrl?.replace(/^https?:\/\/(www\.)?/, '') || "mindyourmindsbusiness.com";

//     return new Promise(async (resolve, reject) => {
//         const tempDir = os.tmpdir();
//         const videoId = uuidv4();
//         const paths = {
//             inputVideo: path.join(tempDir, `${videoId}_input.mp4`),
//             banner: path.join(tempDir, `${videoId}_banner.png`),
//             outro: path.join(tempDir, `${videoId}_outro.png`),
//             output: path.join(tempDir, `${videoId}_output.mp4`),
//         };

//         const cleanUp = async () => {
//             await Promise.all(Object.values(paths).map(p => fs.unlink(p).catch(() => { })));
//         };

//         try {
//             await fs.writeFile(paths.inputVideo, videoBuffer);

//             ffmpeg.ffprobe(paths.inputVideo, async (err, metadata) => {
//                 if (err) return reject(err);

//                 const vStream = metadata.streams.find(s => s.codec_type === 'video');
//                 const originalDuration = parseFloat(metadata.format?.duration) || 8;
//                 const outroDuration = 2;
//                 const targetDuration = originalDuration + outroDuration;
//                 const width = vStream.width || 1080;
//                 const height = vStream.height || 1920;
//                 const hasAudio = metadata.streams.some(s => s.codec_type === 'audio');

//                 // Generate banner and outro images from SVG
//                 const bannerBuffer = await generateBannerImage(companyName, domainName, bgColor, accentColor, width, 100);
//                 const outroBuffer = await generateOutroImage(companyName, domainName, textLines, primaryColor, secondaryColor, outroTextColor, width, height);

//                 await fs.writeFile(paths.banner, bannerBuffer);
//                 await fs.writeFile(paths.outro, outroBuffer);

//                 let complexFilter = [
//                     // Pad the video for outro
//                     `[0:v]tpad=stop_mode=clone:stop_duration=${outroDuration}[padded]`,

//                     // Overlay banner on original video portion
//                     `[padded][1:v]overlay=x=0:y=0:enable='between(t,0,${originalDuration})'[with_banner]`,

//                     // Overlay outro screen
//                     `[with_banner][2:v]overlay=x=0:y=0:enable='between(t,${originalDuration},${targetDuration})'[final]`
//                 ];

//                 let outputOptions = [
//                     "-y",
//                     "-c:v", "libx264",
//                     "-preset", "ultrafast",
//                     "-crf", "22",
//                     "-pix_fmt", "yuv420p",
//                     "-t", `${targetDuration}`
//                 ];

//                 if (hasAudio) {
//                     outputOptions.push("-map", "[final]", "-map", "0:a", "-c:a", "aac", "-b:a", "192k");
//                 } else {
//                     outputOptions.push("-map", "[final]");
//                 }

//                 ffmpeg()
//                     .input(paths.inputVideo)
//                     .input(paths.banner)
//                     .input(paths.outro)
//                     .complexFilter(complexFilter)
//                     .outputOptions(outputOptions)
//                     .on("end", async () => {
//                         const finalBuffer = await fs.readFile(paths.output);
//                         await cleanUp();
//                         resolve(finalBuffer);
//                     })
//                     .on("error", async (err) => {
//                         console.error("FFmpeg error:", err);
//                         await cleanUp();
//                         reject(err);
//                     })
//                     .save(paths.output);
//             });
//         } catch (error) {
//             await cleanUp();
//             reject(error);
//         }
//     });
// }


import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';

import BusinessSummaryProfile from '../models/BusinessSummaryProfile.js';
import axios from 'axios';
import { urlToBuffer } from '../services/aiService.js';

ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(ffprobeStatic.path);

// ==================== COLOR UTILITIES ====================

const parseColor = (colorStr) => {
    if (!colorStr || typeof colorStr !== 'string') return null;
    const str = colorStr.trim();

    const hexMatch = str.match(/#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b/);
    if (hexMatch) {
        const hex = hexMatch[1];
        if (hex.length === 3) {
            return `#${hex.split('').map(c => c + c).join('').toUpperCase()}`;
        }
        return `#${hex.toUpperCase()}`;
    }

    const noHashMatch = str.match(/\b([0-9A-Fa-f]{6})\b/);
    if (noHashMatch) return `#${noHashMatch[1].toUpperCase()}`;

    const rgbMatch = str.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
    if (rgbMatch) {
        const [, r, g, b] = rgbMatch;
        const hex = [r, g, b].map(v => parseInt(v).toString(16).padStart(2, '0')).join('');
        return `#${hex.toUpperCase()}`;
    }
    return null;
};

const isValidHex = (hex) => /^#[0-9A-F]{6}$/i.test(hex);

const hexToRgb = (hex) => {
    if (!hex || !isValidHex(hex)) return { r: 0, g: 0, b: 0 };
    const num = parseInt(hex.replace('#', ''), 16);
    return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff };
};

const getRelativeLuminance = (hex) => {
    const { r, g, b } = hexToRgb(hex);
    const [rL, gL, bL] = [r, g, b].map(v => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rL + 0.7152 * gL + 0.0722 * bL;
};

const getContrastRatio = (hex1, hex2) => {
    const l1 = getRelativeLuminance(hex1);
    const l2 = getRelativeLuminance(hex2);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

const getOptimalTextColor = (bgHex) => {
    return getContrastRatio(bgHex, '#FFFFFF') > getContrastRatio(bgHex, '#000000')
        ? '#FFFFFF' : '#000000';
};

const ensureContrast = (fg, bg, minRatio = 4.5) => {
    return getContrastRatio(fg, bg) >= minRatio ? fg : getOptimalTextColor(bg);
};

const adjustColorBrightness = (hex, percent) => {
    const { r, g, b } = hexToRgb(hex);
    const adjust = (v) => Math.max(0, Math.min(255, Math.round(v + (255 - v) * (percent / 100))));
    const newHex = [adjust(r), adjust(g), adjust(b)]
        .map(v => v.toString(16).padStart(2, '0')).join('');
    return `#${newHex.toUpperCase()}`;
};

const createColorPalette = (rawColors) => {
    const rawColorsArray = Array.isArray(rawColors) ? rawColors : typeof rawColors === 'string' ? rawColors.split(',') : [];
    const parsed = rawColorsArray.map(parseColor).filter(c => c && isValidHex(c));
    const fallback = {
        primary: '#1A1A2E', secondary: '#16213E', accent: '#0F3460',
        background: '#0A0E27', light: '#E94560'
    };
    const primary = parsed[0] || fallback.primary;
    const secondary = parsed[1] || fallback.secondary;
    const accent = parsed[2] || fallback.accent;
    const background = parsed[3] || fallback.background;
    const light = parsed[4] || fallback.light;

    return {
        primary, secondary, accent, background, light,
        primaryText: getOptimalTextColor(primary),
        secondaryText: getOptimalTextColor(secondary),
        accentText: getOptimalTextColor(accent),
        backgroundText: getOptimalTextColor(background),
        primaryLight: adjustColorBrightness(primary, 20),
        primaryDark: adjustColorBrightness(primary, -20),
        accentLight: adjustColorBrightness(accent, 30)
    };
};

// ==================== VIDEO METRICS ====================

const getVideoMetrics = (width, height) => {
    const aspectRatio = width / height;
    let orientation, aspectName;
    if (aspectRatio >= 1.7) { orientation = 'landscape'; aspectName = '16:9'; }
    else if (aspectRatio >= 1.2) { orientation = 'landscape'; aspectName = '4:3'; }
    else if (aspectRatio >= 0.9 && aspectRatio <= 1.1) { orientation = 'square'; aspectName = '1:1'; }
    else if (aspectRatio >= 0.7) { orientation = 'portrait'; aspectName = '4:5'; }
    else { orientation = 'portrait'; aspectName = '9:16'; }

    const baseUnit = Math.min(width, height);
    const padding = Math.floor(width * 0.05);
    const smallPadding = Math.floor(padding * 0.5);
    const bannerHeight = Math.max(100, Math.min(180, Math.floor(height * 0.09)));

    return {
        width, height, orientation, aspectName, aspectRatio,
        baseUnit, padding, smallPadding, bannerHeight,
        fontSize: {
            bannerCompany: Math.floor(bannerHeight * 0.28),
            bannerDomain: Math.floor(bannerHeight * 0.18),
            outroCompany: Math.floor(baseUnit * 0.048),  // Increased from 0.038
            outroDomain: Math.floor(baseUnit * 0.042),   // Increased from 0.038
            outroText: Math.floor(baseUnit * 0.032),     // Increased from 0.028
            outroTextSmall: Math.floor(baseUnit * 0.028) // Increased from 0.024
        },
        spacing: {
            xs: Math.floor(baseUnit * 0.01),
            sm: Math.floor(baseUnit * 0.02),
            md: Math.floor(baseUnit * 0.035),
            lg: Math.floor(baseUnit * 0.05),
            xl: Math.floor(baseUnit * 0.07)
        },
        elements: {
            decorativeCircleRadius: Math.floor(baseUnit * 0.08),
            accentLineWidth: Math.max(2, Math.floor(baseUnit * 0.004)),
            shadowBlur: Math.max(3, Math.floor(baseUnit * 0.008))
        }
    };
};

// ==================== SVG UTILITIES ====================

const escapeXml = (str) => {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
};

const truncateText = (text, maxLength) => {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength - 1) + '…';
};

const wrapText = (text, maxCharsPerLine) => {
    if (!text || text.length <= maxCharsPerLine) return [text];
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';
    for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        if (testLine.length <= maxCharsPerLine) {
            currentLine = testLine;
        } else {
            if (currentLine) lines.push(currentLine);
            currentLine = word;
        }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
};

// Force even number (H.264 requirement)
const makeEven = (n) => (n % 2 === 0) ? n : n - 1;

// ==================== BANNER GENERATOR ====================

async function generateBannerImage(companyName, domainName, colors, metrics) {
    const { width, bannerHeight, fontSize, padding, smallPadding, elements } = metrics;

    const bgColor = colors.background;
    const bgGradientEnd = adjustColorBrightness(bgColor, -5);
    const accentColor = ensureContrast(colors.accent, bgColor, 3.0);
    const accentGlow = adjustColorBrightness(accentColor, 20);
    // const textColor = colors.backgroundText;
    const textColor = ensureContrast(colors.backgroundText, colors.primary, 4.5);

    const companyText = truncateText(companyName.toUpperCase(), 30);
    const domainText = truncateText(domainName, 40);

    const safeWidth = makeEven(width);
    const safeHeight = makeEven(bannerHeight);

    const gap = 10;
    const totalTextHeight = fontSize.bannerCompany + fontSize.bannerDomain + gap;
    const startY = (safeHeight - totalTextHeight) / 2;
    // const companyY = startY + fontSize.bannerCompany * 0.85;
    // const domainY = companyY + gap + fontSize.bannerDomain * 0.9;

    const centerY = safeHeight / 2;

    const companyY = centerY - (fontSize.bannerDomain * 0.6);
    const domainY = centerY + (fontSize.bannerCompany * 0.6);

    console.log("companyText ", companyText);

    const svg = `
<svg 
  width="${safeWidth}" 
  height="${safeHeight}" 
  viewBox="0 0 ${safeWidth} ${safeHeight}" 
  xmlns="http://www.w3.org/2000/svg"
>

  <defs>
    <!-- FIXED gradient id -->
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="${colors.primary}" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="${colors.secondary}" stop-opacity="0.4"/>
    </linearGradient>

    <!-- ADD missing shadow -->
    <filter id="textShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity="0.4"/>
    </filter>
  </defs>

  <!-- BACKGROUND -->
  <rect width="100%" height="100%" fill="url(#bgGrad)"/>

  <!-- TOP ACCENT -->
  <rect 
    y="0" 
    width="100%" 
    height="${elements.accentLineWidth * 2}" 
    fill="${accentColor}" 
    opacity="0.85"
  />

  <!-- BOTTOM ACCENT -->
  <rect 
    y="${safeHeight - (elements.accentLineWidth * 3)}" 
    width="100%" 
    height="${elements.accentLineWidth * 3}" 
    fill="${accentColor}" 
    opacity="0.9"
  />

  <!-- COMPANY NAME -->
 <text 
  x="${padding}" 
  y="${companyY}"
  font-family="DejaVu Sans, Arial, sans-serif"
  font-size="${fontSize.bannerCompany}"
  font-weight="700"
  fill="${textColor}"
  letter-spacing="1.5"
  dominant-baseline="middle"
>
  ${escapeXml(companyText)}
</text>

<text 
  x="${padding}" 
  y="${domainY}"
  font-family="DejaVu Sans, Arial, sans-serif"
  font-size="${fontSize.bannerDomain}"
  font-weight="400"
  fill="${accentColor}"
  letter-spacing="1.2"
  opacity="0.95"
  dominant-baseline="middle"
>
  ${escapeXml(domainText)}
</text>

</svg>
`;


    return await sharp(Buffer.from(svg), { density: 300 })
        .resize(safeWidth, safeHeight, { fit: 'fill', kernel: 'lanczos3' })
        .png({ compressionLevel: 6 })
        .toBuffer();
}

// ==================== OUTRO GENERATOR (UPDATED) ====================

async function fetchLogoBuffer(url) {
    const res = await axios.get(url, {
        responseType: "arraybuffer",
    });
    return Buffer.from(res.data);
}

export async function generateOutroImage(
    companyName,
    domainName,
    textLines,
    colors,
    metrics,
    logoUrl
) {
    const { width, height, fontSize, spacing, elements } = metrics;

    const safeWidth = makeEven(width);
    const safeHeight = makeEven(height);

    const centerX = safeWidth / 2;
    const circleRadius = elements.decorativeCircleRadius;

    const validTextLines = textLines?.slice(0, 4) || [];
    const lineSpacing = fontSize.outroText + spacing.sm;

    // ---------- Layout ----------
    const baseLogoSize = Math.min(width, height) * 0.35;
    const logoBoxSize = Math.max(180, Math.min(320, baseLogoSize));

    // Calculate dynamic wrapped height for all text
    const approxCharWidth = fontSize.outroText * 0.55;
    const maxCharsPerLine = Math.max(20, Math.floor((safeWidth * 0.70) / approxCharWidth));

    const approxCompanyCharWidth = fontSize.outroCompany * 0.70;
    const maxCompanyChars = Math.max(10, Math.floor((safeWidth * 0.65) / approxCompanyCharWidth));
    const companyLines = wrapText(companyName.toUpperCase(), maxCompanyChars);

    const approxDomainCharWidth = fontSize.outroDomain * 0.55;
    const maxDomainChars = Math.max(15, Math.floor((safeWidth * 0.65) / approxDomainCharWidth));
    const domainLines = wrapText(domainName, maxDomainChars);

    let totalTextHeight = 0;
    const wrappedTextBlocks = validTextLines.map(line => {
        const lines = wrapText(line, maxCharsPerLine);
        totalTextHeight += lines.length * lineSpacing;
        return lines;
    });

    const totalHeight =
        logoBoxSize +
        spacing.xl +
        (companyLines.length * fontSize.outroCompany * 1.1) +
        spacing.md +
        (domainLines.length * fontSize.outroDomain * 1.1) +
        (spacing.xl * 1.5) +
        totalTextHeight;

    const startY = (safeHeight - totalHeight) / 2;

    const logoY = startY + logoBoxSize / 2;
    const companyY = logoY + logoBoxSize / 2 + spacing.lg + fontSize.outroCompany * 0.75;
    const domainY = companyY + ((companyLines.length - 1) * fontSize.outroCompany * 1.1) + spacing.md + fontSize.outroDomain * 0.75;
    const textStartY = domainY + ((domainLines.length - 1) * fontSize.outroDomain * 1.1) + (spacing.xl * 1.5) + fontSize.outroText * 0.75;

    // ---------- Text Elements with wrapping ----------
    let currentTextY = textStartY;
    let textLineElements = '';

    wrappedTextBlocks.forEach((lines) => {
        lines.forEach((wrappedLine) => {
            textLineElements += `
        <text x="${centerX}" y="${currentTextY}"
          font-family="Arial, Helvetica, sans-serif"
          font-size="${fontSize.outroText}"
          font-weight="500"
          fill="${colors.primaryText}"
          text-anchor="middle"
          letter-spacing="1">
          ${escapeXml(wrappedLine)}
        </text>`;
            currentTextY += lineSpacing;
        });
    });

    // ---------- SVG with wrapped text ----------
    const svg = `
<svg width="${safeWidth}" height="${safeHeight}" xmlns="http://www.w3.org/2000/svg">

  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="${colors.primary}" stop-opacity="0.8" />
      <stop offset="100%" stop-color="${colors.secondary}" stop-opacity="0.8" />
    </linearGradient>
  </defs>

  <rect width="100%" height="100%" fill="url(#bg)" />

  <!-- COMPANY NAME - No truncation, wraps if needed -->
  ${companyLines.map((line, index) => `
  <text x="${centerX}" y="${companyY + (index * fontSize.outroCompany * 1.1)}"
    font-family="Arial, Helvetica, sans-serif"
    font-size="${fontSize.outroCompany}"
    font-weight="700"
    fill="${colors.primaryText}"
    text-anchor="middle"
    letter-spacing="4">
    ${escapeXml(line)}
  </text>`).join('')}

  <!-- DOMAIN - No truncation, wraps if needed -->
  ${domainLines.map((line, index) => `
  <text x="${centerX}" y="${domainY + (index * fontSize.outroDomain * 1.1)}"
    font-family="Arial, Helvetica, sans-serif"
    font-size="${fontSize.outroDomain}"
    font-weight="500"
    fill="${colors.primaryText}"
    text-anchor="middle"
    letter-spacing="2">
    ${escapeXml(line)}
  </text>`).join('')}

  ${textLineElements}

</svg>
`;
    // ---------- Base Render ----------
    const baseImage = await sharp(Buffer.from(svg))
        .resize(safeWidth, safeHeight)
        .png()
        .toBuffer();

    // ---------- Logo Overlay ----------
    if (logoUrl) {
        try {
            const logoBuffer = await urlToBuffer(logoUrl);

            // Resize logo to fit within logoBoxSize (60-120px range)
            const resizedLogo = await sharp(logoBuffer)
                .resize({
                    width: Math.round(logoBoxSize),
                    height: Math.round(logoBoxSize),
                    fit: "inside",  // Maintains aspect ratio, fits within box
                    withoutEnlargement: false,
                    background: { r: 0, g: 0, b: 0, alpha: 0 }  // Transparent background
                })
                .png()
                .toBuffer();

            const metadata = await sharp(resizedLogo).metadata();

            return await sharp(baseImage)
                .composite([
                    {
                        input: resizedLogo,
                        left: Math.round(centerX - metadata.width / 2),
                        top: Math.round(logoY - metadata.height / 2),
                    },
                ])
                .toBuffer();

        } catch (err) {
            console.error("Logo failed:", err.message);
        }
    }

    return baseImage;
}


// ==================== CLEAN OUTRO GENERATOR (NEW - for last 2 seconds) ====================

async function generateCleanOutroImage(companyName, domainName, textLines, colors, metrics) {
    const { width, height, fontSize, spacing, elements, orientation } = metrics;

    const safeWidth = makeEven(width);
    const safeHeight = makeEven(height);

    const centerX = safeWidth / 2;

    // CLEAN DESIGN: solid dark/light background, NO gradient, NO brand color mix
    // Auto-pick background: use pure black or pure white based on brand text preference
    const bgColor = '#000000';        // Pure black background
    const textColor = '#FFFFFF';      // Pure white text for max clarity
    const accentColor = '#FFFFFF';    // White accent for clarity

    const validTextLines = textLines && textLines.length > 0 ? textLines.slice(0, 4) : [];

    const lineSpacing = fontSize.outroText + spacing.sm;

    // Calculate dynamic wrapped height
    const approxCharWidth = fontSize.outroText * 0.55;
    const maxCharsPerLine = Math.max(20, Math.floor((safeWidth * 0.70) / approxCharWidth));

    let textBlockHeight = 0;
    const wrappedTextBlocks = validTextLines.map(line => {
        const lines = wrapText(line, maxCharsPerLine);
        textBlockHeight += lines.length * lineSpacing;
        return lines;
    });

    const approxCompanyCharWidth = fontSize.outroCompany * 0.70;
    const maxCompanyChars = Math.max(10, Math.floor((safeWidth * 0.65) / approxCompanyCharWidth));
    const companyLines = wrapText(companyName.toUpperCase(), maxCompanyChars);

    const approxDomainCharWidth = fontSize.outroDomain * 0.55;
    const maxDomainChars = Math.max(15, Math.floor((safeWidth * 0.65) / approxDomainCharWidth));
    const domainLines = wrapText(domainName, maxDomainChars);

    const companySpace = (companyLines.length * fontSize.outroCompany * 1.1);
    const separatorSpace = spacing.md;
    const domainSpace = (domainLines.length * fontSize.outroDomain * 1.1);
    const textSpace = textBlockHeight > 0 ? (textBlockHeight + (spacing.xl * 1.5)) : 0;

    const totalContentHeight = companySpace + separatorSpace + spacing.md + domainSpace + textSpace;
    const contentStartY = (safeHeight - totalContentHeight) / 2;

    const companyY = contentStartY + fontSize.outroCompany * 0.9;
    const separatorY = companyY + ((companyLines.length - 1) * fontSize.outroCompany * 1.1) + separatorSpace + spacing.sm;
    const domainY = separatorY + spacing.md + fontSize.outroDomain * 0.9;
    const textStartY = domainY + ((domainLines.length - 1) * fontSize.outroDomain * 1.1) + (spacing.xl * 1.5) + fontSize.outroText * 0.9;

    let currentTextY = textStartY;
    let textLineElements = '';

    wrappedTextBlocks.forEach((lines) => {
        lines.forEach((wrappedLine) => {
            textLineElements += `
            <text x="${centerX}" y="${currentTextY}"
                  font-family="Arial, Helvetica, sans-serif"
                  font-size="${fontSize.outroText}" font-weight="400"
                  fill="${textColor}" text-anchor="middle"
                  letter-spacing="0.5" opacity="1">
                ${escapeXml(wrappedLine)}
            </text>`;
            currentTextY += lineSpacing;
        });
    });

    const separatorWidth = orientation === 'portrait'
        ? Math.min(safeWidth * 0.3, spacing.xl * 3)
        : Math.min(safeWidth * 0.2, spacing.xl * 3);

    // Minimal clean SVG - NO gradients, NO patterns, NO glow, NO circles
    const svg = `
        <svg width="${safeWidth}" height="${safeHeight}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${safeWidth} ${safeHeight}" preserveAspectRatio="xMidYMid meet">
            <rect width="${safeWidth}" height="${safeHeight}" fill="${bgColor}"/>

            ${companyLines.map((line, index) => `
            <text x="${centerX}" y="${companyY + (index * fontSize.outroCompany * 1.1)}"
                  font-family="Arial, Helvetica, sans-serif"
                  font-size="${fontSize.outroCompany}" font-weight="700"
                  fill="${textColor}" text-anchor="middle"
                  letter-spacing="5">
                ${escapeXml(line)}
            </text>`).join('')}

            <line x1="${centerX - separatorWidth / 2}" y1="${separatorY}"
                  x2="${centerX + separatorWidth / 2}" y2="${separatorY}"
                  stroke="${accentColor}" stroke-width="${elements.accentLineWidth * 1.5}"
                  opacity="0.8" stroke-linecap="round"/>

            ${domainLines.map((line, index) => `
            <text x="${centerX}" y="${domainY + (index * fontSize.outroDomain * 1.1)}"
                  font-family="Arial, Helvetica, sans-serif"
                  font-size="${fontSize.outroDomain}" font-weight="500"
                  fill="${textColor}" text-anchor="middle"
                  letter-spacing="4" opacity="1">
                ${escapeXml(line)}
            </text>`).join('')}

            ${textLineElements}
        </svg>
    `;

    return await sharp(Buffer.from(svg))
        .resize(safeWidth, safeHeight, { fit: 'fill', kernel: 'lanczos3' })
        .png({ compressionLevel: 6 })
        .toBuffer();
}

// ==================== FFMPEG UTILITIES ====================

const probeVideo = (inputPath, timeoutMs = 15000) => {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('FFprobe timeout')), timeoutMs);
        ffmpeg.ffprobe(inputPath, (err, metadata) => {
            clearTimeout(timer);
            if (err) reject(new Error(`FFprobe failed: ${err.message}`));
            else resolve(metadata);
        });
    });
};

const validateVideoStream = (metadata) => {
    const vStream = metadata.streams?.find(s => s.codec_type === 'video');
    if (!vStream) throw new Error('No video stream found');
    if (!vStream.width || !vStream.height) throw new Error('Invalid dimensions');
    return vStream;
};

const cleanUpTempFiles = async (paths) => {
    if (!paths || typeof paths !== 'object') return;
    const promises = Object.values(paths)
        .filter(p => p && typeof p === 'string')
        .map(p => fs.unlink(p).catch(() => { }));
    await Promise.allSettled(promises);
};


const createMainVideoWithBanner = (inputVideo, bannerImage, outputPath, originalDuration, hasAudio, width, height, fps = 30) => {
    return new Promise((resolve, reject) => {
        const bannerFadeOut = 0.5;
        const bannerFadeStart = Math.max(0, originalDuration - bannerFadeOut);

        const safeWidth = makeEven(width);
        const safeHeight = makeEven(height);
        const bannerHeight = makeEven(Math.max(100, Math.min(180, Math.floor(height * 0.09))));

        // Position banner at BOTTOM of video
        const bannerY = safeHeight - bannerHeight;

        const complexFilter = [
            // Keep original video quality - only ensure even dimensions & SAR
            `[0:v]scale=${safeWidth}:${safeHeight}:flags=lanczos,setsar=1:1,fps=${fps},format=yuv420p[main]`,
            // Scale banner to correct size with alpha
            `[1:v]scale=${safeWidth}:${bannerHeight}:flags=lanczos,format=rgba,fade=t=out:st=${bannerFadeStart}:d=${bannerFadeOut}:alpha=1[banner]`,
            // Overlay banner at BOTTOM, remove shortest=1 (was truncating video)
            `[main][banner]overlay=0:0:format=auto,setsar=1:1,format=yuv420p[outv]`
        ];

        const outputOptions = [
            '-y',
            '-map', '[outv]',
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-crf', '20',                    // Higher quality (was 22)
            '-profile:v', 'high',            // Use high profile (was baseline - caused quality loss)
            '-level', '4.0',
            '-pix_fmt', 'yuv420p',
            '-r', `${fps}`,
            '-t', `${originalDuration}`,     // Explicit duration to prevent truncation
        ];

        if (hasAudio) {
            outputOptions.push(
                '-map', '0:a',
                '-c:a', 'aac',
                '-b:a', '192k',
                '-ar', '48000',
                '-ac', '2'
            );
        }

        ffmpeg()
            .input(inputVideo)
            .input(bannerImage)
            .complexFilter(complexFilter)
            .outputOptions(outputOptions)
            .on('start', (cmd) => {
                console.log(`  ▶️  Step 1: Banner overlay (${safeWidth}x${safeHeight} @ ${fps}fps)...`);
            })
            .on('end', () => {
                console.log('  ✅ Step 1 complete');
                resolve();
            })
            .on('error', (err, stdout, stderr) => {
                console.error('  ❌ Step 1 error:', err.message);
                if (stderr) console.error('  stderr:', stderr.substring(0, 500));
                reject(err);
            })
            .save(outputPath);
    });
};

const createMainVideoWithLogoOverlay = (inputVideo, logoImage, outputPath, originalDuration, hasAudio, width, height, fps = 30) => {
    return new Promise((resolve, reject) => {
        const safeWidth = makeEven(width);
        const safeHeight = makeEven(height);

        const complexFilter = [
            `[0:v]scale=${safeWidth}:${safeHeight}:flags=lanczos,setsar=1:1,fps=${fps},format=yuv420p[main]`,
            `[1:v]format=rgba[logo]`,
            `[main][logo]overlay=W-w-20:20:format=auto,setsar=1:1,format=yuv420p[outv]`
        ];

        const outputOptions = [
            '-y',
            '-map', '[outv]',
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-crf', '20',
            '-profile:v', 'high',
            '-level', '4.0',
            '-pix_fmt', 'yuv420p',
            '-r', `${fps}`,
            '-t', `${originalDuration}`,
        ];

        if (hasAudio) {
            outputOptions.push(
                '-map', '0:a',
                '-c:a', 'aac',
                '-b:a', '192k',
                '-ar', '48000',
                '-ac', '2'
            );
        }

        ffmpeg()
            .input(inputVideo)
            .input(logoImage)
            .complexFilter(complexFilter)
            .outputOptions(outputOptions)
            .on('start', () => {
                console.log(`  ▶️  Step 1: Logo overlay on main video (${safeWidth}x${safeHeight} @ ${fps}fps)...`);
            })
            .on('end', () => {
                console.log('  ✅ Step 1 complete');
                resolve();
            })
            .on('error', (err, stdout, stderr) => {
                console.error('  ❌ Step 1 error:', err.message);
                if (stderr) console.error('  stderr:', stderr.substring(0, 500));
                reject(err);
            })
            .save(outputPath);
    });
};


const createOutroVideo = (outroImage, outputPath, duration, width, height, hasAudio, fps = 30) => {
    return new Promise((resolve, reject) => {
        const safeWidth = makeEven(width);
        const safeHeight = makeEven(height);

        const fadeIn = 0.4;
        const fadeOut = 0.3;
        const fadeOutStart = Math.max(0, duration - fadeOut);

        const videoFilter = [
            `[0:v]scale=${safeWidth}:${safeHeight}:flags=lanczos,setsar=1:1,fps=${fps},format=yuv420p,fade=t=in:st=0:d=${fadeIn},fade=t=out:st=${fadeOutStart}:d=${fadeOut},trim=duration=${duration},setpts=PTS-STARTPTS[outv]`
        ];

        let command = ffmpeg()
            .input(outroImage)
            .inputOptions(['-loop', '1', '-t', `${duration}`]);

        const outputOptions = [
            '-y',
            '-map', '[outv]',
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-crf', '20',
            '-profile:v', 'high',
            '-level', '4.0',
            '-pix_fmt', 'yuv420p',
            '-r', `${fps}`,
        ];

        if (hasAudio) {
            // lavfi removed, using complex filter
            videoFilter.push(`anullsrc=channel_layout=stereo:sample_rate=48000:d=${duration}[outa]`);

            outputOptions.push(
                '-map', '[outa]',
                '-c:a', 'aac',
                '-b:a', '192k',
                '-ar', '48000',
                '-ac', '2'
            );
        } else {
            outputOptions.push('-an');
        }

        command
            .complexFilter(videoFilter)
            .outputOptions(outputOptions)
            .on('start', () => {
                console.log(`  ▶️  Step 2: Creating ${duration}s outro...`);
            })
            .on('end', () => {
                console.log('  ✅ Step 2 complete');
                resolve();
            })
            .on('error', (err, stdout, stderr) => {
                console.error('  ❌ Step 2 error:', err.message);
                if (stderr) console.error('  stderr:', stderr.substring(0, 800));
                reject(new Error(`Outro creation failed: ${err.message}`));
            })
            .save(outputPath);
    });
};



// ==================== STEP 3: Concatenate (FIXED) ====================

const concatenateVideos = (mainVideo, outroVideo, outputPath, hasAudio, width, height, fps) => {
    return new Promise((resolve, reject) => {
        const safeWidth = makeEven(width);
        const safeHeight = makeEven(height);

        // Both videos already have matching dimensions/SAR/fps from steps 1 & 2
        // So we can use simpler concat — but keep safety normalization
        const complexFilter = hasAudio
            ? [
                `[0:v]setsar=1:1,fps=${fps},setpts=PTS-STARTPTS[v0]`,
                `[1:v]setsar=1:1,fps=${fps},setpts=PTS-STARTPTS[v1]`,
                `[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a0]`,
                `[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a1]`,
                `[v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]`
            ]
            : [
                `[0:v]setsar=1:1,fps=${fps},setpts=PTS-STARTPTS[v0]`,
                `[1:v]setsar=1:1,fps=${fps},setpts=PTS-STARTPTS[v1]`,
                `[v0][v1]concat=n=2:v=1:a=0[outv]`
            ];

        const outputOptions = [
            '-y',
            '-map', '[outv]',
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-crf', '20',                  // High quality
            '-profile:v', 'high',          // High profile for quality
            '-level', '4.0',
            '-pix_fmt', 'yuv420p',
            '-r', `${fps}`,
        ];

        if (hasAudio) {
            outputOptions.push(
                '-map', '[outa]',
                '-c:a', 'aac',
                '-b:a', '192k',
                '-ar', '48000',
                '-ac', '2'
            );
        }

        outputOptions.push('-movflags', '+faststart');

        let lastProgress = 0;

        ffmpeg()
            .input(mainVideo)
            .input(outroVideo)
            .complexFilter(complexFilter)
            .outputOptions(outputOptions)
            .on('start', (cmd) => {
                console.log(`  ▶️  Step 3: Concatenating (${safeWidth}x${safeHeight})...`);
            })
            .on('progress', (progress) => {
                if (progress.percent) {
                    const percent = Math.min(100, Math.round(progress.percent));
                    if (percent >= lastProgress + 20) {
                        console.log(`     ⏳ ${percent}%`);
                        lastProgress = percent;
                    }
                }
            })
            .on('end', () => {
                console.log('  ✅ Step 3 complete');
                resolve();
            })
            .on('error', (err, stdout, stderr) => {
                console.error('  ❌ Step 3 error:', err.message);
                if (stderr) console.error('  stderr:', stderr.substring(0, 800));
                reject(err);
            })
            .save(outputPath);
    });
};


export async function addLogoOutroToVideo(videoBuffer, logoUrl = null, textLines = [], userId = null) {
    if (!videoBuffer || !Buffer.isBuffer(videoBuffer)) {
        throw new Error('Invalid video buffer provided');
    }
    if (videoBuffer.length === 0) {
        throw new Error('Empty video buffer provided');
    }

    let profile = null;
    try {
        if (userId && BusinessSummaryProfile) {
            profile = await BusinessSummaryProfile.findOne({ userId, isActive: true });
            if (profile) console.log('✅ Profile loaded for user:', userId);
        }
    } catch (error) {
        console.warn('⚠️  Profile fetch failed:', error.message);
    }

    const analysis = profile?.analysis || {};
    const branding = analysis.branding_guidelines || {};
    const rawColors = branding.brand_colors || [];
    const businessInfo = analysis.business_overview || {};

    const colorPalette = createColorPalette(rawColors);
    console.log('🎨 Color palette:', {
        primary: colorPalette.primary,
        secondary: colorPalette.secondary,
        accent: colorPalette.accent,
        background: colorPalette.background
    });

    const companyName = businessInfo.brand_name || profile?.businessName || "Your Business";
    const websiteUrl = profile?.websiteUrl || businessInfo.website || "yourbusiness.com";
    const domainName = String(websiteUrl).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').toLowerCase();

    const validTextLines = Array.isArray(textLines)
        ? textLines.filter(l => l && typeof l === 'string').map(l => l.trim()).filter(l => l.length > 0).slice(0, 4)
        : [];

    console.log('📋 Company:', companyName);
    console.log('🌐 Domain:', domainName);

    const tempDir = os.tmpdir();
    const videoId = uuidv4();

    const paths = {
        inputVideo: path.join(tempDir, `v_${videoId}_input.mp4`),
        banner: path.join(tempDir, `v_${videoId}_banner.png`),
        outro: path.join(tempDir, `v_${videoId}_outro.png`),
        outroClean: path.join(tempDir, `v_${videoId}_outro_clean.png`),
        mainWithBanner: path.join(tempDir, `v_${videoId}_main.mp4`),
        outroVideo: path.join(tempDir, `v_${videoId}_outro.mp4`),
        output: path.join(tempDir, `v_${videoId}_output.mp4`),
    };

    try {
        await fs.writeFile(paths.inputVideo, videoBuffer);
        console.log('✅ Input written:', (videoBuffer.length / 1024 / 1024).toFixed(2), 'MB');

        console.log('🔍 Analyzing video...');
        const metadata = await probeVideo(paths.inputVideo);
        const vStream = validateVideoStream(metadata);

        const width = vStream.width;
        const height = vStream.height;
        const hasAudio = metadata.streams.some(s => s.codec_type === 'audio');

        let originalDuration = 0;

        if (metadata.format?.duration && !isNaN(parseFloat(metadata.format.duration))) {
            originalDuration = parseFloat(metadata.format.duration);
        } else if (vStream.duration && !isNaN(parseFloat(vStream.duration))) {
            originalDuration = parseFloat(vStream.duration);
        } else if (vStream.nb_frames && vStream.r_frame_rate) {
            const [num, den] = vStream.r_frame_rate.split('/').map(Number);
            if (num && den && vStream.nb_frames) {
                originalDuration = parseInt(vStream.nb_frames) * (den / num);
            }
        }

        if (!originalDuration || originalDuration <= 0 || !isFinite(originalDuration)) {
            throw new Error('Could not determine video duration');
        }

        const outroDuration = 2.0;

        let fps = 30;
        if (vStream.r_frame_rate) {
            const [num, den] = vStream.r_frame_rate.split('/').map(Number);
            if (num && den) fps = Math.round(num / den);
        }
        if (fps < 15 || fps > 60) fps = 30;

        console.log(`📐 Resolution: ${width}x${height} @ ${fps}fps`);
        console.log(`⏱️  Original duration: ${originalDuration.toFixed(2)}s`);
        console.log(`⏱️  Outro duration: ${outroDuration}s`);
        console.log(`⏱️  Total output duration: ${(originalDuration + outroDuration).toFixed(2)}s`);
        console.log(`🔊 Audio: ${hasAudio ? 'Yes' : 'No'}`);

        const metrics = getVideoMetrics(width, height);
        console.log(`📱 Format: ${metrics.orientation} (${metrics.aspectName})`);

        // ─── LOGO OVERLAY OR BANNER ───────────────────────────────────
        let mainVideoPath;
        paths.logoResized = path.join(tempDir, `v_${videoId}_logo.png`);
        paths.mainWithLogo = path.join(tempDir, `v_${videoId}_main_logo.mp4`);

        if (logoUrl) {
            console.log('🖼️ Logo URL provided — adding logo overlay to main video');
            try {
                const logoBuffer = await fetchLogoBuffer(logoUrl);
                const resizedLogo = await sharp(logoBuffer)
                    .resize({
                        width: 100,
                        height: 100,
                        fit: "inside",
                        withoutEnlargement: true,
                        background: { r: 0, g: 0, b: 0, alpha: 0 }
                    })
                    .png()
                    .toBuffer();

                await fs.writeFile(paths.logoResized, resizedLogo);

                await createMainVideoWithLogoOverlay(
                    paths.inputVideo,
                    paths.logoResized,
                    paths.mainWithLogo,
                    originalDuration,
                    hasAudio,
                    width,
                    height,
                    fps
                );
                mainVideoPath = paths.mainWithLogo;
            } catch (err) {
                console.error("Failed to overlay logo on main video:", err.message);
                mainVideoPath = paths.inputVideo; // Fallback
            }
        } else {
            console.log('🎨 No logo URL — generating banner...');
            const bannerBuffer = await generateBannerImage(companyName, domainName, colorPalette, metrics);
            await fs.writeFile(paths.banner, bannerBuffer);
            console.log('✅ Banner:', (bannerBuffer.length / 1024).toFixed(2), 'KB');

            await createMainVideoWithBanner(
                paths.inputVideo,
                paths.banner,
                paths.mainWithBanner,
                originalDuration,
                hasAudio,
                width,
                height,
                fps
            );
            mainVideoPath = paths.mainWithBanner;
        }
        // ────────────────────────────────────────────────────────────────────

        console.log('🎨 Generating branded outro...');
        const outroBuffer = await generateOutroImage(companyName, domainName, validTextLines, colorPalette, metrics, logoUrl);
        await fs.writeFile(paths.outro, outroBuffer);
        console.log('✅ Branded outro:', (outroBuffer.length / 1024).toFixed(2), 'KB');

        console.log('🎨 Generating clean outro (last 2s)...');
        const cleanOutroBuffer = await generateCleanOutroImage(companyName, domainName, validTextLines, colorPalette, metrics);
        await fs.writeFile(paths.outroClean, cleanOutroBuffer);
        console.log('✅ Clean outro:', (cleanOutroBuffer.length / 1024).toFixed(2), 'KB');

        console.log('🎬 Processing pipeline:');

        await createOutroVideo(
            paths.outro,           // ← single image only
            paths.outroVideo,
            outroDuration,         // 2.0s
            width,
            height,
            hasAudio,
            fps
        );

        await concatenateVideos(
            mainVideoPath,       // ← banner version OR original depending on logoUrl
            paths.outroVideo,
            paths.output,
            hasAudio,
            width,
            height,
            fps
        );

        try {
            const outputMetadata = await probeVideo(paths.output);
            const outputDuration = parseFloat(outputMetadata.format?.duration || 0);
            console.log(`✅ Final output duration: ${outputDuration.toFixed(2)}s`);
        } catch (err) {
            console.warn('⚠️  Could not verify output duration');
        }

        const finalBuffer = await fs.readFile(paths.output);
        console.log(`📊 Output size: ${(finalBuffer.length / 1024 / 1024).toFixed(2)} MB`);

        console.log('✅ DONE');
        return finalBuffer;

    } catch (error) {
        console.error('❌ Error:', error.message);
        throw new Error(`Video processing failed: ${error.message}`);
    } finally {
        console.log('🧹 Cleaning up temp files...');
        await cleanUpTempFiles(paths);
    }
}

export default addLogoOutroToVideo;



// ==================== MAIN FUNCTION ====================

// export async function addLogoOutroToVideo(videoBuffer, logoUrl = null, textLines = [], userId = null) {
//     if (!videoBuffer || !Buffer.isBuffer(videoBuffer)) {
//         throw new Error('Invalid video buffer provided');
//     }
//     if (videoBuffer.length === 0) {
//         throw new Error('Empty video buffer provided');
//     }

//     let profile = null;
//     try {
//         if (userId && BusinessSummaryProfile) {
//             profile = await BusinessSummaryProfile.findOne({ userId });
//             if (profile) console.log('✅ Profile loaded for user:', userId);
//         }
//     } catch (error) {
//         console.warn('⚠️  Profile fetch failed:', error.message);
//     }

//     const analysis = profile?.analysis || {};
//     const branding = analysis.branding_guidelines || {};
//     const rawColors = branding.brand_colors || [];
//     const businessInfo = analysis.business_overview || {};

//     const colorPalette = createColorPalette(rawColors);
//     console.log('🎨 Color palette:', {
//         primary: colorPalette.primary,
//         secondary: colorPalette.secondary,
//         accent: colorPalette.accent,
//         background: colorPalette.background
//     });

//     const companyName = businessInfo.brand_name || profile?.businessName || "Your Business";
//     const websiteUrl = profile?.websiteUrl || businessInfo.website || "yourbusiness.com";
//     const domainName = websiteUrl.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').toLowerCase();

//     const validTextLines = Array.isArray(textLines)
//         ? textLines.filter(l => l && typeof l === 'string').map(l => l.trim()).filter(l => l.length > 0).slice(0, 4)
//         : [];

//     console.log('📋 Company:', companyName);
//     console.log('🌐 Domain:', domainName);

//     const tempDir = os.tmpdir();
//     const videoId = uuidv4();
//     // const paths = {
//     //     inputVideo: path.join(tempDir, `v_${videoId}_input.mp4`),
//     //     banner: path.join(tempDir, `v_${videoId}_banner.png`),
//     //     outro: path.join(tempDir, `v_${videoId}_outro.png`),
//     //     mainWithBanner: path.join(tempDir, `v_${videoId}_main.mp4`),
//     //     outroVideo: path.join(tempDir, `v_${videoId}_outro.mp4`),
//     //     output: path.join(tempDir, `v_${videoId}_output.mp4`),
//     // };

//     const paths = {
//         inputVideo: path.join(tempDir, `v_${videoId}_input.mp4`),
//         banner: path.join(tempDir, `v_${videoId}_banner.png`),
//         outro: path.join(tempDir, `v_${videoId}_outro.png`),
//         outroClean: path.join(tempDir, `v_${videoId}_outro_clean.png`), // NEW
//         mainWithBanner: path.join(tempDir, `v_${videoId}_main.mp4`),
//         outroVideo: path.join(tempDir, `v_${videoId}_outro.mp4`),
//         output: path.join(tempDir, `v_${videoId}_output.mp4`),
//     };

//     try {
//         await fs.writeFile(paths.inputVideo, videoBuffer);
//         console.log('✅ Input written:', (videoBuffer.length / 1024 / 1024).toFixed(2), 'MB');

//         console.log('🔍 Analyzing video...');
//         const metadata = await probeVideo(paths.inputVideo);
//         const vStream = validateVideoStream(metadata);

//         const width = vStream.width;
//         const height = vStream.height;
//         const hasAudio = metadata.streams.some(s => s.codec_type === 'audio');

//         let originalDuration = 0;

//         if (metadata.format?.duration && !isNaN(parseFloat(metadata.format.duration))) {
//             originalDuration = parseFloat(metadata.format.duration);
//         } else if (vStream.duration && !isNaN(parseFloat(vStream.duration))) {
//             originalDuration = parseFloat(vStream.duration);
//         } else if (vStream.nb_frames && vStream.r_frame_rate) {
//             const [num, den] = vStream.r_frame_rate.split('/').map(Number);
//             if (num && den && vStream.nb_frames) {
//                 originalDuration = parseInt(vStream.nb_frames) * (den / num);
//             }
//         }

//         if (!originalDuration || originalDuration <= 0 || !isFinite(originalDuration)) {
//             throw new Error('Could not determine video duration');
//         }

//         const outroDuration = 2.0;

//         let fps = 30;
//         if (vStream.r_frame_rate) {
//             const [num, den] = vStream.r_frame_rate.split('/').map(Number);
//             if (num && den) fps = Math.round(num / den);
//         }
//         if (fps < 15 || fps > 60) fps = 30;

//         console.log(`📐 Resolution: ${width}x${height} @ ${fps}fps`);
//         console.log(`⏱️  Original duration: ${originalDuration.toFixed(2)}s`);
//         console.log(`⏱️  Outro duration: ${outroDuration}s`);
//         console.log(`⏱️  Total output duration: ${(originalDuration + outroDuration).toFixed(2)}s`);
//         console.log(`🔊 Audio: ${hasAudio ? 'Yes' : 'No'}`);

//         const metrics = getVideoMetrics(width, height);
//         console.log(`📱 Format: ${metrics.orientation} (${metrics.aspectName})`);

//         console.log('🎨 Generating banner...');
//         const bannerBuffer = await generateBannerImage(companyName, domainName, colorPalette, metrics);
//         await fs.writeFile(paths.banner, bannerBuffer);
//         console.log('✅ Banner:', (bannerBuffer.length / 1024).toFixed(2), 'KB');

//         // console.log('🎨 Generating outro...');
//         // const outroBuffer = await generateOutroImage(companyName, domainName, validTextLines, colorPalette, metrics);
//         // await fs.writeFile(paths.outro, outroBuffer);
//         // console.log('✅ Outro:', (outroBuffer.length / 1024).toFixed(2), 'KB');

//         console.log('🎨 Generating branded outro...');
//         const outroBuffer = await generateOutroImage(companyName, domainName, validTextLines, colorPalette, metrics);
//         await fs.writeFile(paths.outro, outroBuffer);
//         console.log('✅ Branded outro:', (outroBuffer.length / 1024).toFixed(2), 'KB');

//         console.log('🎨 Generating clean outro (last 2s)...');
//         const cleanOutroBuffer = await generateCleanOutroImage(companyName, domainName, validTextLines, colorPalette, metrics);
//         await fs.writeFile(paths.outroClean, cleanOutroBuffer);
//         console.log('✅ Clean outro:', (cleanOutroBuffer.length / 1024).toFixed(2), 'KB');

//         console.log('🎬 Processing pipeline:');

//         await createMainVideoWithBanner(
//             paths.inputVideo,
//             paths.banner,
//             paths.mainWithBanner,
//             originalDuration,
//             hasAudio,
//             width,
//             height,
//             fps
//         );

//         await createOutroVideo(
//             paths.outro,           // branded image
//             paths.outroClean,      // clean image (new)
//             paths.outroVideo,
//             outroDuration,
//             width,
//             height,
//             hasAudio,
//             fps
//         );

//         await concatenateVideos(
//             paths.mainWithBanner,
//             paths.outroVideo,
//             paths.output,
//             hasAudio,
//             width,
//             height,
//             fps
//         );

//         try {
//             const outputMetadata = await probeVideo(paths.output);
//             const outputDuration = parseFloat(outputMetadata.format?.duration || 0);
//             console.log(`✅ Final output duration: ${outputDuration.toFixed(2)}s`);
//         } catch (err) {
//             console.warn('⚠️  Could not verify output duration');
//         }

//         const finalBuffer = await fs.readFile(paths.output);
//         console.log(`📊 Output size: ${(finalBuffer.length / 1024 / 1024).toFixed(2)} MB`);

//         console.log('🧹 Cleaning up...');
//         await cleanUpTempFiles(paths);

//         console.log('✅ DONE');
//         return finalBuffer;

//     } catch (error) {
//         console.error('❌ Error:', error.message);
//         await cleanUpTempFiles(paths);
//         throw new Error(`Video processing failed: ${error.message}`);
//     }
// }



// ==================== STEP 2: Outro Video (FIXED) ====================

// const createOutroVideo = (outroImage, outputPath, duration, width, height, hasAudio, fps = 30) => {
//     return new Promise((resolve, reject) => {
//         const fadeIn = 0.4;
//         const fadeOut = 0.3;
//         const fadeOutStart = Math.max(0, duration - fadeOut);

//         const safeWidth = makeEven(width);
//         const safeHeight = makeEven(height);

//         const videoFilter = [
//             `scale=${safeWidth}:${safeHeight}:flags=lanczos`,
//             `setsar=1:1`,
//             `fade=t=in:st=0:d=${fadeIn}:alpha=0`,
//             `fade=t=out:st=${fadeOutStart}:d=${fadeOut}:alpha=0`,
//             `fps=${fps}`,
//             `format=yuv420p`
//         ].join(',');

//         let command = ffmpeg()
//             .input(outroImage)
//             .inputOptions([
//                 '-loop', '1',
//                 '-framerate', `${fps}`,
//                 '-t', `${duration}`       // Needed here too for image input
//             ]);

//         const outputOptions = [
//             '-y',
//             '-vf', videoFilter,
//             '-c:v', 'libx264',
//             '-preset', 'ultrafast',
//             '-crf', '20',
//             '-profile:v', 'high',         // Match main video profile
//             '-level', '4.0',
//             '-pix_fmt', 'yuv420p',
//             '-r', `${fps}`,
//             '-t', `${duration}`,
//         ];

//         if (hasAudio) {
//             command = command
//                 .input('anullsrc=channel_layout=stereo:sample_rate=48000')
//                 .inputOptions(['-f', 'lavfi', '-t', `${duration}`]);

//             outputOptions.push(
//                 '-c:a', 'aac',
//                 '-b:a', '192k',
//                 '-ar', '48000',
//                 '-ac', '2',
//                 '-shortest'
//             );
//         } else {
//             outputOptions.push('-an');
//         }

//         command
//             .outputOptions(outputOptions)
//             .on('start', (cmd) => {
//                 console.log(`  ▶️  Step 2: Creating ${duration}s outro...`);
//             })
//             .on('end', () => {
//                 console.log('  ✅ Step 2 complete');
//                 resolve();
//             })
//             .on('error', (err, stdout, stderr) => {
//                 console.error('  ❌ Step 2 error:', err.message);
//                 if (stderr) console.error('  stderr:', stderr.substring(0, 800));
//                 reject(new Error(`Outro creation failed: ${err.message}`));
//             })
//             .save(outputPath);
//     });
// };

// ==================== STEP 2: Outro Video (UPDATED - Split branded + clean) ====================


// ==================== OUTRO GENERATOR ====================

// async function generateOutroImage(companyName, domainName, textLines, colors, metrics) {
//     const { width, height, fontSize, spacing, elements, orientation } = metrics;

//     const primaryColor = colors.primary;
//     const secondaryColor = colors.secondary;
//     const accentColor = colors.accent;
//     const textColor = colors.primaryText;
//     const accentLight = colors.accentLight;

//     const safeWidth = makeEven(width);
//     const safeHeight = makeEven(height);

//     const centerX = safeWidth / 2;
//     const centerY = safeHeight / 2;

//     const validTextLines = textLines && textLines.length > 0 ? textLines.slice(0, 4) : [];

//     const lineSpacing = fontSize.outroText + spacing.sm;
//     const textBlockHeight = validTextLines.length * lineSpacing;

//     const circleRadius = elements.decorativeCircleRadius;
//     const circleSpace = circleRadius * 2.2;
//     const companySpace = fontSize.outroCompany;
//     const separatorSpace = spacing.md;
//     const domainSpace = fontSize.outroDomain;
//     const textSpace = textBlockHeight > 0 ? (textBlockHeight + spacing.lg) : 0;

//     const totalContentHeight = circleSpace + spacing.lg + companySpace + separatorSpace +
//         spacing.md + domainSpace + textSpace;

//     const contentStartY = (safeHeight - totalContentHeight) / 2;

//     const circleY = contentStartY + circleRadius * 1.1;
//     const companyY = circleY + circleRadius * 1.1 + spacing.lg + fontSize.outroCompany * 0.8;
//     const separatorY = companyY + separatorSpace + spacing.sm;
//     const domainY = separatorY + spacing.md + fontSize.outroDomain * 0.8;
//     const textStartY = domainY + spacing.lg + fontSize.outroText * 0.8;

//     const textLineElements = validTextLines.map((line, index) => {
//         const y = textStartY + (index * lineSpacing);
//         const truncatedLine = truncateText(line, 60);
//         return `
//             <text x="${centerX}" y="${y}"
//                   font-family="Arial, Helvetica, sans-serif"
//                   font-size="${fontSize.outroText}" font-weight="300"
//                   fill="${textColor}" text-anchor="middle"
//                   letter-spacing="0.5" opacity="0.88">
//                 ${escapeXml(truncatedLine)}
//             </text>`;
//     }).join('');

//     const companyText = truncateText(companyName.toUpperCase(), 28);
//     const domainText = truncateText(domainName, 40);

//     const separatorWidth = orientation === 'portrait'
//         ? Math.min(safeWidth * 0.3, spacing.xl * 3)
//         : Math.min(safeWidth * 0.2, spacing.xl * 3);

//     const svg = `
//         <svg width="${safeWidth}" height="${safeHeight}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${safeWidth} ${safeHeight}" preserveAspectRatio="xMidYMid meet">
//             <defs>
//                 <linearGradient id="mainGrad" x1="0%" y1="0%" x2="0%" y2="100%">
//                     <stop offset="0%" style="stop-color:${primaryColor};stop-opacity:1" />
//                     <stop offset="50%" style="stop-color:${secondaryColor};stop-opacity:1" />
//                     <stop offset="100%" style="stop-color:${primaryColor};stop-opacity:0.92" />
//                 </linearGradient>
//                 <radialGradient id="spotlight" cx="50%" cy="35%">
//                     <stop offset="0%" style="stop-color:${textColor};stop-opacity:0.18" />
//                     <stop offset="50%" style="stop-color:${textColor};stop-opacity:0.08" />
//                     <stop offset="100%" style="stop-color:${textColor};stop-opacity:0" />
//                 </radialGradient>
//                 <filter id="textGlow" x="-50%" y="-50%" width="200%" height="200%">
//                     <feGaussianBlur stdDeviation="${elements.shadowBlur * 1.2}" result="coloredBlur"/>
//                     <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
//                 </filter>
//                 <pattern id="dotPattern" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
//                     <circle cx="20" cy="20" r="1.5" fill="${textColor}" opacity="0.08"/>
//                 </pattern>
//             </defs>

//             <rect width="${safeWidth}" height="${safeHeight}" fill="url(#mainGrad)"/>
//             <rect width="${safeWidth}" height="${safeHeight}" fill="url(#dotPattern)"/>
//             <ellipse cx="${centerX}" cy="${circleY}" rx="${safeWidth * 0.7}" ry="${safeHeight * 0.45}" fill="url(#spotlight)"/>

//             <circle cx="${centerX}" cy="${circleY}" r="${circleRadius * 1.4}" fill="none" stroke="${accentLight}" stroke-width="${elements.accentLineWidth}" opacity="0.15"/>
//             <circle cx="${centerX}" cy="${circleY}" r="${circleRadius * 1.1}" fill="none" stroke="${accentColor}" stroke-width="${elements.accentLineWidth * 1.5}" opacity="0.25"/>
//             <circle cx="${centerX}" cy="${circleY}" r="${circleRadius * 0.7}" fill="${accentColor}" opacity="0.18"/>

//             <text x="${centerX}" y="${companyY}"
//                   font-family="Arial, Helvetica, sans-serif"
//                   font-size="${fontSize.outroCompany}" font-weight="500"
//                   fill="${textColor}" text-anchor="middle"
//                   letter-spacing="5" filter="url(#textGlow)">
//                 ${escapeXml(companyText)}
//             </text>

//             <line x1="${centerX - separatorWidth / 2}" y1="${separatorY}"
//                   x2="${centerX + separatorWidth / 2}" y2="${separatorY}"
//                   stroke="${accentColor}" stroke-width="${elements.accentLineWidth * 1.5}"
//                   opacity="0.4" stroke-linecap="round"/>

//             <circle cx="${centerX - separatorWidth / 2 - spacing.sm}" cy="${separatorY}" r="${spacing.xs}" fill="${accentLight}" opacity="0.5"/>
//             <circle cx="${centerX + separatorWidth / 2 + spacing.sm}" cy="${separatorY}" r="${spacing.xs}" fill="${accentLight}" opacity="0.5"/>

//             <text x="${centerX}" y="${domainY}"
//                   font-family="Arial, Helvetica, sans-serif"
//                   font-size="${fontSize.outroDomain}" font-weight="400"
//                   fill="${accentLight}" text-anchor="middle"
//                   letter-spacing="4" opacity="0.92">
//                 ${escapeXml(domainText)}
//             </text>

//             ${textLineElements}

//             <rect y="${safeHeight - elements.accentLineWidth * 2}"
//                   width="${safeWidth}" height="${elements.accentLineWidth * 2}"
//                   fill="${accentColor}" opacity="0.3"/>
//         </svg>
//     `;

//     return await sharp(Buffer.from(svg))
//         .resize(safeWidth, safeHeight, { fit: 'fill', kernel: 'lanczos3' })
//         .png({ compressionLevel: 6 })
//         .toBuffer();
// }
