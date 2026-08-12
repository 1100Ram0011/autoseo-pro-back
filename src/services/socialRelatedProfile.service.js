import SocialRelatedProfile from "../models/SocialRelatedProfile.js";

function finiteNumberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeRelatedProfile(profile = {}, platform = "instagram") {
  const username = String(
    profile.username || profile.handle || profile.userName || "",
  )
    .trim()
    .replace(/^@+/, "");
  const externalId = String(
    profile.externalId || profile.id || profile.pk || "",
  ).trim();
  const identityKey = (username || externalId).toLowerCase();
  if (!identityKey) return null;

  return {
    identityKey,
    externalId,
    username,
    displayName: String(
      profile.displayName ||
        profile.fullName ||
        profile.full_name ||
        profile.name ||
        username,
    ).trim(),
    headline: String(
      profile.headline || profile.position || profile.description || "",
    ).trim(),
    avatarUrl: String(
      profile.avatarUrl ||
        profile.profilePicUrlHD ||
        profile.profilePicUrl ||
        profile.profile_pic_url_hd ||
        profile.profile_pic_url ||
        profile.profilePicture?.url ||
        profile.profilePicture?.sizes?.[0]?.url ||
        profile.photo?.url ||
        profile.photo ||
        profile.avatar ||
        profile.avatar?.url ||
        "",
    ),
    profileUrl: String(
      profile.profileUrl ||
        profile.linkedinUrl ||
        profile.url ||
        (username
          ? platform === "linkedin"
            ? `https://www.linkedin.com/in/${username}/`
            : `https://www.instagram.com/${username}/`
          : ""),
    ),
    followersCount: finiteNumberOrNull(
      profile.followersCount ??
        profile.follower_count ??
        profile.followers,
    ),
    isVerified: Boolean(
      profile.isVerified ?? profile.is_verified ?? profile.verified,
    ),
    isPrivate: Boolean(
      profile.isPrivate ?? profile.is_private ?? profile.private,
    ),
  };
}

export async function replaceRelatedProfiles({
  targetProfileId,
  userId,
  platform = "instagram",
  profiles = [],
  source = "public-profile-details",
}) {
  const normalizedByKey = new Map();
  profiles.forEach((profile) => {
    const normalized = normalizeRelatedProfile(profile, platform);
    if (normalized) normalizedByKey.set(normalized.identityKey, normalized);
  });

  const normalized = [...normalizedByKey.values()];
  // A missing/failed provider section must not erase the last valid result.
  if (normalized.length === 0) return [];

  const collectedAt = new Date();
  await SocialRelatedProfile.bulkWrite(
    normalized.map((profile) => ({
      updateOne: {
        filter: {
          targetProfileId,
          platform,
          identityKey: profile.identityKey,
        },
        update: {
          $set: {
            targetProfileId,
            userId,
            platform,
            ...profile,
            source,
            collectedAt,
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );

  await SocialRelatedProfile.deleteMany({
    targetProfileId,
    platform,
    identityKey: { $nin: normalized.map((profile) => profile.identityKey) },
  });

  return normalized;
}

// Kept as a named compatibility wrapper for existing Instagram callers.
export async function replaceInstagramRelatedProfiles(options) {
  return replaceRelatedProfiles({
    ...options,
    platform: "instagram",
    source: options?.source || "apify-instagram-details",
  });
}

export function relatedProfileForApi(profile = {}) {
  return {
    id: profile.externalId || profile._id || "",
    username: profile.username || "",
    handle: profile.username || "",
    fullName: profile.displayName || profile.username || "",
    name: profile.displayName || profile.username || "",
    headline: profile.headline || "",
    bio: profile.headline || "",
    profilePicUrl: profile.avatarUrl || "",
    avatar: profile.avatarUrl || "",
    url: profile.profileUrl || "",
    followersCount: profile.followersCount,
    isVerified: Boolean(profile.isVerified),
    isPrivate: Boolean(profile.isPrivate),
  };
}
