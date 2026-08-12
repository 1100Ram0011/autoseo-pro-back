import Anthropic from "@anthropic-ai/sdk";
import config from "../config/config.js";
import { executeApifyRun } from "./publicSocialAnalytics.service.js";

const SOCIAL_PLATFORMS = {
  instagram: {
    hosts: ["instagram.com", "cdninstagram.com"],
    rejected: new Set(["p", "reel", "reels", "stories", "explore", "accounts"]),
  },
  youtube: {
    hosts: ["youtube.com", "youtu.be"],
    rejected: new Set(["watch", "shorts", "playlist", "results", "feed"]),
  },
  linkedin: {
    hosts: ["linkedin.com"],
    rejected: new Set(["posts", "feed", "pulse", "jobs", "learning"]),
  },
  x: {
    hosts: ["x.com", "twitter.com"],
    rejected: new Set([
      "home",
      "explore",
      "search",
      "intent",
      "share",
      "status",
      "i",
    ]),
  },
  facebook: {
    hosts: ["facebook.com", "fb.com"],
    rejected: new Set([
      "posts",
      "reel",
      "reels",
      "watch",
      "groups",
      "events",
      "sharer",
      "share",
      "login",
    ]),
  },
  threads: {
    hosts: ["threads.com", "threads.net"],
    rejected: new Set(["search", "activity", "login", "t"]),
  },
  tiktok: {
    hosts: ["tiktok.com"],
    rejected: new Set(["video", "tag", "music", "discover", "login"]),
  },
  pinterest: {
    hosts: ["pinterest.com"],
    rejected: new Set(["pin", "search", "ideas", "login"]),
  },
};

const DEFAULT_TARGET_PLATFORMS = Object.keys(SOCIAL_PLATFORMS);
const ALLOWED_SEARCH_DOMAINS = [
  "instagram.com",
  "youtube.com",
  "linkedin.com",
  "x.com",
  "twitter.com",
  "facebook.com",
  "threads.com",
  "threads.net",
  "tiktok.com",
  "pinterest.com",
];

const SOCIAL_URL_PATTERN =
  /(?:https?:\/\/)?(?:www\.|m\.)?(?:instagram\.com|youtube\.com|youtu\.be|linkedin\.com|x\.com|twitter\.com|facebook\.com|fb\.com|threads\.com|threads\.net|tiktok\.com|pinterest\.com)\/[^\s"'<>\])}]+/gi;

function envBoolean(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeHandle(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function cleanHandleForComparison(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}


function hostnameMatches(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function platformFromHostname(hostname = "") {
  const host = String(hostname).toLowerCase();
  return Object.entries(SOCIAL_PLATFORMS).find(([, configValue]) =>
    configValue.hosts.some((domain) => hostnameMatches(host, domain)),
  )?.[0] || "";
}

function stripUrlPunctuation(value = "") {
  return String(value).replace(/[.,;:!?]+$/g, "");
}

export function canonicalizeSocialProfileUrl(value) {
  const raw = stripUrlPunctuation(String(value || "").trim());
  if (!raw) return null;

  let parsed;
  try {
    parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) return null;
  const platform = platformFromHostname(parsed.hostname);
  if (!platform) return null;

  const segments = parsed.pathname
    .split("/")
    .map((segment) => decodeURIComponent(segment).trim())
    .filter(Boolean);
  const first = String(segments[0] || "").replace(/^@/, "");
  const platformConfig = SOCIAL_PLATFORMS[platform];

  if (platform === "youtube") {
    const firstRaw = String(segments[0] || "");
    const isValidChannelPath =
      firstRaw.startsWith("@") ||
      ["channel", "c", "user"].includes(firstRaw.toLowerCase());
    if (!isValidChannelPath || platformConfig.rejected.has(firstRaw.toLowerCase())) {
      return null;
    }
    if (["channel", "c", "user"].includes(firstRaw.toLowerCase()) && !segments[1]) {
      return null;
    }
  } else if (platform === "linkedin") {
    if (!["in", "company", "school", "showcase"].includes(first.toLowerCase())) {
      return null;
    }
    if (!segments[1]) return null;
  } else if (platform === "facebook" && parsed.pathname.toLowerCase() === "/profile.php") {
    if (!parsed.searchParams.get("id")) return null;
  } else {
    if (!first || platformConfig.rejected.has(first.toLowerCase())) return null;
    if (segments.some((segment) => platformConfig.rejected.has(segment.toLowerCase()))) {
      return null;
    }
  }

  if (platform === "x") parsed.hostname = "x.com";
  if (platform === "threads") parsed.hostname = "www.threads.com";
  if (platform === "instagram") parsed.hostname = "www.instagram.com";
  if (platform === "youtube") parsed.hostname = "www.youtube.com";
  if (platform === "linkedin") parsed.hostname = "www.linkedin.com";
  if (platform === "facebook") parsed.hostname = "www.facebook.com";
  if (platform === "tiktok") parsed.hostname = "www.tiktok.com";
  if (platform === "pinterest") parsed.hostname = "www.pinterest.com";

  parsed.protocol = "https:";
  parsed.hash = "";
  if (!(platform === "facebook" && parsed.pathname.toLowerCase() === "/profile.php")) {
    parsed.search = "";
  }
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/`;

  const username = (() => {
    if (platform === "youtube") {
      if (segments[0]?.startsWith("@")) return normalizeHandle(segments[0]);
      return normalizeHandle(segments[1]);
    }
    if (platform === "linkedin") return normalizeHandle(segments[1]);
    if (platform === "facebook" && parsed.pathname.toLowerCase() === "/profile.php/") {
      return parsed.searchParams.get("id") || "";
    }
    return normalizeHandle(segments[0]);
  })();

  return {
    platform,
    url: parsed.toString(),
    username,
  };
}

function collectStrings(value, output = [], depth = 0, visited = new Set()) {
  if (output.length >= 350 || depth > 5 || value === null || value === undefined) {
    return output;
  }
  if (typeof value === "string") {
    output.push(value);
    return output;
  }
  if (typeof value !== "object" || visited.has(value)) return output;
  visited.add(value);

  if (Array.isArray(value)) {
    value.slice(0, 75).forEach((item) =>
      collectStrings(item, output, depth + 1, visited),
    );
    return output;
  }

  Object.entries(value)
    .slice(0, 100)
    .forEach(([key, item]) => {
      if (/password|token|secret|cookie|authorization/i.test(key)) return;
      collectStrings(item, output, depth + 1, visited);
    });
  return output;
}

function dedupeProfiles(profiles = []) {
  const byPlatformAndUrl = new Map();
  for (const profile of profiles) {
    if (!profile?.platform || !profile?.url) continue;
    const key = `${profile.platform}:${profile.url.toLowerCase()}`;
    const existing = byPlatformAndUrl.get(key);
    if (!existing || Number(profile.confidence || 0) > Number(existing.confidence || 0)) {
      byPlatformAndUrl.set(key, profile);
    }
  }
  return [...byPlatformAndUrl.values()];
}

export function extractEmbeddedSocialLinks({
  sourceUrl,
  sourcePlatform,
  profile = {},
  rawProfile = {},
}) {
  const sourceCanonical = canonicalizeSocialProfileUrl(sourceUrl);
  const strings = collectStrings([profile, rawProfile]);
  const found = [];

  for (const text of strings) {
    const matches = String(text).match(SOCIAL_URL_PATTERN) || [];
    for (const match of matches) {
      const normalized = canonicalizeSocialProfileUrl(match);
      if (!normalized || normalized.platform === sourcePlatform) continue;
      if (sourceCanonical?.url === normalized.url) continue;
      found.push({
        ...normalized,
        displayName: "",
        confidence: 1,
        verificationStatus: "confirmed",
        source: "source_profile",
        evidenceUrl: sourceUrl,
        evidenceType: "linked_from_source_profile",
        discoveredAt: new Date(),
      });
    }
  }

  return dedupeProfiles(found);
}

function buildDiscoveryPrompt({
  sourceUrl,
  sourcePlatform,
  profile,
  embeddedLinks,
  missingPlatforms,
}) {
  return `You are resolving official social profiles belonging to one public identity.

SOURCE PROFILE
Platform: ${sourcePlatform}
URL: ${sourceUrl}
Handle: ${profile.username || ""}
Display name: ${profile.fullName || profile.name || profile.title || ""}
Bio: ${String(profile.bio || profile.biography || "").slice(0, 2500)}
Country/location: ${profile.location || profile.country || ""}
Verified: ${Boolean(profile.verified || profile.isVerified)}
Website: ${profile.website || profile.externalUrl || ""}
Links already found: ${JSON.stringify(embeddedLinks)}

SEARCH ONLY THESE MISSING PLATFORMS
${missingPlatforms.join(", ")}

RULES
1. Find accounts belonging to the exact same person, creator, company, or brand.
2. Use links published by the source profile or an official website as strongest evidence.
3. Use live web search only for the missing platforms above.
4. Never construct or guess a URL just because the same username may exist.
5. Every returned profile must have an evidenceUrl that supports the identity match.
6. Return profile/channel pages only. Reject posts, reels, videos, shorts, status URLs, search pages, login pages, and share URLs.
7. If identity cannot be verified, omit the profile.
8. Do not return the original source profile as a newly discovered profile.
9. Finish by calling return_social_profiles. Do not provide a normal prose answer.`;
}

const resultTool = {
  name: "return_social_profiles",
  description: "Return evidence-backed social profiles for the same identity.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      profiles: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            platform: { type: "string" },
            url: { type: "string" },
            username: { type: "string" },
            displayName: { type: "string" },
            evidenceUrl: { type: "string" },
            evidenceType: { type: "string" },
            modelConfidence: { type: "number" },
          },
          required: [
            "platform",
            "url",
            "username",
            "displayName",
            "evidenceUrl",
            "evidenceType",
            "modelConfidence",
          ],
        },
      },
      missingPlatforms: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["profiles", "missingPlatforms"],
  },
};

async function discoverWithClaude({
  sourceUrl,
  sourcePlatform,
  profile,
  embeddedLinks,
  missingPlatforms,
}) {
  if (!config.ANTHROPIC_API_KEY || !envBoolean("CLAUDE_SOCIAL_DISCOVERY_ENABLED", true)) {
    return {
      status: "not_configured",
      profiles: [],
      searches: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  const model =
    process.env.CLAUDE_SOCIAL_DISCOVERY_MODEL ||
    "claude-haiku-4-5-20251001";
  const maxSearches = Math.max(
    1,
    Math.min(5, Number(process.env.CLAUDE_SOCIAL_DISCOVERY_MAX_SEARCHES || 2)),
  );
  const tools = [
    {
      type: "web_search_20250305",
      name: "web_search",
      max_uses: maxSearches,
      allowed_domains: ALLOWED_SEARCH_DOMAINS,
    },
    resultTool,
  ];
  const messages = [
    {
      role: "user",
      content: buildDiscoveryPrompt({
        sourceUrl,
        sourcePlatform,
        profile,
        embeddedLinks,
        missingPlatforms,
      }),
    },
  ];
  let searches = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (let turn = 0; turn < 3; turn += 1) {
    const response = await client.messages.create({
      model,
      max_tokens: 1800,
      temperature: 0,
      tools,
      messages,
    });
    searches += Number(response.usage?.server_tool_use?.web_search_requests || 0);
    inputTokens += Number(response.usage?.input_tokens || 0);
    outputTokens += Number(response.usage?.output_tokens || 0);

    const resultBlock = response.content?.find(
      (block) => block.type === "tool_use" && block.name === resultTool.name,
    );
    if (resultBlock?.input) {
      return {
        status: "available",
        profiles: Array.isArray(resultBlock.input.profiles)
          ? resultBlock.input.profiles
          : [],
        missingPlatforms: resultBlock.input.missingPlatforms || [],
        searches,
        inputTokens,
        outputTokens,
        model,
      };
    }

    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }
    break;
  }

  return {
    status: "empty",
    profiles: [],
    searches,
    inputTokens,
    outputTokens,
    model,
  };
}

function nameSimilarity(left, right) {
  const leftTokens = new Set(normalizeText(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalizeText(right).split(" ").filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

async function probeSocialUrl(url) {
  if (!envBoolean("SOCIAL_LINK_DISCOVERY_HTTP_PROBE", true)) {
    return { reachable: true, finalUrl: url, status: 0 };
  }
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(
        Number(process.env.SOCIAL_LINK_DISCOVERY_PROBE_TIMEOUT_MS || 7000),
      ),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    return {
      reachable:
        response.status < 400 || [401, 403, 405, 429].includes(response.status),
      finalUrl: response.url || url,
      status: response.status,
    };
  } catch {
    return { reachable: false, finalUrl: url, status: 0 };
  }
}

async function validateCandidate(candidate, identity, sourceType) {
  const normalized = canonicalizeSocialProfileUrl(
    candidate.profile_url || candidate.url,
  );
  if (!normalized || normalized.platform === identity.sourcePlatform) return null;

  const probe = await probeSocialUrl(normalized.url);
  const finalNormalized = canonicalizeSocialProfileUrl(probe.finalUrl) || normalized;
  const sourceHandle = cleanHandleForComparison(identity.username);
  const candidateHandle = cleanHandleForComparison(
    candidate.username || finalNormalized.username,
  );
  const exactHandle = Boolean(sourceHandle && candidateHandle === sourceHandle);
  const softHandleMatch = Boolean(
    sourceHandle &&
    candidateHandle &&
    (sourceHandle.startsWith(candidateHandle) ||
      candidateHandle.startsWith(sourceHandle))
  );
  const displaySimilarity = nameSimilarity(
    identity.displayName,
    candidate.displayName || candidate.display_name,
  );
  const evidenceUrl = String(candidate.evidenceUrl || candidate.evidence_url || "");
  const evidenceIsSource = Boolean(
    evidenceUrl &&
      canonicalizeSocialProfileUrl(evidenceUrl)?.url ===
        canonicalizeSocialProfileUrl(identity.sourceUrl)?.url,
  );

  let confidence = 0.35;
  if (probe.reachable) confidence += 0.1;
  if (exactHandle) {
    confidence += 0.35;
  } else if (softHandleMatch && displaySimilarity >= 0.85) {
    confidence += 0.25;
  }
  confidence += Math.min(0.15, displaySimilarity * 0.15);
  if (evidenceIsSource) confidence += 0.15;
  if (String(candidate.match_confidence || "").toLowerCase() === "high") {
    confidence += 0.05;
  }
  confidence = Math.min(1, Number(confidence.toFixed(2)));
  const strongIdentityEvidence =
    evidenceIsSource ||
    (exactHandle && displaySimilarity >= 0.5) ||
    (softHandleMatch && displaySimilarity >= 0.85);

  const verificationStatus =
    evidenceIsSource && confidence >= 0.85
      ? "confirmed"
      : (probe.reachable || confidence >= 0.8) && confidence >= 0.75 && strongIdentityEvidence
        ? "probable"
        : "unverified";

  return {
    ...finalNormalized,
    displayName: String(candidate.displayName || candidate.display_name || ""),
    confidence,
    verificationStatus,
    source: sourceType,
    evidenceUrl,
    evidenceType: String(
      candidate.evidenceType || candidate.source || sourceType,
    ),
    actorRunId: String(candidate.actorRunId || ""),
    discoveredAt: new Date(),
  };
}

async function validateCandidates(candidates, identity, sourceType) {
  const limited = (Array.isArray(candidates) ? candidates : []).slice(0, 20);
  const results = await Promise.all(
    limited.map((candidate) => validateCandidate(candidate, identity, sourceType)),
  );
  return dedupeProfiles(
    results.filter(
      (profile) =>
        profile && ["confirmed", "probable"].includes(profile.verificationStatus),
    ),
  );
}

async function discoverWithApify({ identity, missingPlatforms }) {
  const token = process.env.APIFY_TOKEN;
  if (!token || !envBoolean("APIFY_SOCIAL_FINDER_ENABLED", true)) {
    return { status: "not_configured", profiles: [], usageUsd: 0 };
  }

  const supportedPlatforms = missingPlatforms
    .map((platform) => (platform === "x" ? "twitter" : platform))
    .filter((platform) => platform !== "threads");
  if (!supportedPlatforms.length) {
    return { status: "not_needed", profiles: [], usageUsd: 0 };
  }

  const actorId = String(
    process.env.APIFY_SOCIAL_FINDER_ACTOR_ID || "bovi/social-media-finder",
  )
    .trim()
    .replace(/\//g, "~");
  const timeoutSeconds = Number(
    process.env.APIFY_SOCIAL_FINDER_TIMEOUT_SECONDS || 90,
  );
  const maxItems = Math.max(
    1,
    Math.min(50, Number(process.env.APIFY_SOCIAL_FINDER_MAX_RESULTS || 15)),
  );
  const maxTotalChargeUsd = Number(
    process.env.APIFY_SOCIAL_FINDER_MAX_CHARGE_USD || 0.1,
  );
  const endpoint = `https://api.apify.com/v2/actors/${encodeURIComponent(actorId)}/run-sync-get-dataset-items`;
  const query = normalizeHandle(identity.username) || identity.displayName;

  const result = await executeApifyRun({
    endpoint,
    token,
    input: {
      query,
      platforms: supportedPlatforms,
      maxResults: maxItems,
      useSerpFallback: true,
      proxyConfiguration: {
        useApifyProxy: true,
        apifyProxyGroups: ["RESIDENTIAL"],
      },
    },
    runTimeoutMs: (timeoutSeconds + 30) * 1000,
    params: {
      format: "json",
      clean: true,
      timeout: timeoutSeconds,
      maxItems,
      ...(maxTotalChargeUsd ? { maxTotalChargeUsd } : {}),
    },
  });

  return {
    status: "available",
    profiles: (result.data || []).map((item) => ({
      ...item,
      actorRunId: result.runId,
    })),
    runId: result.runId,
    usageUsd: Number(result.usageTotalUsd || 0),
  };
}

function isFreshDiscovery(discovery, cacheDays) {
  const fetchedAt = new Date(discovery?.fetchedAt || 0).getTime();
  return fetchedAt > 0 && Date.now() - fetchedAt < cacheDays * 86400000;
}

export async function discoverCrossPlatformProfiles({
  sourceUrl,
  sourcePlatform,
  profile = {},
  rawProfile = {},
  cachedProfile = null,
}) {
  const cacheDays = Math.max(
    1,
    Number(process.env.SOCIAL_LINK_DISCOVERY_CACHE_DAYS || 30),
  );
  if (
    cachedProfile?.socialLinks?.length &&
    isFreshDiscovery(cachedProfile.socialLinkDiscovery, cacheDays)
  ) {
    return {
      socialLinks: cachedProfile.socialLinks,
      discovery: cachedProfile.socialLinkDiscovery,
      cacheHit: true,
    };
  }

  const embeddedLinks = extractEmbeddedSocialLinks({
    sourceUrl,
    sourcePlatform,
    profile,
    rawProfile,
  });
  const discoveredPlatforms = new Set(embeddedLinks.map((item) => item.platform));
  const missingPlatforms = DEFAULT_TARGET_PLATFORMS.filter(
    (platform) => platform !== sourcePlatform && !discoveredPlatforms.has(platform),
  );
  const identity = {
    sourceUrl,
    sourcePlatform,
    username: profile.username || "",
    displayName: profile.fullName || profile.name || profile.title || "",
  };

  let claudeResult = { status: "not_needed", profiles: [], searches: 0 };
  let claudeProfiles = [];
  if (missingPlatforms.length) {
    try {
      claudeResult = await discoverWithClaude({
        sourceUrl,
        sourcePlatform,
        profile,
        embeddedLinks,
        missingPlatforms,
      });
      claudeProfiles = await validateCandidates(
        claudeResult.profiles,
        identity,
        "claude_web_search",
      );
    } catch (error) {
      claudeResult = {
        status: "failed",
        profiles: [],
        searches: 0,
        error: error.message,
      };
    }
  }

  const afterClaude = dedupeProfiles([...embeddedLinks, ...claudeProfiles]);
  const afterClaudePlatforms = new Set(afterClaude.map((item) => item.platform));
  const stillMissing = DEFAULT_TARGET_PLATFORMS.filter(
    (platform) => platform !== sourcePlatform && !afterClaudePlatforms.has(platform),
  );

  let apifyResult = { status: "not_needed", profiles: [], usageUsd: 0 };
  let apifyProfiles = [];
  // Cost-saving fallback: use Apify only if Claude found no validated new link.
  if (missingPlatforms.length && claudeProfiles.length === 0 && stillMissing.length) {
    try {
      apifyResult = await discoverWithApify({ identity, missingPlatforms: stillMissing });
      apifyProfiles = await validateCandidates(
        apifyResult.profiles,
        identity,
        "apify_social_finder",
      );
    } catch (error) {
      apifyResult = {
        status: "failed",
        profiles: [],
        usageUsd: 0,
        error: error.message,
      };
    }
  }

  const socialLinks = dedupeProfiles([
    ...embeddedLinks,
    ...claudeProfiles,
    ...apifyProfiles,
  ]).filter((item) => item.platform !== sourcePlatform);
  const method = [
    embeddedLinks.length ? "embedded" : "",
    claudeProfiles.length ? "claude" : "",
    apifyProfiles.length ? "apify" : "",
  ]
    .filter(Boolean)
    .join("+") || "none";

  return {
    socialLinks,
    discovery: {
      method,
      status: socialLinks.length ? "available" : "empty",
      claudeModel: claudeResult.model || "",
      claudeSearches: Number(claudeResult.searches || 0),
      claudeInputTokens: Number(claudeResult.inputTokens || 0),
      claudeOutputTokens: Number(claudeResult.outputTokens || 0),
      claudeStatus: claudeResult.status,
      apifyRunId: apifyResult.runId || "",
      apifyUsageUsd: Number(apifyResult.usageUsd || 0),
      apifyStatus: apifyResult.status,
      fetchedAt: new Date(),
    },
    cacheHit: false,
  };
}
