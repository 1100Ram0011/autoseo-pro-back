/**
 * Utility to synchronize local database settings with Meta Graph API in real-time.
 * This is used for "Lazy Read-Through Sync" to ensure the UI always shows the absolute truth.
 * 
 * @param {Object} params
 * @param {Object} params.document - The Mongoose document to update.
 * @param {string} params.phoneNumberId - The Meta phone number ID.
 * @param {string} params.accessToken - The system access token for Meta.
 * @param {Function} params.fetchFromMetaFn - Async function to fetch data from Meta. Example: `() => MetaGraphClient.getPhoneNumberSettings(phoneNumberId, accessToken, { fields: 'calling' })`
 * @param {Function} params.extractLiveStateFn - Function to extract the specific settings slice from Meta's response. Example: `(res) => res?.data?.[0]?.calling`
 * @param {Function} params.compareAndUpdateFn - Function that compares live state with local document and mutates the document. Returns true if mutations occurred.
 * @returns {Promise<boolean>} True if the document was updated and saved.
 */
export const syncWithMetaGraph = async ({
    document,
    phoneNumberId,
    accessToken,
    fetchFromMetaFn,
    extractLiveStateFn,
    compareAndUpdateFn
}) => {
    if (!accessToken) return false;

    try {
        const metaResponse = await fetchFromMetaFn();
        if (!metaResponse) return false;

        const liveState = extractLiveStateFn(metaResponse);
        if (!liveState) return false;

        const needsSave = compareAndUpdateFn(document, liveState);
        
        if (needsSave) {
            console.log(`[Sync] Conflict detected for ${phoneNumberId}. Updating local DB from Meta Graph API...`);
            await document.save();
            return true;
        }

        return false;
    } catch (error) {
        console.error(`[SyncError] Failed to fetch live data from Meta for ${phoneNumberId}:`, error.message);
        // We gracefully fail and allow the system to proceed with local settings
        return false;
    }
};
