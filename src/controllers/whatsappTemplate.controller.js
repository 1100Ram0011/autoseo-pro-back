// controllers/whatsappTemplate.controller.js

import whatsappEngineApi
  from "../services/whatsappEngine.service.js";

/*
|--------------------------------------------------------------------------
| CREATE TEMPLATE
|--------------------------------------------------------------------------
*/

export const createTemplate =
  async (req, res) => {

    try {

      const accountId =
        req.user.id.toString();

      const response =
        await whatsappEngineApi.post(
          "/template",
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
        "CREATE TEMPLATE ERROR:",
        error.response?.data ||
        error.message
      );

      return res.status(500).json({

        success: false,

        message:
          error.response?.data?.message ||
          "Failed to create template",
      });
    }
  };

/*
|--------------------------------------------------------------------------
| GET TEMPLATES
|--------------------------------------------------------------------------
*/

export const getTemplates =
  async (req, res) => {

    try {

      const accountId =
        req.user.id.toString();

      const response =
        await whatsappEngineApi.get(
          `/template/${accountId}`
        );

      return res.json(
        response.data
      );

    } catch (error) {

      console.log(
        "GET TEMPLATES ERROR:",
        error.response?.data ||
        error.message
      );

      return res.status(500).json({

        success: false,

        message:
          "Failed to fetch templates",
      });
    }
  };

/*
|--------------------------------------------------------------------------
| GET TEMPLATE
|--------------------------------------------------------------------------
*/

export const getTemplate =
  async (req, res) => {

    try {

      const {
        templateId,
      } = req.params;

      const response =
        await whatsappEngineApi.get(
          `/template/${templateId}`
        );

      return res.json(
        response.data
      );

    } catch (error) {

      console.log(
        "GET TEMPLATE ERROR:",
        error.response?.data ||
        error.message
      );

      return res.status(500).json({

        success: false,

        message:
          "Failed to fetch template",
      });
    }
  };

/*
|--------------------------------------------------------------------------
| UPDATE TEMPLATE
|--------------------------------------------------------------------------
*/

export const updateTemplate =
  async (req, res) => {

    try {

      const {
        templateId,
      } = req.params;

      const accountId =
        req.user.id.toString();

      const response =
        await whatsappEngineApi.put(
          `/template/${templateId}`,
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
        "UPDATE TEMPLATE ERROR:",
        error.response?.data ||
        error.message
      );

      return res.status(500).json({

        success: false,

        message:
          "Failed to update template",
      });
    }
  };

/*
|--------------------------------------------------------------------------
| DELETE TEMPLATE
|--------------------------------------------------------------------------
*/

export const deleteTemplate =
  async (req, res) => {

    try {

      const {
        templateId,
      } = req.params;

      const accountId =
        req.user.id.toString();

      const response =
        await whatsappEngineApi.delete(
          `/template/${templateId}`,
          {
            data: {
              accountId,
            },
          }
        );

      return res.json(
        response.data
      );

    } catch (error) {

      console.log(
        "DELETE TEMPLATE ERROR:",
        error.response?.data ||
        error.message
      );

      return res.status(500).json({

        success: false,

        message:
          "Failed to delete template",
      });
    }
  };