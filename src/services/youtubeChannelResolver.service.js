import { google } from "googleapis";
import config from "../config/config.js";

const normalizeId = (value) => String(value || "").trim();
const YOUTUBE_CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{20,}$/;

export const isYouTubeChannelId = (value) => YOUTUBE_CHANNEL_ID_PATTERN.test(normalizeId(value));

export const parseYouTubeIdentifier = (value = "") => {
  const raw = normalizeId(value);
  if (!raw) return { type: "empty", value: "" };
  if (isYouTubeChannelId(raw)) return { type: "channelId", value: raw };
  if (raw.startsWith("@")) return { type: "handle", value: raw };

  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const channelIndex = parts.findIndex((part) => part.toLowerCase() === "channel");
    if (channelIndex >= 0 && parts[channelIndex + 1]) {
      const channelId = parts[channelIndex + 1];
      return isYouTubeChannelId(channelId)
        ? { type: "channelId", value: channelId }
        : { type: "query", value: channelId };
    }

    const handle = parts.find((part) => part.startsWith("@"));
    if (handle) return { type: "handle", value: handle };

    const customIndex = parts.findIndex((part) => ["c", "user"].includes(part.toLowerCase()));
    if (customIndex >= 0 && parts[customIndex + 1]) {
      return { type: "query", value: parts[customIndex + 1] };
    }

    return { type: "query", value: parts.pop() || raw.replace(/^@/, "") };
  } catch {
    return { type: "query", value: raw.replace(/^@/, "") };
  }
};

const buildChannelPayload = ({ channel, input, identifier }) => {
  const snippet = channel.snippet || {};
  const channelId = channel.id;
  const handle = snippet.customUrl?.startsWith("@") ? snippet.customUrl : "";

  return {
    channelId,
    handle,
    title: snippet.title || "",
    description: snippet.description || "",
    profileUrl: `https://www.youtube.com/channel/${channelId}`,
    avatarUrl:
      snippet.thumbnails?.high?.url ||
      snippet.thumbnails?.medium?.url ||
      snippet.thumbnails?.default?.url ||
      "",
    metadata: {
      youtubeChannelId: channelId,
      youtubeHandle: handle,
      youtubeInput: input,
      youtubeIdentifierType: identifier.type,
    },
  };
};

export const resolveYouTubeChannelIdentifier = async (input) => {
  const raw = normalizeId(input);
  const identifier = parseYouTubeIdentifier(raw);

  if (identifier.type === "channelId") {
    return {
      channelId: identifier.value,
      input: raw,
      identifier,
      metadata: {
        youtubeChannelId: identifier.value,
        youtubeInput: raw,
        youtubeIdentifierType: identifier.type,
      },
    };
  }

  if (!config.YOUTUBE_API_KEY) {
    throw new Error("YOUTUBE_API_KEY is required to resolve a YouTube handle or URL to a channel ID");
  }

  const youtube = google.youtube({
    version: "v3",
    auth: config.YOUTUBE_API_KEY,
  });

  let channelRes = null;
  if (identifier.type === "handle") {
    channelRes = await youtube.channels.list({
      part: ["snippet"],
      forHandle: identifier.value,
    });
  }

  if (!channelRes?.data?.items?.length && identifier.type === "query") {
    channelRes = await youtube.channels.list({
      part: ["snippet"],
      forHandle: identifier.value.startsWith("@") ? identifier.value : `@${identifier.value}`,
    });
  }

  if (!channelRes?.data?.items?.length) {
    const searchRes = await youtube.search.list({
      part: ["snippet"],
      q: identifier.value,
      type: "channel",
      maxResults: 1,
    });
    const channelId = searchRes?.data?.items?.[0]?.snippet?.channelId;
    if (channelId) {
      channelRes = await youtube.channels.list({
        part: ["snippet"],
        id: [channelId],
      });
    }
  }

  const channel = channelRes?.data?.items?.[0];
  if (!channel?.id) {
    throw new Error(`No YouTube channel found for "${raw}"`);
  }

  return buildChannelPayload({ channel, input: raw, identifier });
};
