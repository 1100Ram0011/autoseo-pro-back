import mongoose from "mongoose";

function canonicalUrl(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}

function objectIdKey(value) {
  if (!value) return "";
  if (value instanceof mongoose.Types.ObjectId) return String(value);
  if (
    typeof value === "object" &&
    (value._bsontype === "ObjectId" || value.constructor?.name === "ObjectId")
  ) {
    return String(value);
  }
  if (typeof value === "string" && /^[a-f\d]{24}$/i.test(value)) {
    return value;
  }
  return "";
}

function buildPostIndexes(posts = []) {
  const byMongoId = new Map();
  const byExternalId = new Map();
  const byUrl = new Map();

  for (const post of posts) {
    if (!post) continue;
    const mongoId = objectIdKey(post._id);
    if (mongoId) byMongoId.set(mongoId, post);

    const externalIds = [
      post.postId,
      post.id,
      post.raw?.id,
      post.raw?.pk,
      post.raw?.shortCode,
      post.raw?.shortcode,
    ];
    for (const id of externalIds) {
      if (id !== undefined && id !== null && String(id).trim()) {
        byExternalId.set(String(id).trim(), post);
      }
    }

    const urls = [post.postUrl, post.url, post.raw?.url, post.raw?.postUrl];
    for (const url of urls) {
      const key = canonicalUrl(url);
      if (key) byUrl.set(key, post);
    }
  }

  return { byMongoId, byExternalId, byUrl };
}

function findEvidencePost(evidence, indexes) {
  const mongoId = objectIdKey(evidence);
  if (mongoId && indexes.byMongoId.has(mongoId)) {
    return indexes.byMongoId.get(mongoId);
  }
  if (!evidence || typeof evidence !== "object") return null;

  const evidenceMongoId = objectIdKey(evidence._id);
  if (evidenceMongoId && indexes.byMongoId.has(evidenceMongoId)) {
    return indexes.byMongoId.get(evidenceMongoId);
  }

  const externalId = String(evidence.postId || evidence.id || "").trim();
  if (externalId && indexes.byExternalId.has(externalId)) {
    return indexes.byExternalId.get(externalId);
  }

  const urlKey = canonicalUrl(evidence.postUrl || evidence.url);
  return urlKey ? indexes.byUrl.get(urlKey) || null : null;
}

export function withoutEmbeddedEvidence(partnerships = []) {
  return (Array.isArray(partnerships) ? partnerships : []).map(
    (partnership) => ({
      ...partnership,
      evidencePosts: [],
      postCount: 0,
    }),
  );
}

export function referenceBrandPartnershipEvidence(partnerships = [], posts = []) {
  const indexes = buildPostIndexes(posts);

  return (Array.isArray(partnerships) ? partnerships : []).map(
    (partnership) => {
      const evidenceRefs = [];
      const seen = new Set();

      for (const evidence of partnership?.evidencePosts || []) {
        const post = findEvidencePost(evidence, indexes);
        const postObjectId = post?._id;
        const key = objectIdKey(postObjectId);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        evidenceRefs.push(postObjectId);
      }

      return {
        ...partnership,
        evidencePosts: evidenceRefs,
        postCount: evidenceRefs.length,
      };
    },
  );
}

function rawArray(raw, keys) {
  for (const key of keys) {
    const value = raw?.[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") return [value];
  }
  return [];
}

function postForEvidenceApi(post = {}, partnership = {}) {
  const raw = post.raw || {};
  return {
    postId: String(post.postId || raw.id || raw.pk || ""),
    postUrl: post.postUrl || raw.url || raw.postUrl || "",
    ownerHandle:
      raw.ownerHandle ||
      raw.ownerUsername ||
      raw.owner_username ||
      raw.authorUsername ||
      raw.author?.username ||
      raw.owner?.username ||
      "",
    ownerName:
      raw.ownerName ||
      raw.ownerFullName ||
      raw.owner_full_name ||
      raw.authorName ||
      raw.author?.name ||
      raw.owner?.full_name ||
      "",
    ownerAvatar:
      raw.ownerAvatar ||
      raw.ownerProfilePicUrl ||
      raw.owner_profile_pic_url ||
      raw.owner?.profile_pic_url ||
      raw.author?.profile_pic_url ||
      "",
    paidPartnership: Boolean(
      raw.paidPartnership ||
        raw.isPaidPartnership ||
        raw.is_paid_partnership ||
        raw.isSponsored ||
        raw.isSponsoredPost ||
        raw.hasPaidPromotion ||
        raw.isBrandedContent
    ),
    coauthors: rawArray(raw, [
      "coauthorProducers",
      "coauthor_producers",
      "coAuthors",
      "coauthors",
      "partners",
    ]),
    taggedUsers: rawArray(raw, ["taggedUsers", "tagged_users", "taggedUser"]),
    sponsorTags: rawArray(raw, [
      "sponsorTags",
      "sponsor_tags",
      "brandedContentSponsors",
      "brandPartners",
      "sponsors",
      "sponsor",
    ]),
    caption: post.text || raw.caption || raw.captionText || "",
    publishedAt: post.publishedAt || raw.timestamp || raw.takenAt || null,
    metrics: post.metrics || {},
    thumbnail: post.thumbnail || raw.displayUrl || raw.thumbnailUrl || "",
    source: partnership.source || "",
  };
}

export function hydrateBrandPartnershipEvidence(partnerships = [], posts = []) {
  const indexes = buildPostIndexes(posts);

  return (Array.isArray(partnerships) ? partnerships : []).map(
    (partnership) => {
      const evidencePosts = [];
      const seen = new Set();

      for (const evidence of partnership?.evidencePosts || []) {
        const post = findEvidencePost(evidence, indexes);
        if (post) {
          const key = objectIdKey(post._id) || String(post.postId || post.postUrl);
          if (seen.has(key)) continue;
          seen.add(key);
          evidencePosts.push(postForEvidenceApi(post, partnership));
          continue;
        }

        // Existing records may still contain the legacy embedded evidence
        // object until they are re-analysed or migrated.
        if (evidence && typeof evidence === "object") {
          const key = String(evidence.postId || evidence.postUrl || "");
          if (key && !seen.has(key)) {
            seen.add(key);
            evidencePosts.push(evidence);
          }
        }
      }

      return {
        ...partnership,
        evidencePosts,
        postCount: evidencePosts.length,
      };
    },
  );
}
