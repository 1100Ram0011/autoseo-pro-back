// workers/whatsappValidation.worker.js

import { Worker } from "bullmq";

import {
  processValidation,
} from "./validator.worker.js";
import redisClient from "../../config/redis.js";

console.log(
  "[VALIDATOR] Initializing WhatsApp Validation Worker..."
);

export const whatsappValidationWorker =
  new Worker(
    "whatsapp-number-validation-queue",

    async (job) => {

      console.log(
        "[VALIDATOR] ===================================="
      );

      console.log(
        "[VALIDATOR] JOB RECEIVED"
      );

      console.log(
        "[VALIDATOR] Job ID:",
        job.id
      );

      console.log(
        "[VALIDATOR] Job Name:",
        job.name
      );

      console.log(
        "[VALIDATOR] Job Data:",
        job.data
      );

      console.log(
        "[VALIDATOR] ===================================="
      );

      const {
        jobId,
      } = job.data;

      if (!jobId) {

        throw new Error(
          "jobId missing in queue payload"
        );
      }

      await processValidation(
        jobId
      );

      return {
        success: true,
      };
    },

    {
      connection:
        redisClient,

      concurrency:
        1,

      autorun: true,
    }
  );

whatsappValidationWorker.on(
  "ready",
  () => {

    console.log(
      "[VALIDATOR] Worker Ready"
    );
  }
);

whatsappValidationWorker.on(
  "active",
  job => {

    console.log(
      `[VALIDATOR] Processing Job ${job.id}`
    );
  }
);

whatsappValidationWorker.on(
  "completed",
  (
    job,
    result
  ) => {

    console.log(
      `[VALIDATOR] Job Completed ${job.id}`
    );

    console.log(
      "[VALIDATOR] Result:",
      result
    );
  }
);

whatsappValidationWorker.on(
  "failed",
  (
    job,
    error
  ) => {

    console.error(
      `[VALIDATOR] Job Failed ${job?.id}`
    );

    console.error(
      error
    );
  }
);

whatsappValidationWorker.on(
  "error",
  error => {

    console.error(
      "[VALIDATOR] Worker Error"
    );

    console.error(
      error
    );
  }
);

whatsappValidationWorker.on(
  "stalled",
  jobId => {

    console.error(
      `[VALIDATOR] Job Stalled ${jobId}`
    );
  }
);

// process.on(
//   "SIGTERM",
//   async () => {

//     console.log(
//       "[VALIDATOR] Closing Worker..."
//     );

//     await whatsappValidationWorker.close();
//   }
// );

// process.on(
//   "SIGINT",
//   async () => {

//     console.log(
//       "[VALIDATOR] Closing Worker..."
//     );

//     await whatsappValidationWorker.close();
//   }
// );

export default whatsappValidationWorker;