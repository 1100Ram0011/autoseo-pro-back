import axios from "axios";
import config from "../config/config.js"

export async function exchangeCodeForToken(code) {

    const res = await axios.post(
        "https://www.linkedin.com/oauth/v2/accessToken",
        new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: config.LINKEDIN_REDIRECT_URI,
            client_id: config.LINKEDIN_CLIENT_ID,
            client_secret: config.LINKEDIN_CLIENT_SECRET,
        }),
        {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
        }
    );

    return {
        accessToken: res.data.access_token,
        refreshToken: res.data.refresh_token,
        expiresIn: res.data.expires_in,
        refreshTokenExpiresIn: res.data.refresh_token_expires_in
    };
}

export async function refreshLinkedInToken(refreshToken) {
    const res = await axios.post(
        "https://www.linkedin.com/oauth/v2/accessToken",
        new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: refreshToken,
            client_id: config.LINKEDIN_CLIENT_ID,
            client_secret: config.LINKEDIN_CLIENT_SECRET,
        }),
        {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
        }
    );

    return {
        accessToken: res.data.access_token,
        refreshToken: res.data.refresh_token,
        expiresIn: res.data.expires_in,
        refreshTokenExpiresIn: res.data.refresh_token_expires_in
    };
}

// export async function fetchProfile(accessToken) {

//     const res = await axios.get(
//         "https://api.linkedin.com/v2/userinfo",
//         {
//             headers: {
//                 Authorization: `Bearer ${accessToken}`,
//             },
//         }
//     );

//     return res.data;
// }


// Upload POst 


export async function fetchProfile(accessToken) {
    try {
        // Add the projection query string to fetch the displayImage
        const linkedInUrl = "https://api.linkedin.com/v2/me?projection=(id,localizedFirstName,localizedLastName,profilePicture(displayImage~:playableStreams))";

        const res = await axios.get(linkedInUrl, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Connection": "Keep-Alive" 
            },
        });

        return res.data;
    } catch (error) {
        console.error("LinkedIn Profile Fetch Error:", error.response?.data || error.message);
        throw error;
    }
}
export async function registerUpload({ accessToken, owner, mediaType }) {
    const isVideo = mediaType === "video";
    const ownerUrn = owner.startsWith("urn:li:") ? owner : `urn:li:person:${owner}`;

    const res = await axios.post(
        "https://api.linkedin.com/v2/assets?action=registerUpload",
        {
            registerUploadRequest: {
                owner: ownerUrn,
                recipes: [
                    isVideo
                        ? "urn:li:digitalmediaRecipe:feedshare-video"
                        : "urn:li:digitalmediaRecipe:feedshare-image",
                ],
                serviceRelationships: [
                    {
                        relationshipType: "OWNER",
                        identifier: "urn:li:userGeneratedContent",
                    },
                ],
            },
        },
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "X-Restli-Protocol-Version": "2.0.0",
            },
        }
    );

    const upload = res.data.value.uploadMechanism[
        "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"
    ];

    return {
        uploadUrl: upload.uploadUrl,
        asset: res.data.value.asset,
    };
}


export async function uploadBinary({ uploadUrl, buffer, mimeType }) {
    await axios.put(uploadUrl, buffer, {
        headers: {
            "Content-Type": mimeType,
            "Content-Length": buffer.length,
        },
        maxBodyLength: Infinity,
    });
}


export async function createTextPost({ accessToken, urn, text }) {
    const authorUrn = urn.startsWith("urn:li:") ? urn : `urn:li:person:${urn}`;

    const response = await axios.post(
        "https://api.linkedin.com/v2/ugcPosts",
        {
            author: authorUrn,

            lifecycleState: "PUBLISHED",

            specificContent: {
                "com.linkedin.ugc.ShareContent": {
                    shareCommentary: { text },
                    shareMediaCategory: "NONE",
                },
            },

            visibility: {
                "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
            },
        },
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "X-Restli-Protocol-Version": "2.0.0",
            },
        }
    );

    const newPostId = response.headers["x-restli-id"];
    console.log("Successfully posted! The ID is:", newPostId);
    return response;
}

export async function createMediaPost({
    accessToken,
    owner,
    text,
    asset,
    mediaType,
}) {
    const authorUrn = owner.startsWith("urn:li:") ? owner : `urn:li:person:${owner}`;
    const response = await axios.post(
        "https://api.linkedin.com/v2/ugcPosts",
        {
            author: authorUrn,
            lifecycleState: "PUBLISHED",
            specificContent: {
                "com.linkedin.ugc.ShareContent": {
                    shareCommentary: { text },
                    shareMediaCategory: mediaType === "video" ? "VIDEO" : "IMAGE",
                    media: [
                        {
                            status: "READY",
                            media: asset,
                        },
                    ],
                },
            },
            visibility: {
                "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
            },
        },
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "X-Restli-Protocol-Version": "2.0.0",
            },
        }
    );

    const newPostId = response.headers["x-restli-id"];
    console.log("Successfully posted! The ID is:", newPostId);
    return response;
}

/* -------------------------------
   ORGANIZATION HELPERS (NEW)
-------------------------------- */
export async function fetchAdministeredOrganizations(accessToken) {
    try {
        const res = await axios.get(
            "https://api.linkedin.com/rest/organizationAcls?q=roleAssignee",
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "LinkedIn-Version": "202605",
                    "X-Restli-Protocol-Version": "2.0.0",
                },
            }
        );
        return res.data.elements || [];
    } catch (error) {
        console.error("LinkedIn fetchAdministeredOrganizations error:", error.response?.data || error.message);
        return [];
    }
}

export async function fetchOrganizationDetails(accessToken, orgId) {
    try {
        const res = await axios.get(
            `https://api.linkedin.com/rest/organizations/${orgId}`,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "LinkedIn-Version": "202605",
                    "X-Restli-Protocol-Version": "2.0.0",
                },
            }
        );
        const org = res.data;
        
        let logo = "";
        if (org.logoV2) {
            // 1. Try modern logoV2 URN parsing and resolve via Images API
            const assetUrn = org.logoV2.original || org.logoV2.cropped;
            if (assetUrn && assetUrn.startsWith("urn:li:digitalmediaAsset:")) {
                const imageUrn = assetUrn.replace("urn:li:digitalmediaAsset:", "urn:li:image:");
                try {
                    const imageRes = await axios.get(
                        `https://api.linkedin.com/rest/images/${encodeURIComponent(imageUrn)}`,
                        {
                            params: { fields: "downloadUrl" },
                            headers: {
                                Authorization: `Bearer ${accessToken}`,
                                "LinkedIn-Version": "202605",
                                "X-Restli-Protocol-Version": "2.0.0",
                            }
                        }
                    );
                    if (imageRes.data && imageRes.data.downloadUrl) {
                        logo = imageRes.data.downloadUrl;
                    }
                } catch (imgError) {
                    console.error(`Error resolving organization logo image URN ${imageUrn}:`, imgError.response?.data || imgError.message);
                }
            }

            // 2. Fallback to old decoration-based logic
            if (!logo) {
                const originalStream = org.logoV2["original~"] || org.logoV2["cropped~"];
                if (originalStream && originalStream.playableStreams && originalStream.playableStreams.length > 0) {
                    logo = originalStream.playableStreams[0].url;
                }
            }
        }
        
        return {
            id: `urn:li:organization:${orgId}`,
            name: org.localizedName || org.vanityName || "LinkedIn Page",
            vanityName: org.vanityName || "",
            logo: logo,
        };
    } catch (error) {
        console.error(`Error fetching organization details for ${orgId}:`, error.response?.data || error.message);
        return null;
    }
}

// export async function fetchOrganizationDetails(accessToken, orgId) {
//     try {
//         // 1. ADDED THE PROJECTION STRING TO THE URL!
//         const res = await axios.get(
//             `https://api.linkedin.com/rest/organizations/${orgId}?projection=(id,localizedName,vanityName,logoV2(original~:playableStreams))`,
//             {
//                 headers: {
//                     Authorization: `Bearer ${accessToken}`,
//                     "LinkedIn-Version": "202605",
//                     "X-Restli-Protocol-Version": "2.0.0",
//                 },
//             }
//         );
//         const org = res.data;
        
//         // 2. FIXED THE IMAGE EXTRACTION LOGIC
//         let logo = "";
//         // Safely dig through LinkedIn's massive nested array to find the actual image URL
//         const logoData = org.logoV2?.["original~"]?.elements?.[0]?.identifiers?.[0];
        
//         if (logoData && logoData.identifier) {
//             logo = logoData.identifier; 
//         }
        
//         return {
//             id: `urn:li:organization:${orgId}`,
//             name: org.localizedName || org.vanityName || `LinkedIn Page (${orgId})`,
//             vanityName: org.vanityName || "",
//             logo: logo, // This will now successfully hold the URL!
//         };
//     } catch (error) {
//         console.error(`Error fetching organization details for ${orgId}:`, error.response?.data || error.message);
//         return null;
//     }
// }