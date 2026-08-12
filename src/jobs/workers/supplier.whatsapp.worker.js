import { Worker } from "bullmq";

import redisClient from "../../config/redis.js";

import Supplier from "../../models/googlemap/Supplier.js";

import { emitProgress } from "./googleApiLeads.worker.js";

import whatsappEngineApi from "../../services/whatsappEngine.service.js";
import userModel from "../../models/userModel.js";

const delay =
  (ms) =>
    new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          ms
        )
    );

export const supplierWhatsAppWorker =
  new Worker(

    "supplier-whatsapp-queue",

    async (job) => {

      const {
        supplierId,
        userId: requestedId,
      } = job.data;

      try {

        console.log(
          `Processing supplier ${supplierId} for WhatsApp check`
        );

        const adminLogin = await userModel.findOne({ email: 'shiv.borade.ai@gmail.com' }).lean();

        const supplier =
          await Supplier.findById(
            supplierId
          );

        if (
          !supplier
        ) {

          return;
        }

        /*
        |--------------------------------------------------------------------------
        | NO PHONE
        |--------------------------------------------------------------------------
        */

        if (
          !supplier.phone ||
          supplier.phone ===
          "N/A"
        ) {

          await Supplier.findByIdAndUpdate(
            supplierId,
            {
              whatsappProcessingStatus:
                "FAILED",
            }
          );

          return;
        }

        /*
        |--------------------------------------------------------------------------
        | PROCESSING
        |--------------------------------------------------------------------------
        */

        await Supplier.findByIdAndUpdate(
          supplierId,
          {
            whatsappProcessingStatus:
              "PROCESSING",
          }
        );

        /*
        |--------------------------------------------------------------------------
        | HUMAN DELAY
        |--------------------------------------------------------------------------
        */

        await delay(

          Math.floor(
            Math.random() *
            4000
          ) + 3000

        );

        /*
        |--------------------------------------------------------------------------
        | CHECK NUMBER USING WHATSAPP ENGINE
        |--------------------------------------------------------------------------
        */

        let response;

        try {

          response =
            await whatsappEngineApi.post(
              "/check-number-account",
              {
                accountId: adminLogin._id.toString(),

                number:
                  supplier.phone,
              }
            );

        } catch (error) {

          console.log(
            `ENGINE CHECK FAILED ${supplier.phone}`,
            // error.response?.data ||
            // error.message
          );

          await Supplier.findByIdAndUpdate(
            supplierId,
            {
              whatsappProcessingStatus:
                "FAILED",
            }
          );

          return;
        }

        const isRegistered =
          response?.data?.data?.whatsapp ||
          false;

        /*
        |--------------------------------------------------------------------------
        | UPDATE SUPPLIER
        |--------------------------------------------------------------------------
        */

        await Supplier.findByIdAndUpdate(
          supplierId,
          {
            isWhatsAppNumber:
              isRegistered,

            whatsappProcessingStatus:
              "COMPLETED",

            whatsappCheckedAt:
              new Date(),
          }
        );

        console.log(
          `Completed WhatsApp check for supplier ${supplierId}: ${isRegistered}`
        );

        // await emitProgress(
        //   requestedId,
        //   "lead:completed",
        //   {
        //     percent: 100,

        //     label:
        //       `WhatsApp check completed for supplier ${supplier.name}`,
        //   }
        // );

      } catch (error) {

        console.error(
          "SUPPLIER WHATSAPP WORKER ERROR:",
          error
        );

        await Supplier.findByIdAndUpdate(
          supplierId,
          {
            whatsappProcessingStatus:
              "FAILED",
          }
        );

      }
    },

    {
      connection:
        redisClient,

      concurrency: 1,
    }
  );

supplierWhatsAppWorker.on(
  "completed",
  (job) => {

    console.log(
      `WhatsApp worker completed job ${job.id}`
    );
  }
);

supplierWhatsAppWorker.on(
  "failed",
  (
    job,
    error
  ) => {

    console.log(
      `WhatsApp worker failed job ${job?.id}:`,
      error?.message
    );
  }
);