import FormData
    from "form-data";

import fs
    from "fs";

import whatsappEngineApi
    from "../services/whatsappEngine.service.js";

/*
|--------------------------------------------------------------------------
| UPLOAD DATASET
|--------------------------------------------------------------------------
*/

export const uploadDataset = async (req, res) => {
    try {
        const accountId = req.user.id.toString();

        const formData = new FormData();

        formData.append("accountId", accountId);
        formData.append("name", req.body.name);

        formData.append(
            "file",
            req.file.buffer,
            {
                filename: req.file.originalname,
                contentType: req.file.mimetype,
            }
        );

        const response = await whatsappEngineApi.post(
            "/dataset/upload",
            formData,
            {
                headers: {
                    "x-account-id": accountId,
                    ...(formData.getHeaders?.() ?? {}),
                },
            }
        );

        return res.json(response.data);
    } catch (error) {
        console.log(
            "UPLOAD DATASET ERROR:",
            error.response?.data || error.message
        );

        return res.status(500).json({
            success: false,
            message:
                error.response?.data?.message ||
                "Failed to upload dataset",
        });
    }
};

/*
|--------------------------------------------------------------------------
| GET DATASETS
|--------------------------------------------------------------------------
*/

export const getDatasets =
    async (req, res) => {

        try {

            const accountId =
                req.user.id.toString();

            const response =
                await whatsappEngineApi.get(
                    `/dataset`, { headers: { 'x-account-id': accountId } }
                );

            return res.json(
                response.data
            );

        } catch (error) {

            console.log(
                "GET DATASETS ERROR:",
                error.response?.data ||
                error.message
            );

            return res.status(500).json({

                success: false,

                message:
                    "Failed to fetch datasets",
            });
        }
    };

/*
|--------------------------------------------------------------------------
| GET DATASET
|--------------------------------------------------------------------------
*/

export const getDataset =
    async (req, res) => {

        try {

            const {
                datasetId,
            } = req.params;

            const response =
                await whatsappEngineApi.get(
                    `/datasets/${datasetId}`
                );

            return res.json(
                response.data
            );

        } catch (error) {

            console.log(
                "GET DATASET ERROR:",
                error.response?.data ||
                error.message
            );

            return res.status(500).json({

                success: false,

                message:
                    "Failed to fetch dataset",
            });
        }
    };

/*
|--------------------------------------------------------------------------
| GET DATASET PREVIEW
|--------------------------------------------------------------------------
*/

export const getDatasetPreview =
    async (req, res) => {

        try {

            const {
                datasetId,
            } = req.params;

            const response =
                await whatsappEngineApi.get(
                    `/datasets/${datasetId}/preview`
                );

            return res.json(
                response.data
            );

        } catch (error) {

            console.log(
                "GET DATASET PREVIEW ERROR:",
                error.response?.data ||
                error.message
            );

            return res.status(500).json({

                success: false,

                message:
                    "Failed to fetch dataset preview",
            });
        }
    };

/*
|--------------------------------------------------------------------------
| DELETE DATASET
|--------------------------------------------------------------------------
*/

export const deleteDataset =
    async (req, res) => {

        try {

            const {
                datasetId,
            } = req.params;

            const response =
                await whatsappEngineApi.delete(
                    `/datasets/${datasetId}`
                );

            return res.json(
                response.data
            );

        } catch (error) {

            console.log(
                "DELETE DATASET ERROR:",
                error.response?.data ||
                error.message
            );

            return res.status(500).json({

                success: false,

                message:
                    "Failed to delete dataset",
            });
        }
    };