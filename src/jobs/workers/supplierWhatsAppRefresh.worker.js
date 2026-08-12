// workers/supplierWhatsAppRefresh.worker.js

import { Worker } from "bullmq";

import redisClient
  from "../../config/redis.js";

import whatsappEngineApi
  from "../../services/whatsappEngine.service.js";
import Supplier from "../../models/googlemap/Supplier.js";
import userModel from "../../models/userModel.js";

const BATCH_SIZE = 100;

export const supplierWhatsAppRefreshWorker =
  new Worker(

    "supplier-whatsapp-refresh",

    async () => {

      console.log(
        "STARTING WHATSAPP REFRESH"
      );

      /*
      |--------------------------------------------------------------------------
      | GET ACTIVE ACCOUNT
      |--------------------------------------------------------------------------
      */

      const adminLogin = await userModel.findOne({ email: 'shiv.borade.ai@gmail.com' }).lean();


      const accountId = adminLogin?._id;

      if (
        !accountId
      ) {

        console.log(
          "NO ACTIVE WHATSAPP SESSION"
        );

        return;
      }

      let page = 0;

      while (true) {

        const suppliers =
          await Supplier.find({

            phone: {
              $nin: [
                null,
                "",
                "N/A",
              ],
            },

            $or: [
              {
                whatsappCheckedAt:
                {
                  $exists:
                    false,
                },
              },
              {
                whatsappCheckedAt:
                {
                  $lt:
                    new Date(
                      Date.now() -
                      30 *
                      24 *
                      60 *
                      60 *
                      1000
                    ),
                },
              },
            ],
          })

            .skip(
              page *
              BATCH_SIZE
            )

            .limit(
              BATCH_SIZE
            )

            .lean();

        if (
          suppliers.length ===
          0
        ) {

          break;
        }

        console.log('suppliers batch', page, suppliers.length);

        for (const supplier of suppliers) {

          try {

            const result =
              await whatsappEngineApi.post(
                "/check-number-account",
                {
                  accountId,

                  number:
                    supplier.phone,
                }
              );

            await Supplier.updateOne(
              {
                _id:
                  supplier._id,
              },
              {
                $set: {

                  isWhatsAppNumber:
                    result
                      .data
                      ?.data
                      ?.whatsapp ||
                    false,

                  whatsappCheckedAt:
                    new Date(),
                },
              }
            );
            console.log(
              `CHECKED ${supplier.phone} - WhatsApp: ${result.data?.data?.whatsapp}`
            );

          } catch (error) {
            // console.log(
            //   `CHECK FAILED ${supplier.phone}`,
            //   error
            // );

            console.log(`CHECK FAILED ${supplier.phone} ${error.response?.data?.message}`);

            // Stop processing immediately if service is unreachable
            if (
              error.code === "ECONNREFUSED" ||
              error.code === "ENOTFOUND" ||
              error.code === "ETIMEDOUT"
            ) {
              console.error(
                "WhatsApp Engine API is unavailable. Stopping loop."
              );
              return;
            }

            if(error.response?.data?.message === 'WhatsApp not connected'){
              console.error(
                "WhatsApp Engine API is not connected. Stopping loop."
              );
              return;
            }
          }
        }

        page++;
      }

      console.log(
        "WHATSAPP REFRESH COMPLETED"
      );
    },

    {
      connection:
        redisClient,

      concurrency:
        1,
    }
  );