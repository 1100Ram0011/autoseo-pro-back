import crypto from "crypto";
import SocialAudienceMember from "../models/SocialAudienceMember.js";

const FOLLOWER_PLATFORMS = new Set([
  "facebook",
  "instagram",
  "linkedin",
  "twitter",
  "x",
  "threads",
  "tiktok",
  "pinterest",
]);

export function audienceTypeForPlatform(platform = "") {
  const normalizedPlatform = String(platform || "").toLowerCase();
  if (normalizedPlatform === "youtube") return "subscriber";
  if (FOLLOWER_PLATFORMS.has(normalizedPlatform)) return "follower";
  return "member";
}

function firstArrayWithItems(values = []) {
  return values.find((value) => Array.isArray(value) && value.length > 0) || [];
}

export function selectPublicAudienceMembers(publicData = {}, platform = "") {
  const normalizedPlatform = String(platform || "").toLowerCase();
  const common = [
    publicData.publicAudienceMembers,
    publicData.audienceMembers,
  ];

  if (normalizedPlatform === "youtube") {
    return firstArrayWithItems([
      ...common,
      publicData.publicSubscribers,
      publicData.subscribers,
      publicData.audience?.subscribers,
      publicData.publicFollowers,
    ]);
  }

  if (normalizedPlatform === "instagram") {
    // Follower-scraper identities belong to the audience sample. Instagram
    // detail recommendations are exposed separately as similarProfiles and
    // must never be treated as followers.
    return firstArrayWithItems([
      ...common,
      publicData.publicFollowers,
      publicData.followers,
    ]);
  }

  return firstArrayWithItems([
    ...common,
    publicData.publicFollowers,
    publicData.followers,
  ]);
}

function optionalNumber(values = []) {
  const value = values.find(
    (candidate) =>
      candidate !== undefined &&
      candidate !== null &&
      candidate !== "" &&
      Number.isFinite(Number(candidate)),
  );
  return value === undefined ? null : Number(value);
}

function stringValue(...values) {
  const value = values.find(
    (candidate) =>
      candidate !== undefined &&
      candidate !== null &&
      String(candidate).trim(),
  );
  return value === undefined ? "" : String(value).trim();
}

function buildProfileUrl(platform, username, explicitUrl) {
  if (explicitUrl) return explicitUrl;
  const cleanUsername = String(username || "").replace(/^@+/, "");
  if (!cleanUsername) return "";
  const roots = {
    facebook: "https://www.facebook.com/",
    instagram: "https://www.instagram.com/",
    linkedin: "https://www.linkedin.com/in/",
    youtube: "https://www.youtube.com/@",
    twitter: "https://x.com/",
    x: "https://x.com/",
    threads: "https://www.threads.net/@",
    tiktok: "https://www.tiktok.com/@",
    pinterest: "https://www.pinterest.com/",
  };
  return roots[platform] ? `${roots[platform]}${cleanUsername}` : "";
}

export function normalizeAudienceMembers(
  members = [],
  { platform, audienceType, source = "", limit = 250 } = {},
) {
  const normalizedPlatform = String(platform || "unknown").toLowerCase();
  const normalizedAudienceType =
    audienceType || audienceTypeForPlatform(normalizedPlatform);
  const seen = new Set();

  return (Array.isArray(members) ? members : [])
    .map((member) => {
      if (!member || typeof member !== "object") return null;
      const externalId = stringValue(
        member.externalId,
        member.external_id,
        member.profileId,
        member.profile_id,
        member.channelId,
        member.channel_id,
        member.id,
      );
      const username = stringValue(
        member.username,
        member.userName,
        member.handle,
        member.channelHandle,
        member.authorUsername,
      ).replace(/^@+/, "");
      const displayName = stringValue(
        member.displayName,
        member.fullName,
        member.full_name,
        member.name,
        member.title,
        username,
      );
      const explicitProfileUrl = stringValue(
        member.profileUrl,
        member.profile_url,
        member.url,
        member.channelUrl,
        member.facebookUrl,
        member.linkedinUrl,
      );
      const profileUrl = buildProfileUrl(
        normalizedPlatform,
        username,
        explicitProfileUrl,
      );
      const identitySource = stringValue(
        externalId && `id:${externalId}`,
        username && `username:${username.toLowerCase()}`,
        profileUrl && `url:${profileUrl.toLowerCase()}`,
        displayName && `name:${displayName.toLowerCase()}`,
      );
      if (!identitySource) return null;
      const identityKey = crypto
        .createHash("sha256")
        .update(`${normalizedPlatform}:${normalizedAudienceType}:${identitySource}`)
        .digest("hex");
      if (seen.has(identityKey)) return null;
      seen.add(identityKey);

      return {
        platform: normalizedPlatform,
        audienceType: normalizedAudienceType,
        identityKey,
        externalId,
        username,
        displayName,
        avatarUrl: stringValue(
          member.avatarUrl,
          member.profilePicUrl,
          member.profile_pic_url,
          member.profilePicUrlHD,
          member.profile_pic_url_hd,
          member.avatar,
          member.image,
          member.thumbnail,
        ),
        profileUrl,
        followersCount: optionalNumber([
          member.followersCount,
          member.followerCount,
          member.follower_count,
          member.followers_count,
          member.followers,
          member.edge_followed_by?.count,
          normalizedAudienceType === "subscriber" ? member.subscriberCount : null,
          normalizedAudienceType === "subscriber" ? member.subscribers : null,
        ]),
        followingCount: optionalNumber([
          member.followingCount,
          member.following_count,
          member.followsCount,
          member.following,
        ]),
        postsCount: optionalNumber([
          member.postsCount,
          member.posts_count,
          member.mediaCount,
          member.media_count,
          member.videoCount,
        ]),
        engagementCount: optionalNumber([
          member.engagementCount,
          member.engagements,
          member.engagement,
          member.avgEngagements,
        ]),
        commentCount: optionalNumber([
          member.commentCount,
          member.commentsCount,
          member.comments,
        ]),
        likeCount: optionalNumber([
          member.likeCount,
          member.likesCount,
          member.likes,
        ]),
        isVerified: Boolean(member.isVerified || member.is_verified || member.verified),
        isPrivate: Boolean(member.isPrivate || member.is_private || member.private),
        isBusiness: Boolean(member.isBusiness || member.is_business || member.isBusinessAccount),
        category: stringValue(member.category, member.categoryName),
        biography: stringValue(member.biography, member.bio, member.description).slice(0, 1000),
        country: stringValue(member.country, member.location?.country),
        city: stringValue(member.city, member.location?.city),
        source: stringValue(member.source, source),
        collectedAt: new Date(),
      };
    })
    .filter(Boolean)
    .slice(0, Math.max(0, Number(limit) || 0));
}

export async function replaceAudienceMembers({
  profileId,
  userId,
  platform,
  members,
  audienceType,
  source,
  limit = 250,
}) {
  const normalizedMembers = normalizeAudienceMembers(members, {
    platform,
    audienceType,
    source,
    limit,
  });
  if (!profileId || !userId || normalizedMembers.length === 0) {
    return { savedCount: 0, audienceType: audienceTypeForPlatform(platform) };
  }

  const resolvedAudienceType =
    audienceType || audienceTypeForPlatform(platform);
  const operations = normalizedMembers.map((member) => ({
    updateOne: {
      filter: {
        profileId,
        audienceType: resolvedAudienceType,
        identityKey: member.identityKey,
      },
      update: {
        $set: {
          ...member,
          profileId,
          userId,
        },
      },
      upsert: true,
    },
  }));

  await SocialAudienceMember.bulkWrite(operations, { ordered: false });
  await SocialAudienceMember.deleteMany({
    profileId,
    audienceType: resolvedAudienceType,
    identityKey: { $nin: normalizedMembers.map((member) => member.identityKey) },
  });

  return {
    savedCount: normalizedMembers.length,
    audienceType: resolvedAudienceType,
  };
}

export function audienceMemberForApi(member = {}) {
  const value = member?.toObject ? member.toObject() : member;
  return {
    id: value.externalId || "",
    externalId: value.externalId || "",
    username: value.username || "",
    fullName: value.displayName || value.username || "",
    displayName: value.displayName || value.username || "",
    profilePicUrl: value.avatarUrl || "",
    avatarUrl: value.avatarUrl || "",
    profileUrl: value.profileUrl || "",
    followersCount:
      value.followersCount === undefined ? null : value.followersCount,
    followingCount:
      value.followingCount === undefined ? null : value.followingCount,
    postsCount: value.postsCount === undefined ? null : value.postsCount,
    engagements:
      value.engagementCount === undefined ? null : value.engagementCount,
    commentCount: value.commentCount === undefined ? null : value.commentCount,
    likeCount: value.likeCount === undefined ? null : value.likeCount,
    isVerified: Boolean(value.isVerified),
    isPrivate: Boolean(value.isPrivate),
    isBusiness: Boolean(value.isBusiness),
    category: value.category || "",
    biography: value.biography || "",
    country: value.country || "",
    city: value.city || "",
    source: value.source || "",
    audienceType: value.audienceType || audienceTypeForPlatform(value.platform),
    collectedAt: value.collectedAt || value.updatedAt || null,
  };
}
