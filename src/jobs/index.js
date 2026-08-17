import { Queue, QueueEvents } from "bullmq";
import redisClient from "../config/redis.js";

// Reusing the ioredis client from config/redis.js
export const connection = redisClient;

export const notificationQueue = new Queue("notification-queue", {
  connection,
  defaultJobOptions: {
    attempts: 10,
    backoff: {
      type: "exponential",
      delay: 10000,
    },
    removeOnComplete: true,
    removeOnFail: {
      count: 100,
    },
  },
  skipVersionCheck: true,
});

export const firecrawlQueue = new Queue("firecrawl-queue", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: true,
    removeOnFail: true,
  },
  skipVersionCheck: true,
});

export const scrapedAssetQueue = new Queue("scraped-asset-queue", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: true,
    removeOnFail: {
      count: 100,
    },
  },
  skipVersionCheck: true,
});

export const reanalysisQueue = new Queue("reanalysis-queue", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: true,
    removeOnFail: true,
  },
  skipVersionCheck: true,
});

export const socialAuditQueue = new Queue("social-audit-queue", {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: true,
    removeOnFail: {
      count: 100,
    },
  },
  skipVersionCheck: true,
});

export const socialAutomationQueue = new Queue("social-automation-queue", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: true,
    removeOnFail: {
      count: 200,
    },
  },
  skipVersionCheck: true,
});



export const aiGenerationQueue = new Queue("ai-generation-queue", {
  connection: redisClient,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 3000,
    },
    removeOnComplete: true,
    removeOnFail: {
      count: 50,
    },
  },
  skipVersionCheck: true,
});

export const videoGenerationQueue = new Queue("video-generation-queue", {
  connection: redisClient,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 3000,
    },
    removeOnComplete: true,
    removeOnFail: {
      count: 50,
    },
  },
  skipVersionCheck: true,
});

export const linkedinPostQueue = new Queue("linkedin-post-queue", {
  connection: redisClient,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 10000,
    },
    removeOnComplete: true,
    removeOnFail: {
      count: 100,
    },
  },
  skipVersionCheck: true,
});

export const youtubePostQueue = new Queue("youtube-post-queue", {
  connection: redisClient,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 10000,
    },
    removeOnComplete: true,
    removeOnFail: {
      count: 100,
    },
  },
  skipVersionCheck: true,
});
export const twitterPostQueue = new Queue("twitter-post-queue", {
  connection: redisClient,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 10000,
    },
    removeOnComplete: true,
    removeOnFail: {
      count: 100,
    },
  },
  skipVersionCheck: true,
});
export const pinterestPostQueue = new Queue("pinterest-post-queue", {
  connection: redisClient,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000, // 5s → 25s → 125s
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
});
export const threadsPostQueue = new Queue("threads-post-queue", {
  connection: redisClient,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000, // 5s → 25s → 125s
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
});


export const bulkEmailQueue = new Queue("bulk-email-queue", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: true,
    removeOnFail: {
      count: 20,
    },
  },
  skipVersionCheck: true,
});

export const resetEmailLimitsQueue = new Queue("reset-email-limits-queue", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 10000,
    },
    removeOnComplete: true,
  },
  skipVersionCheck: true,
});

export const whatsappCampaignQueue = new Queue("whatsapp-campaign-queue", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: true,
    removeOnFail: {
      count: 20,
    },
  },
  skipVersionCheck: true,
});


export const instagramPostQueue = new Queue("instagram-post-queue", {
  connection: redisClient,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 10000,
    },
    removeOnComplete: true,
    removeOnFail: {
      count: 100,
    },
  },
  skipVersionCheck: true,
});

export const facebookPostQueue = new Queue("facebook-post-queue", {
  connection: redisClient,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 10000,
    },
    removeOnComplete: true,
    removeOnFail: {
      count: 100,
    },
  },
  skipVersionCheck: true,
});


export const scraperQueue = new Queue("google-scraper-queue", {
  connection: redisClient,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: "exponential",
      delay: 10000,
    },
    removeOnComplete: {
      count: 200,
    },
    removeOnFail: {
      count: 100,
    },
    timeout: 10 * 60 * 1000, // 10 min hard limit per job
  },
  skipVersionCheck: true,
});

export const invoiceQueue = new Queue("invoice-queue", {
  connection: redisClient,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: true,
    removeOnFail: {
      count: 50,
    },
  },
  skipVersionCheck: true,
});

export const individualAnalysisQueue = new Queue("individual-analysis-queue", {
  connection: redisClient,
  defaultJobOptions: {
    attempts: 2,                    // retry once on failure
    backoff: {
      type: "exponential",
      delay: 5000,                  // 5s, then 10s
    },
    removeOnFail: { count: 50 }, // keep last 50 failed jobs
  },
  skipVersionCheck: true,
});


export const faceSwapQueue = new Queue("face-swap-queue", {
  connection: redisClient,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: true,
    removeOnFail: {
      count: 50,
    },
  },
  skipVersionCheck: true,
});


export const GoogleApileadGenerationQueue = new Queue('google-api-lead-generation-queue', {
  connection: redisClient,
  skipVersionCheck: true,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: true,
    removeOnFail: { count: 50 },
  },
})

export const LinkedinApileadGenerationQueue = new Queue('linkedin-api-lead-generation-queue', {
  connection: redisClient,
  skipVersionCheck: true,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: true,
    removeOnFail: { count: 50 },
  },
})

export const emailTemplateAIQueue = new Queue("email-template-ai-queue", {
  connection: redisClient,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: true,
    removeOnFail: { count: 50 },
  },
  skipVersionCheck: true,
});


export const moderationQueue = new Queue("moderation-queue", {
  connection: redisClient,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: true,
    removeOnFail: {
      count: 50,
    },
  },
  skipVersionCheck: true,
});

export const followQueue = new Queue("follow-queue", {
  connection: redisClient,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
});

export const adminOutreachQueue = new Queue("admin-outreach-queue", {
  connection: redisClient,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
  skipVersionCheck: true,
});

export const videoQueue = new Queue(
  'video-processing',
  {
    connection: redisClient,
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: false,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    },
  }
)


export const supplierWhatsAppQueue =
  new Queue(
    "supplier-whatsapp-queue",
    {
      connection:
        redisClient,

      defaultJobOptions: {
        attempts: 3,

        backoff: {
          type:
            "exponential",

          delay: 10000,
        },

        removeOnComplete:
          true,

        removeOnFail: {
          count: 100,
        },
      },

      skipVersionCheck:
        true,
    }
  );

export const blogPublishQueue = new Queue('publish-blog', {  // ✅ Now matches!
  connection: redisClient.duplicate(),  
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: true,
    removeOnFail: { count: 50 },
  },
  skipVersionCheck: true,
});

export const blogGenerationQueue = new Queue('blog-generation', {
  connection: redisClient,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: true,
    removeOnFail: { count: 50 },
  },
  skipVersionCheck: true,
});

export const autoBlogQueue = new Queue('auto-blog', {
  connection: redisClient,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: true,
    removeOnFail: { count: 50 },
  },
  skipVersionCheck: true,
});


export const supplierWhatsAppRefreshQueue =
  new Queue(
    "supplier-whatsapp-refresh",
    {
      connection:
        redisClient,
    }
  );


export const whatsappNumberValidationQueue =
  new Queue(
    "whatsapp-number-validation-queue",
    {
      connection: redisClient,

      defaultJobOptions: {
        attempts: 2,

        backoff: {
          type: "exponential",
          delay: 10000,
        },

        removeOnComplete: {
          count: 100,
        },

        removeOnFail: {
          count: 100,
        },
      },

      skipVersionCheck: true,
    }
  );

export const aiCaptionQueue = new Queue("ai-caption-queue", {
  connection: redisClient,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 3000 },
    removeOnComplete: true,
    removeOnFail: { count: 50 },
  },
  skipVersionCheck: true,
});

export const aiCaptionQueueEvents = new QueueEvents("ai-caption-queue", {
  connection: redisClient,
});

export const promptTemplateQueue = new Queue("prompt-template-queue", {
  connection: redisClient,

  defaultJobOptions: {
    attempts: 3,

    backoff: {
      type: "exponential",
      delay: 3000,
    },

    removeOnComplete: true,

    removeOnFail: {
      count: 50,
    },
  },

  skipVersionCheck: true,
});
