import axios from "axios";
import config from "../config/config.js";

export async function exchangeCodeForToken(code) {
    const res = await axios.get(
        "https://graph.facebook.com/v19.0/oauth/access_token",
        {
            params: {
                client_id: config.META_APP_ID,
                client_secret: config.META_APP_SECRET,
                redirect_uri: config.META_REDIRECT_URI,
                code,
            },
        }
    );

    return res.data.access_token;
}

export async function exchangeLongLivedToken(shortToken) {
    const res = await axios.get(
        "https://graph.facebook.com/v19.0/oauth/access_token",
        {
            params: {
                grant_type: "fb_exchange_token",
                client_id: config.META_APP_ID,
                client_secret: config.META_APP_SECRET,
                fb_exchange_token: shortToken,
            },
        }
    );

    return res.data.access_token;
}

export async function fetchUserPages(accessToken) {
    const res = await axios.get(
        "https://graph.facebook.com/v19.0/me/accounts",
        { params: { access_token: accessToken } }
    );
    return res.data.data;
}

export async function findInstagramFromPages(pages) {

    for (const page of pages) {

        const res = await axios.get(
            `https://graph.facebook.com/v19.0/${page.id}`,
            {
                params: {
                    fields: "instagram_business_account",
                    access_token: page.access_token,
                },
            }
        );

        if (res.data.instagram_business_account) {
            return {
                page,
                igId: res.data.instagram_business_account.id,
            };
        }
    }

    return null;
}

export async function findAllInstagramFromPages(pages) {
    const results = [];
    for (const page of pages) {
        try {
            const res = await axios.get(
                `https://graph.facebook.com/v19.0/${page.id}`,
                {
                    params: {
                        fields: "instagram_business_account",
                        access_token: page.access_token,
                    },
                }
            );

            if (res.data.instagram_business_account) {
                results.push({
                    page,
                    igId: res.data.instagram_business_account.id,
                });
            }
        } catch (err) {
            console.error(`Error finding instagram for page ${page.id}:`, err?.response?.data || err.message);
        }
    }
    return results;
}

export async function fetchInstagramProfile(igId, pageToken) {
    const res = await axios.get(
        `https://graph.facebook.com/v19.0/${igId}`,
        {
            params: {
                fields: "username,name,profile_picture_url,biography,followers_count,follows_count,website,media_count,media.limit(10){id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,shortcode,timestamp,like_count,comments_count,children{id,media_type,media_url}}",
                access_token: pageToken,
            },
        }
    );
    return res.data;
}

/**
 * Fetch Instagram account insights
 * Includes: impressions, reach, profile_views, follower_count, etc.
 * Requires: instagram_manage_insights or instagram_business_manage_insights
 */
export async function fetchInstagramInsights(igId, pageToken) {
    try {
        console.log(`📊 Fetching insights for IG account ${igId} using v19.0 over 30 days...`);
        
        // Calculate epoch timestamps for the last 30 days
        const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
        const nowEpoch = Math.floor(Date.now() / 1000);

        // v19.0 dual call strategy for reach & total_value metrics over 30 days
        const [res1, res2] = await Promise.allSettled([
            axios.get(
                `https://graph.facebook.com/v19.0/${igId}/insights`,
                {
                    params: {
                        metric: "reach,follower_count",
                        period: "day",
                        since: thirtyDaysAgo,
                        until: nowEpoch,
                        access_token: pageToken,
                    },
                }
            ),
            axios.get(
                `https://graph.facebook.com/v19.0/${igId}/insights`,
                {
                    params: {
                        metric: "views,profile_views,website_clicks,accounts_engaged,total_interactions",
                        period: "day",
                        metric_type: "total_value",
                        since: thirtyDaysAgo,
                        until: nowEpoch,
                        access_token: pageToken,
                    },
                }
            )
        ]);

        const rawInsights = [];
        if (res1.status === "fulfilled" && res1.value?.data?.data) {
            rawInsights.push(...res1.value.data.data);
        } else if (res1.status === "rejected") {
            console.error("❌ reach/follower_count insights fetch failed:", res1.reason?.response?.data || res1.reason?.message);
        }

        if (res2.status === "fulfilled" && res2.value?.data?.data) {
            rawInsights.push(...res2.value.data.data);
        } else if (res2.status === "rejected") {
            console.error("❌ views/profile_views/website_clicks/engagement insights fetch failed:", res2.reason?.response?.data || res2.reason?.message);
        }

        // Normalize insights so that total_value results are mapped to standard values array
        const normalizedInsights = [];
        for (const metric of rawInsights) {
            let item = { ...metric };

            // Convert total_value format to standard values format
            if (item.total_value && !item.values) {
                item.values = [
                    {
                        value: Number(item.total_value.value) || 0,
                        end_time: new Date()
                    }
                ];
            }

            normalizedInsights.push(item);

            // Also keep impressions for backward compatibility with the frontend impressions card
            if (metric.name === "views") {
                normalizedInsights.push({
                    ...item,
                    name: "impressions",
                    title: "Impressions"
                });
            }
        }

        console.log(`✅ Normalized ${normalizedInsights.length} insights successfully.`);
        return normalizedInsights;
    } catch (err) {
        console.error("❌ Error fetching insights:", err.message);
        return [];
    }
}

/**
 * Fetch Instagram media insights
 * Get detailed insights for a specific media post
 * Requires: instagram_manage_insights
 */
export async function fetchMediaInsights(mediaId, pageToken) {
    try {
        const res = await axios.get(
            `https://graph.facebook.com/v19.0/${mediaId}/insights`,
            {
                params: {
                    metric: "engagement,impressions,reach,saved,video_views,plays,total_interactions",
                    access_token: pageToken,
                },
            }
        );
        console.log("📈 MEDIA INSIGHTS:", res.data);
        return res.data.data || [];
    } catch (err) {
        console.error("❌ Error fetching media insights:", err?.response?.data?.error || err.message);
        return [];
    }
}

/**
 * Fetch comments on a media post
 * Includes comment text, author, timestamp, like count, and replies
 * Requires: instagram_manage_comments or instagram_business_manage_comments
 */
export async function fetchMediaComments(mediaId, pageToken) {
    try {
        const res = await axios.get(
            `https://graph.facebook.com/v19.0/${mediaId}/comments`,
            {
                params: {
                    fields: "id,from{id,username},text,timestamp,like_count,replies.limit(10){id,from{id,username},text,timestamp,like_count}",
                    limit: 100,
                    access_token: pageToken,
                },
            }
        );
        console.log("💬 MEDIA COMMENTS:", res.data);
        return res.data.data || [];
    } catch (err) {
        console.error("❌ Error fetching comments:", err?.response?.data?.error || err.message);
        return [];
    }
}

/**
 * Fetch follower demographics
 * Get age, gender, city, country data
 * Requires: instagram_manage_insights
 */
export async function fetchFollowerDemographics(igId, pageToken) {
    try {
        const res = await axios.get(
            `https://graph.facebook.com/v19.0/${igId}/insights`,
            {
                params: {
                    metric: "audience_city,audience_country,audience_gender_age,audience_locale",
                    period: "lifetime",
                    access_token: pageToken,
                },
            }
        );
        console.log("👥 FOLLOWER DEMOGRAPHICS:", res.data);
        return res.data.data || [];
    } catch (err) {
        console.error("❌ Error fetching demographics:", err?.response?.data?.error || err.message);
        return [];
    }
}

/**
 * Fetch all Instagram messages/conversations
 * Get DM conversations, participants, and messages
 * Requires: instagram_business_manage_messages or instagram_manage_messages
 */
export async function fetchInstagramConversations(igId, pageToken) {
    try {
        const res = await axios.get(
            `https://graph.facebook.com/v19.0/${igId}/conversations`,
            {
                params: {
                    fields: "id,participants,senders,wallpaper,former_participants,can_reply,updated_time,messages{id,from,to,subject,message,created_timestamp}",
                    limit: 50,
                    access_token: pageToken,
                },
            }
        );
        console.log("📨 INSTAGRAM CONVERSATIONS:", res.data);
        return res.data.data || [];
    } catch (err) {
        console.error("❌ Error fetching conversations:", err?.response?.data?.error || err.message);
        return [];
    }
}

/**
 * Fetch detailed media with engagement data
 * Includes captions, likes, comments count, media type, etc.
 */
export async function fetchMediaWithEngagement(igId, pageToken) {
    try {
        const res = await axios.get(
            `https://graph.facebook.com/v19.0/${igId}/media`,
            {
                params: {
                    fields: "id,caption,media_type,media_product_type,media_url,permalink,shortcode,timestamp,like_count,comments_count,ig_id,children{id,media_type,media_url}",
                    limit: 50,
                    access_token: pageToken,
                },
            }
        );
        console.log("📸 MEDIA WITH ENGAGEMENT:", res.data);
        return res.data.data || [];
    } catch (err) {
        console.error("❌ Error fetching media:", err?.response?.data?.error || err.message);
        return [];
    }
}

/**
 * Fetch all data at once (profile + insights + demographics)
 * Useful for initial setup/dashboard
 */
export async function fetchCompleteInstagramData(igId, pageToken) {
    try {
        console.log("🔄 Fetching complete Instagram data...");
        
        const [profile, insights, demographics, media] = await Promise.allSettled([
            fetchInstagramProfile(igId, pageToken),
            fetchInstagramInsights(igId, pageToken),
            fetchFollowerDemographics(igId, pageToken),
            fetchMediaWithEngagement(igId, pageToken),
        ]);

        return {
            profile: profile.status === "fulfilled" ? profile.value : null,
            insights: insights.status === "fulfilled" ? insights.value : [],
            demographics: demographics.status === "fulfilled" ? demographics.value : [],
            media: media.status === "fulfilled" ? media.value : [],
        };
    } catch (err) {
        console.error("❌ Error fetching complete data:", err.message);
        return {
            profile: null,
            insights: [],
            demographics: [],
            media: [],
        };
    }
}

/**
 * Post a reply to an Instagram comment
 * POST /v19.0/{commentId}/replies
 */
export async function postCommentReply(commentId, replyMessage, pageToken) {
    try {
        const res = await axios.post(
            `https://graph.facebook.com/v19.0/${commentId}/replies`,
            null,
            {
                params: {
                    message: replyMessage,
                    access_token: pageToken,
                },
            }
        );
        console.log("✅ COMMENT REPLY POSTED SUCCESS:", res.data);
        return res.data;
    } catch (err) {
        console.error("❌ Error posting comment reply:", err?.response?.data?.error || err.message);
        throw new Error(err?.response?.data?.error?.message || "Failed to post comment reply to Instagram");
    }
}

/**
 * Like an Instagram comment
 * POST /v19.0/{igUserId}/likes
 */
export async function likeComment(igUserId, commentId, pageToken) {
    try {
        const res = await axios.post(
            `https://graph.facebook.com/v20.0/${igUserId}/likes`,
            null,
            {
                params: {
                    comment_id: commentId,
                    access_token: pageToken,
                },
            }
        );
        console.log("👍 COMMENT LIKED SUCCESS:", res.data);
        return res.data;
    } catch (err) {
        console.error("❌ Error liking comment:", err?.response?.data?.error || err.message);
        throw new Error(err?.response?.data?.error?.message || "Failed to like comment on Instagram");
    }
}

/**
 * Unlike an Instagram comment
 * DELETE /v19.0/{igUserId}/likes
 */
export async function unlikeComment(igUserId, commentId, pageToken) {
    try {
        const res = await axios.delete(
            `https://graph.facebook.com/v20.0/${igUserId}/likes`,
            {
                params: {
                    comment_id: commentId,
                    access_token: pageToken,
                },
            }
        );
        console.log("👎 COMMENT UNLIKED SUCCESS:", res.data);
        return res.data;
    } catch (err) {
        console.error("❌ Error unliking comment:", err?.response?.data?.error || err.message);
        throw new Error(err?.response?.data?.error?.message || "Failed to unlike comment on Instagram");
    }
}

/**
 * Publish Instagram Story (Image or Video)
 * Stories: no captions, no hashtags, expire after 24h
 * Requires: instagram_content_publish permission
 */
export async function publishInstagramStory({ igUserId, accessToken, imageUrl, videoUrl }) {
    try {
        console.log("📖 Publishing Instagram Story...");
        
        // Stories use same container flow as feed posts
        const creationId = await createIgMediaContainer({
            igUserId,
            accessToken,
            params: {
                media_type: "STORIES",
                image_url: imageUrl || undefined,
                video_url: videoUrl || undefined,
            },
        });

        console.log(`⏳ Waiting for story container ${creationId} to be ready...`);
        await waitForIgContainerReady({ creationId, accessToken });

        console.log(`✅ Story container ready, publishing...`);
        const igMediaId = await publishIgContainer({ igUserId, accessToken, creationId });
        
        return { igMediaId, creationId };
    } catch (err) {
        console.error("❌ Error publishing story:", err.message);
        throw err;
    }
}

/**
 * Fetch story insights
 * For Instagram Stories - impressions, reach, exits, replies, etc.
 * Requires: instagram_manage_insights
 */
export async function fetchStoryInsights(storyId, pageToken) {
    try {
        const res = await axios.get(
            `https://graph.facebook.com/v19.0/${storyId}/insights`,
            {
                params: {
                    metric: "exits,impressions,reach,replies,taps_back,taps_forward",
                    access_token: pageToken,
                },
            }
        );
        console.log("📖 STORY INSIGHTS:", res.data);
        return res.data.data || [];
    } catch (err) {
        console.error("❌ Error fetching story insights:", err?.response?.data?.error || err.message);
        return [];
    }
}

/**
 * Helper: Create IG media container
 * Used internally by publish functions
 */
async function createIgMediaContainer({ igUserId, accessToken, params }) {
    const GRAPH = `${config.GRAPH_BASE_URL}`;
    
    const res = await axios.post(`${GRAPH}/${igUserId}/media`, null, {
        params: { ...params, access_token: accessToken },
    });

    const creationId = res?.data?.id;
    if (!creationId) throw new Error("Failed to create IG media container.");
    return creationId;
}

/**
 * Helper: Wait for IG container to be ready
 * Used internally by publish functions
 */
async function waitForIgContainerReady({ creationId, accessToken, timeoutMs = 60 * 1000 }) {
    const GRAPH = `${config.GRAPH_BASE_URL}`;
    const started = Date.now();

    while (true) {
        if (Date.now() - started > timeoutMs) {
            throw new Error("IG image processing timeout (container not FINISHED).");
        }

        const res = await axios.get(`${GRAPH}/${creationId}`, {
            params: {
                fields: "status_code",
                access_token: accessToken,
            },
        });

        const statusCode = res?.data?.status_code; // IN_PROGRESS | FINISHED | ERROR
        console.log("IG container status", { creationId, statusCode });

        if (statusCode === "FINISHED") return true;
        if (statusCode === "ERROR") throw new Error(`IG container ERROR: ${JSON.stringify(res.data)}`);

        await new Promise((r) => setTimeout(r, 2000));
    }
}

/**
 * Helper: Publish IG container
 * Used internally by publish functions
 */
async function publishIgContainer({ igUserId, accessToken, creationId }) {
    const GRAPH = `${config.GRAPH_BASE_URL}`;
    
    const res = await axios.post(`${GRAPH}/${igUserId}/media_publish`, null, {
        params: { creation_id: creationId, access_token: accessToken },
    });

    const igMediaId = res?.data?.id;
    if (!igMediaId) throw new Error("Failed to publish IG media.");
    return igMediaId;
}