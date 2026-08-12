import whatsappEngineApi
    from "../services/whatsappEngine.service.js";

/*
|--------------------------------------------------------------------------
| ESTIMATE CAMPAIGN
|--------------------------------------------------------------------------
*/

export const estimateCampaign =
    async (req, res) => {

        try {

            const accountId =
                req.user.id.toString();

            const response =
                await whatsappEngineApi.post(
                    "/campaign/estimate",
                    {
                        accountId,
                        ...req.body,
                    }
                );

            return res.json(
                response.data
            );

        } catch (error) {

            console.log(
                "ESTIMATE CAMPAIGN ERROR:",
                error.response?.data ||
                error.message
            );

            return res.status(500).json({

                success: false,

                message:
                    error.response?.data?.message ||
                    "Failed to estimate campaign",
            });
        }
    };

/*
|--------------------------------------------------------------------------
| CREATE CAMPAIGN
|--------------------------------------------------------------------------
*/

export const createCampaign =
    async (req, res) => {

        try {

            const accountId =
                req.user.id.toString();

            const response =
                await whatsappEngineApi.post(
                    "/campaign",
                    {
                        accountId,
                        ...req.body,
                    }
                );

            return res.json(
                response.data
            );

        } catch (error) {

            console.log(
                "CREATE CAMPAIGN ERROR:",
                error.response?.data ||
                error.message
            );

            return res.status(500).json({

                success: false,

                message:
                    error.response?.data?.message ||
                    "Failed to create campaign",
            });
        }
    };

/*
|--------------------------------------------------------------------------
| GET CAMPAIGNS
|--------------------------------------------------------------------------
*/

export const getCampaigns =
    async (req, res) => {

        try {

            const accountId =
                req.user.id.toString();

            const response =
                await whatsappEngineApi.get(
                    `/campaign`, {headers: {'x-account-id': accountId}}
                );

            return res.json(
                response.data
            );

        } catch (error) {

            console.log(
                "GET CAMPAIGNS ERROR:",
                error.response?.data ||
                error.message
            );

            return res.status(500).json({

                success: false,

                message:
                    "Failed to fetch campaigns",
            });
        }
    };

/*
|--------------------------------------------------------------------------
| GET CAMPAIGN
|--------------------------------------------------------------------------
*/

export const getCampaign =
    async (req, res) => {

        try {

            const {
                campaignId,
            } = req.params;

            const response =
                await whatsappEngineApi.get(
                    `/campaign/${campaignId}`
                );

            return res.json(
                response.data
            );

        } catch (error) {

            console.log(
                "GET CAMPAIGN ERROR:",
                error.response?.data ||
                error.message
            );

            return res.status(500).json({

                success: false,

                message:
                    "Failed to fetch campaign",
            });
        }
    };

/*
|--------------------------------------------------------------------------
| PAUSE CAMPAIGN
|--------------------------------------------------------------------------
*/

export const pauseCampaign =
    async (req, res) => {

        try {

            const {
                campaignId,
            } = req.params;

            const response =
                await whatsappEngineApi.patch(
                    `/campaign/${campaignId}/pause`
                );

            return res.json(
                response.data
            );

        } catch (error) {

            console.log(
                "PAUSE CAMPAIGN ERROR:",
                error.response?.data ||
                error.message
            );

            return res.status(500).json({

                success: false,

                message:
                    "Failed to pause campaign",
            });
        }
    };

/*
|--------------------------------------------------------------------------
| RESUME CAMPAIGN
|--------------------------------------------------------------------------
*/

export const resumeCampaign =
    async (req, res) => {

        try {

            const {
                campaignId,
            } = req.params;

            const response =
                await whatsappEngineApi.patch(
                    `/campaign/${campaignId}/resume`
                );

            return res.json(
                response.data
            );

        } catch (error) {

            console.log(
                "RESUME CAMPAIGN ERROR:",
                error.response?.data ||
                error.message
            );

            return res.status(500).json({

                success: false,

                message:
                    "Failed to resume campaign",
            });
        }
    };

/*
|--------------------------------------------------------------------------
| STOP CAMPAIGN
|--------------------------------------------------------------------------
*/

export const stopCampaign =
    async (req, res) => {

        try {

            const {
                campaignId,
            } = req.params;

            const response =
                await whatsappEngineApi.patch(
                    `/campaign/${campaignId}/stop`
                );

            return res.json(
                response.data
            );

        } catch (error) {

            console.log(
                "STOP CAMPAIGN ERROR:",
                error.response?.data ||
                error.message
            );

            return res.status(500).json({

                success: false,

                message:
                    "Failed to stop campaign",
            });
        }
    };

/*
|--------------------------------------------------------------------------
| GET ANALYTICS
|--------------------------------------------------------------------------
*/

export const getCampaignAnalytics =
    async (req, res) => {

        try {

            const {
                campaignId,
            } = req.params;

            const response =
                await whatsappEngineApi.get(
                    `/campaign/${campaignId}/analytics`
                );

            return res.json(
                response.data
            );

        } catch (error) {

            console.log(
                "GET CAMPAIGN ANALYTICS ERROR:",
                error.response?.data ||
                error.message
            );

            return res.status(500).json({

                success: false,

                message:
                    "Failed to fetch analytics",
            });
        }
    };

export const getCampaignConnections =
    async (req, res) => {

        try {

            const accountId = req?.user?.id

            console.log('req hitted', accountId)

            const response =
                await whatsappEngineApi.get(
                    `/campaign/campaign-connections`,  {headers: {'x-account-id': accountId}}
                );

                console.log('response', response)

            return res.json(
                response.data
            );

        } catch (error) {

            console.log(
                "GET CAMPAIGN Connection ERROR:",
                error.response?.data ||
                error.message
            );

            return res.status(500).json({

                success: false,

                message:
                    "Failed to fetch analytics",
            });
        }
    };

