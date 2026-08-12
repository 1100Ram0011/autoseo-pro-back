import WhatsappValidationJob from "../models/WhatsappValidationJob.js";
import { whatsappNumberValidationQueue } from "../queue/index.js";
import whatsappEngineApi from "../services/whatsappEngine.service.js";
import socketService from "../socket.js";
import { uploadToS3 } from "../utils/upload.js";
import crypto from "crypto";


/*
|--------------------------------------------------------------------------
| CONNECT
|--------------------------------------------------------------------------
*/

export const connectWhatsApp =
  async (req, res) => {

    try {

      const accountId =
        req.user.id.toString();

      const response =
        await whatsappEngineApi.post(
          "/connect",
          {
            accountId,
          }
        );

      return res.json(
        response.data
      );

    } catch (error) {

      console.log(
        "CONNECT ERROR:",
        error.response?.data ||
        error.message
      );

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Failed to connect WhatsApp",
        });
    }
  };

export const getWhatsAppConnections =
  async (req, res) => {

    try {

      const accountId =
        req.user.id.toString();

      const response =
        await whatsappEngineApi.get(
          `/connections/${accountId}`
        );

      return res.json(
        response.data
      );

    } catch (error) {

      console.log(
        "CONNECTIONS ERROR:",
        error.response?.data ||
        error.message
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to fetch connections",
      });
    }
  };

/*
|--------------------------------------------------------------------------
| QR
|--------------------------------------------------------------------------
*/

export const getWhatsAppQRCode =
  async (req, res) => {

    try {

      const {
        connectionId,
      } = req.params;

      const accountId = req.user.id

      const response =
        await whatsappEngineApi.get(
          `/qr/${connectionId}`, { headers: { 'x-account-id': accountId } }
        );

      return res.json(
        response.data
      );

    } catch (error) {

      console.log(
        "QR ERROR:",
        error.response?.data ||
        error.message
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to fetch QR",
      });
    }
  };

/*
|--------------------------------------------------------------------------
| STATUS
|--------------------------------------------------------------------------
*/

export const getWhatsappConnectionStatus =
  async (req, res) => {

    try {

      const {
        connectionId,
      } = req.params;

      const response =
        await whatsappEngineApi.get(
          `/status/${connectionId}`
        );

      return res.json(
        response.data
      );

    } catch (error) {

      console.log(
        "STATUS ERROR:",
        error.response?.data ||
        error.message
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to fetch status",
      });
    }
  };

/*
|--------------------------------------------------------------------------
| LOGOUT
|--------------------------------------------------------------------------
*/

export const logoutWhatsApp =
  async (req, res) => {

    try {

      const {
        connectionId,
      } = req.body;

      const response =
        await whatsappEngineApi.post(
          "/logout",
          {
            connectionId,
          }
        );

      return res.json(
        response.data
      );

    } catch (error) {

      console.log(
        "LOGOUT ERROR:",
        error.response?.data ||
        error.message
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to logout",
      });
    }
  };


export const logoutAllWhatsApp =
  async (req, res) => {

    try {

      const accountId =
        req.user.id.toString();

      const response =
        await whatsappEngineApi.post(
          "/logout-all",
          {
            accountId,
          }
        );

      return res.json(
        response.data
      );

    } catch (error) {

      console.log(
        "LOGOUT ALL ERROR:",
        error.response?.data ||
        error.message
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to logout all",
      });
    }
  };

/*
|--------------------------------------------------------------------------
| CHECK NUMBER
|--------------------------------------------------------------------------
*/

export const checkWhatsAppNumber =
  async (req, res) => {

    const accountId =
      req.user.id.toString();


    try {

      const {
        connectionId,
        number,
      } = req.body;

      if (!number) {

        return res.status(400).json({
          success: false,
          message:
            "Number is required",
        });
      }

      const response =
        await whatsappEngineApi.post(
          "/check-number",
          {
            accountId,
            connectionId,
            number,
          }
        );

      return res.json(
        response.data
      );

    } catch (error) {

      console.log(
        "CHECK NUMBER ERROR:",
        error.response?.data ||
        error.message
      );

      return res.status(500).json({
        success: false,
        message:
          error.response?.data?.message ||
          error.message || "Failed to check number",
      });
    }
  };



export const whatsappWebhook =
  async (req, res) => {

    try {

      // const secret =
      //   req.headers[
      //   "x-engine-secret"
      //   ];

      // if (
      //   secret !==
      //   process.env.WEBHOOK_SECRET
      // ) {

      //   return res
      //     .status(401)
      //     .json({
      //       success: false,
      //     });
      // }

      const {
        event,
        accountId,
        connectionId,
        data,
      } = req.body;

      socketService.emitWhatsAppStatus(
        accountId,
        {
          event,
          connectionId,
          ...data,
        }
      );

      return res.json({
        success: true,
      });

    } catch (error) {

      console.log(
        "WEBHOOK ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
      });
    }
  };


export const uploadFile =
  async (
    req,
    res
  ) => {

    try {

      if (!req.file) {

        return res.status(400).json({
          success: false,
          message: "File required",
        });
      }

      const accountId =
        req.user.id.toString();

      const extension =
        req.file.originalname
          .split(".")
          .pop()
          ?.toLowerCase();
          const key =
  `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${extension}`;

      const sourceFileUrl =
        await uploadToS3(
          req.file.buffer,
          key,
          "whatsapp-validator/source",
          req.file.mimetype
        );

      const job =
        await WhatsappValidationJob.create({
          accountId,
          originalFileName: req.file.originalname,
          sourceFileUrl,
        });

      await whatsappNumberValidationQueue.add(
        "validate-whatsapp",
        {
          jobId:
            job._id.toString(),
          accountId,
        }
      );

      return res.json({
        success: true,
        jobId: job._id,
      });

    } catch (error) {

      console.error(
        "[VALIDATOR] Upload Failed",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          error.message,
      });
    }
  };


export const getStatus =
  async (
    req,
    res
  ) => {

    const job =
      await WhatsappValidationJob.findById(
        req.params.jobId
      );

    return res.json({
      success:
        true,

      data: {
        status:
          job.status,

        totalRows:
          job.totalRows,

        processedRows:
          job.processedRows,

        downloadUrl:
          job.resultFileUrl,
      },
    });
  };