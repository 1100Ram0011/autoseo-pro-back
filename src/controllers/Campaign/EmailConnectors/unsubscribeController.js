// controllers/Campaign/EmailCampaign/unsubscribeController.js
import crypto from "crypto";
import mongoose from "mongoose";
import Unsubscribe from "../../../models/Campaign/EmailCampaign/unsubscribeSchema.js";

/**
 * Generates a unique unsubscribe token for a recipient.
 */
export const generateUnsubscribeToken = async (email, userId, campaignId) => {
  const token = crypto
    .createHash("sha256")
    .update(`${email}-${userId}-${Date.now()}-${Math.random()}`)
    .digest("hex");

  const record = await Unsubscribe.findOneAndUpdate(
    { email: email.toLowerCase(), userId },
    {
      $setOnInsert: {
        campaignId,
        token,
      }
    },
    { upsert: true, new: true }
  );

  return record.token;
};

/**
 * GET /api/unsubscribe?token=xxx
 * Shows the approval page only. No DB write happens yet.
 */
export const handleUnsubscribeConfirm = async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) return res.status(400).send(renderPage("invalid_token"));

    const record = await Unsubscribe.findOne({ token });

    if (!record) return res.status(404).send(renderPage("not_found"));

    if (record.unsubscribedAt) {
      return res.send(renderPage("already_done", record.email));
    }

    return res.send(renderPage("confirm", record.email, token));
  } catch (err) {
    console.error("[Unsubscribe] Confirm error:", err.message);
    return res.status(500).send(renderPage("server_error"));
  }
};

/**
 * POST /api/unsubscribe
 * User clicked "Yes, unsubscribe me".
 */
export const handleUnsubscribe = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) return res.status(400).send(renderPage("invalid_token"));

    const record = await Unsubscribe.findOne({ token });

    if (!record) return res.status(404).send(renderPage("not_found"));

    if (record.unsubscribedAt) {
      return res.send(renderPage("already_done", record.email));
    }

    record.unsubscribedAt = new Date();
    await record.save();

    return res.send(renderPage("success", record.email));
  } catch (err) {
    console.error("[Unsubscribe] Error:", err.message);
    return res.status(500).send(renderPage("server_error"));
  }
};

/**
 * Check if an email is unsubscribed from a specific sender.
 */
export const isUnsubscribed = async (email, userId) => {
  const record = await Unsubscribe.findOne({
    email: email.toLowerCase().trim(),
    userId: new mongoose.Types.ObjectId(userId),
    unsubscribedAt: { $ne: null },
  });

  return !!record;
};

const escHtml = (str) =>
  String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const VARIANTS = {
  confirm: {
    title: "Confirm Unsubscribe",
    tag: "Action required",
    heading: "Are you sure you want to unsubscribe?",
    body: (email) =>
      email
        ? `<strong>${escHtml(email)}</strong> will be removed from all future emails from this sender.`
        : "You will stop receiving all future emails from this sender.",
    accentRgb: "249,115,22",
    tagColor: "#ffffff",
    tagBg: "rgba(249,115,22,0.1)",
    tagBorder: "rgba(249,115,22,0.25)",
    showConfirmButtons: true,
    footnote: "",
  },
  success: {
    title: "Unsubscribed",
    tag: "Done",
    heading: "You're unsubscribed.",
    body: (email) =>
      email
        ? `<strong>${escHtml(email)}</strong> has been removed from this mailing list. You won't receive any further emails from this sender.`
        : "You've been removed from this mailing list. You won't receive any further emails.",
    accentRgb: "34,197,94",
    tagColor: "#4ade80",
    tagBg: "rgba(34,197,94,0.1)",
    tagBorder: "rgba(34,197,94,0.25)",
    showConfirmButtons: false,
    footnote:
      "Requests are processed immediately. If you unsubscribed by mistake, contact the sender directly.",
  },
  already_done: {
    title: "Already Unsubscribed",
    tag: "No action needed",
    heading: "Already unsubscribed.",
    body: (email) =>
      email
        ? `<strong>${escHtml(email)}</strong> is already off this mailing list. No further action is needed.`
        : "This address is already off this mailing list.",
    accentRgb: "99,102,241",
    tagColor: "#818cf8",
    tagBg: "rgba(99,102,241,0.1)",
    tagBorder: "rgba(99,102,241,0.25)",
    showConfirmButtons: false,
    footnote:
      "Your preference is already saved. If you keep receiving emails, contact the sender directly.",
  },
  not_found: {
    title: "Link Not Found",
    tag: "Invalid link",
    heading: "Link not found.",
    body: () =>
      "This unsubscribe link is invalid or has expired. If you're still receiving unwanted emails, please contact the sender directly.",
    accentRgb: "251,146,60",
    tagColor: "#fb923c",
    tagBg: "rgba(251,146,60,0.1)",
    tagBorder: "rgba(251,146,60,0.25)",
    showConfirmButtons: false,
    footnote: "Please use the exact original link from your email.",
  },
  invalid_token: {
    title: "Invalid Link",
    tag: "Malformed request",
    heading: "Invalid link.",
    body: () =>
      "This unsubscribe link appears to be malformed or incomplete. Please use the original link from your email.",
    accentRgb: "239,68,68",
    tagColor: "#f87171",
    tagBg: "rgba(239,68,68,0.1)",
    tagBorder: "rgba(239,68,68,0.25)",
    showConfirmButtons: false,
    footnote: "Links cannot be modified. Please check your original email.",
  },
  server_error: {
    title: "Server Error",
    tag: "Error",
    heading: "Something went wrong.",
    body: () =>
      "We hit an unexpected error. Please try again in a moment or contact support if the issue continues.",
    accentRgb: "239,68,68",
    tagColor: "#f87171",
    tagBg: "rgba(239,68,68,0.1)",
    tagBorder: "rgba(239,68,68,0.25)",
    showConfirmButtons: false,
    footnote: "If the problem persists, please contact support.",
  },
};

const renderPage = (variant = "server_error", email = "", token = "") => {
  const v = VARIANTS[variant] ?? VARIANTS.server_error;
  const isSuccess = variant === "success";
  const showButtons = v.showConfirmButtons === true;
  const bodyText = v.body(email);
  const year = new Date().getFullYear();
  const safeToken = escHtml(token);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta name="color-scheme" content="light dark"/>
  <title>${v.title} - Mailer</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"/>
  <link rel="icon" href="https://www.borade.ai/vite.png">
  <script>
    (function () {
      try {
        var theme = new URLSearchParams(window.location.search).get("theme");
        if (theme === "light" || theme === "dark") {
          document.documentElement.setAttribute("data-theme", theme);
          return;
        }

        if (
          window.matchMedia &&
          window.matchMedia("(prefers-color-scheme: light)").matches
        ) {
          document.documentElement.setAttribute("data-theme", "light");
        }
      } catch (err) {}
    })();
  </script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root,
    html[data-theme="dark"] {
      --brand-grad: linear-gradient(135deg, #ffffff 0%, #ffffff 100%);
      --brand-border: rgba(249, 115, 22, 0.44);
      --brand-shadow:
        0 1px 4px rgba(249, 115, 22, 0.3),
        0 4px 16px rgba(249, 115, 22, 0.2);
      --brand-shadow-hover:
        0 2px 8px rgba(249, 115, 22, 0.4),
        0 8px 24px rgba(249, 115, 22, 0.25);
      --bg-grad: linear-gradient(180deg, #0c0e13 0%, #10131a 100%);
      --surface: #13161d;
      --surface-2: #171b24;
      --surface-3: #20263a;
      --border: rgba(255, 255, 255, 0.07);
      --border-mid: rgba(255, 255, 255, 0.11);
      --text-hi: #f1f3f7;
      --text-mid: #7c8699;
      --pill-bg: #20263a;
      --pill-border: rgba(255, 255, 255, 0.11);
      --pill-text: #f1f3f7;
      --warn-bg: rgba(249, 115, 22, 0.06);
      --warn-border: rgba(249, 115, 22, 0.18);
      --warn-accent: #ffffff;
      --grid-line: rgba(255, 255, 255, 0.03);
      --glow-rgb: 249, 115, 22;
      --card-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.03) inset,
        0 2px 8px rgba(0, 0, 0, 0.5),
        0 12px 40px rgba(0, 0, 0, 0.45),
        0 0 80px rgba(249, 115, 22, 0.05);
      --rule-color: rgba(255, 255, 255, 0.08);
      --footnote-color: rgba(255, 255, 255, 0.92);
      --footer-color: rgba(255, 255, 255, 0.92);
      --focus-ring: rgba(249, 115, 22, 0.18);
      --radius-lg: 20px;
      --radius-md: 12px;
      --radius-sm: 8px;
      --radius-pill: 100px;
    }

    @media (prefers-color-scheme: light) {
      :root:not([data-theme="dark"]) {
        --brand-grad: linear-gradient(135deg, #38bdf8 0%, #2563eb 100%);
        --brand-border: rgba(37, 99, 235, 0.3);
        --brand-shadow:
          0 12px 28px rgba(37, 99, 235, 0.18),
          0 2px 8px rgba(56, 189, 248, 0.12);
        --brand-shadow-hover:
          0 16px 34px rgba(37, 99, 235, 0.22),
          0 4px 12px rgba(56, 189, 248, 0.18);
        --bg-grad: linear-gradient(180deg, #f8fbff 0%, #eef5ff 100%);
        --surface: #ffffff;
        --surface-2: #f8fbff;
        --surface-3: #edf4ff;
        --border: rgba(148, 163, 184, 0.22);
        --border-mid: rgba(148, 163, 184, 0.34);
        --text-hi: #0f172a;
        --text-mid: #64748b;
        --pill-bg: #edf4ff;
        --pill-border: rgba(147, 197, 253, 0.5);
        --pill-text: #1e3a8a;
        --warn-bg: rgba(37, 99, 235, 0.06);
        --warn-border: rgba(37, 99, 235, 0.16);
        --warn-accent: #2563eb;
        --grid-line: rgba(148, 163, 184, 0.12);
        --glow-rgb: 37, 99, 235;
        --card-shadow:
          0 0 0 1px rgba(219, 234, 254, 0.72) inset,
          0 16px 40px rgba(37, 99, 235, 0.1),
          0 4px 12px rgba(15, 23, 42, 0.05);
        --rule-color: rgba(148, 163, 184, 0.26);
        --footnote-color: #334155;
        --footer-color: #475569;
        --focus-ring: rgba(37, 99, 235, 0.16);
      }
    }

    html[data-theme="light"] {
      --brand-grad: linear-gradient(135deg, #38bdf8 0%, #2563eb 100%);
      --brand-border: rgba(37, 99, 235, 0.3);
      --brand-shadow:
        0 12px 28px rgba(37, 99, 235, 0.18),
        0 2px 8px rgba(56, 189, 248, 0.12);
      --brand-shadow-hover:
        0 16px 34px rgba(37, 99, 235, 0.22),
        0 4px 12px rgba(56, 189, 248, 0.18);
      --bg-grad: linear-gradient(180deg, #f8fbff 0%, #eef5ff 100%);
      --surface: #ffffff;
      --surface-2: #f8fbff;
      --surface-3: #edf4ff;
      --border: rgba(148, 163, 184, 0.22);
      --border-mid: rgba(148, 163, 184, 0.34);
      --text-hi: #0f172a;
      --text-mid: #64748b;
      --pill-bg: #edf4ff;
      --pill-border: rgba(147, 197, 253, 0.5);
      --pill-text: #1e3a8a;
      --warn-bg: rgba(37, 99, 235, 0.06);
      --warn-border: rgba(37, 99, 235, 0.16);
      --warn-accent: #2563eb;
      --grid-line: rgba(148, 163, 184, 0.12);
      --glow-rgb: 37, 99, 235;
      --card-shadow:
        0 0 0 1px rgba(219, 234, 254, 0.72) inset,
        0 16px 40px rgba(37, 99, 235, 0.1),
        0 4px 12px rgba(15, 23, 42, 0.05);
      --rule-color: rgba(148, 163, 184, 0.26);
      --footnote-color: #334155;
      --footer-color: #475569;
      --focus-ring: rgba(37, 99, 235, 0.16);
    }

    html, body {
      min-height: 100%;
      background: var(--bg-grad);
      font-family: "Sora", system-ui, sans-serif;
      -webkit-font-smoothing: antialiased;
      color: var(--text-hi);
    }

    body::before {
      content: "";
      position: fixed;
      inset: 0;
      z-index: 0;
      pointer-events: none;
      background:
        radial-gradient(ellipse 60% 45% at 50% -2%, rgba(var(--glow-rgb), 0.14) 0%, transparent 60%),
        linear-gradient(var(--grid-line) 1px, transparent 1px),
        linear-gradient(90deg, var(--grid-line) 1px, transparent 1px);
      background-size: auto, 52px 52px, 52px 52px;
    }

    .page {
      position: relative;
      z-index: 1;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 18px;
      padding: 40px 20px;
    }

    .card {
      width: 100%;
      max-width: 540px;
      background: linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%);
      border: 1px solid var(--border-mid);
      border-radius: var(--radius-lg);
      overflow: hidden;
      box-shadow: var(--card-shadow);
      opacity: 0;
      transform: translateY(22px) scale(0.975);
      animation: cardIn 0.55s cubic-bezier(0.22, 1, 0.36, 1) 0.1s forwards;
    }

    .card-stripe {
      height: 4px;
      background: var(--brand-grad);
    }

    .card-body {
      padding: 42px 44px 38px;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      margin-bottom: 28px;
      padding: 6px 16px;
      border-radius: var(--radius-pill);
      background: ${v.tagBg};
      border: 1px solid ${v.tagBorder};
      color: ${v.tagColor};
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .badge-dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: currentColor;
      ${showButtons ? "animation: pulse-dot 1.6s ease-in-out infinite;" : isSuccess ? "box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.18);" : ""}
    }

    h1 {
      max-width: 420px;
      margin-bottom: 14px;
      font-size: 28px;
      line-height: 1.18;
      letter-spacing: -0.04em;
      font-weight: 700;
      color: var(--text-hi);
    }

    .body-text {
      max-width: 360px;
      font-size: 14px;
      line-height: 1.85;
      color: var(--text-mid);
      font-weight: 400;
    }

    .body-text strong {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 10px;
      border: 1px solid var(--pill-border);
      background: var(--pill-bg);
      color: var(--pill-text);
      font-family: "JetBrains Mono", monospace;
      font-size: 12px;
      font-weight: 500;
    }

    .actions-wrapper {
      width: 100%;
      margin-top: 32px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .warn-box {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 14px 16px;
      border-radius: 16px;
      border: 1px solid var(--warn-border);
      background: var(--warn-bg);
      text-align: left;
    }

    .warn-icon {
      flex-shrink: 0;
      margin-top: 1px;
      color: var(--warn-accent);
      opacity: 0.9;
    }

    .warn-text {
      color: var(--text-mid);
      font-size: 12.5px;
      line-height: 1.7;
    }

    .warn-text strong {
      color: var(--warn-accent);
      font-weight: 600;
      background: none;
      border: none;
      padding: 0;
      font-family: inherit;
      font-size: inherit;
    }

    .btn-yes {
      position: relative;
      overflow: hidden;
      width: 100%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 16px 22px;
      border-radius: 16px;
      background: var(--brand-grad);
      color: #0a0a0aff;
      font-family: "Sora", sans-serif;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: -0.02em;
      cursor: pointer;
      
    }

    .btn-yes:focus-visible {
      outline: none;
      box-shadow: var(--brand-shadow-hover), 0 0 0 4px var(--focus-ring);
    }

    .btn-yes:disabled {
      opacity: 0.7;
      cursor: not-allowed;
      filter: none;
      transform: none;
    }

    .btn-yes::after {
      content: "";
      position: absolute;
      top: 0;
      left: -130%;
      width: 55%;
      height: 100%;
      background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
      transition: left 0.5s ease;
    }

    .btn-yes:hover::after {
      left: 210%;
    }

    .rule {
      width: 100%;
      height: 1px;
      margin: 28px 0 22px;
      background: var(--rule-color);
    }

    .footnote {
      max-width: 380px;
      font-size: 12.5px;
      line-height: 1.9;
      text-align: center;
      color: var(--footnote-color);
    }

    .footer {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--footer-color);
      opacity: 0;
      animation: fadeUp 0.35s ease 0.45s forwards;
    }

    .footer-sep {
      opacity: 0.38;
    }

    html[data-theme="light"] body[data-variant="confirm"] .badge {
      color: #2563eb;
      background: rgba(37, 99, 235, 0.08);
      border-color: rgba(37, 99, 235, 0.18);
    }

    html[data-theme="light"] body[data-variant="confirm"] .badge-dot {
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.14);
    }

    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes cardIn {
      from { opacity: 0; transform: translateY(22px) scale(0.975); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    @keyframes pulse-dot {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.35; transform: scale(0.8); }
    }

    @keyframes btn-spin {
      to { transform: rotate(360deg); }
    }

    @media (max-width: 640px) {
      .page {
        padding: 24px 14px;
      }

      .card {
        max-width: 100%;
      }

      .card-body {
        padding: 30px 22px 26px;
      }

      h1 {
        font-size: 24px;
      }

      .body-text {
        max-width: 100%;
      }

      .btn-yes {
        padding: 14px 18px;
        font-size: 14px;
      }
    }
  </style>
</head>
<body data-variant="${variant}">
  <main class="page">
    <div class="card" role="main">
      <div class="card-stripe" aria-hidden="true"></div>

      <div class="card-body">
        <div class="badge" role="status">
          <span class="badge-dot" aria-hidden="true"></span>
          ${v.tag}
        </div>

        <h1>${v.heading}</h1>
        <p class="body-text">${bodyText}</p>

        ${showButtons
          ? `
        <div class="actions-wrapper">
          <div class="warn-box" role="alert">
            <span class="warn-icon" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </span>
            <p class="warn-text">
              This will <strong>permanently</strong> stop all future emails from this sender.
              This action cannot be undone from this link.
            </p>
          </div>

          <form method="POST" action="" id="unsub-form" aria-label="Confirm unsubscribe">
            <input type="hidden" name="token" value="${safeToken}"/>
            <button type="submit" class="btn-yes" id="btn-yes">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              Yes, unsubscribe me
            </button>
          </form>
        </div>
        `
          : `
        <div class="rule" aria-hidden="true"></div>
        <p class="footnote">${v.footnote}</p>
        `}
      </div>
    </div>

    <footer class="footer">
      <span>&copy; ${year} Borade AI</span>
      <span class="footer-sep" aria-hidden="true">&middot;</span>
      <span>All rights reserved</span>
    </footer>
  </main>

  <script>
    (function () {
      var form = document.getElementById("unsub-form");
      var btn = document.getElementById("btn-yes");
      if (!form || !btn) return;

      form.addEventListener("submit", function () {
        btn.disabled = true;
        btn.innerHTML =
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="animation:btn-spin 0.65s linear infinite" aria-hidden="true">' +
          '<path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>' +
          "Processing...";
      });
    })();
  </script>
</body>
</html>`;
};