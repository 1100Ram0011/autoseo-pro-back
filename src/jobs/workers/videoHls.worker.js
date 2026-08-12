// workers/videoHls.worker.js

import { Worker } from 'bullmq'
import redisClient from '../../config/redis.js'
import ProcessedVideo from '../../models/ProcessedVideo.js'
import { processVideoToHls } from '../../services/process-video.service.js'
import SwapTemplate from '../../models/SwapTemplate.js'
import MediaStore from '../../models/MediaStore.js'
import PixverseprompttemplateModel from '../../models/Pixverse/Pixverseprompttemplate.model.js'


export const videoHlsWorker =
    new Worker(
        'video-processing',

        async (job) => {
            const {
                mp4Url,
                sourceId,
                sourceModel,
            } = job.data

            let processedVideo = null

            try {
                await job.updateProgress(5)

                processedVideo =
                    await ProcessedVideo.create({
                        sourceUrl: mp4Url,

                        processingStatus:
                            'processing',
                    })

                await job.updateProgress(10)

                const result =
                    await processVideoToHls({
                        mp4Url,

                        processedVideoId:
                            processedVideo._id,
                    })

                await job.updateProgress(90)

                const updatedProcessedVideo =
                    await ProcessedVideo.findByIdAndUpdate(
                        processedVideo._id,
                        {
                            ...result,

                            processingStatus:
                                'completed',
                        },
                        {
                            new: true,
                        }
                    )

                /**
                 * OPTIONAL
                 *
                 * Link processed video
                 * into original model
                 */

                if (
                    sourceId &&
                    sourceModel
                ) {
                    let Model

                    if (sourceModel === 'SwapTemplate') {
                        Model = SwapTemplate
                    }
                    if (sourceModel === 'MediaStore') {
                        Model = MediaStore
                    }

                    if(sourceModel === 'PixverseprompttemplateModel'){
                        Model = PixverseprompttemplateModel
                    }

                    if (Model) {
                        await Model.findByIdAndUpdate(
                            sourceId,
                            {
                                processedVideoId:
                                    updatedProcessedVideo._id,
                                streamType: 'hls',
                            }
                        )
                    }
                }



                await job.updateProgress(100)

                return {
                    success: true,

                    processedVideoId:
                        updatedProcessedVideo._id,

                    masterPlaylistUrl:
                        updatedProcessedVideo.masterPlaylistUrl,
                }
            } catch (error) {
                console.error(
                    'VIDEO_PROCESSING_FAILED',
                    error
                )

                if (processedVideo?._id) {
                    await ProcessedVideo.findByIdAndUpdate(
                        processedVideo._id,
                        {
                            processingStatus:
                                'failed',

                            processingError:
                                error.message,
                        }
                    )
                }

                throw error
            }
        },

        {
            connection: redisClient,

            concurrency: 1,

            removeOnComplete: {
                age: 60 * 60 * 24,
            },

            removeOnFail: false,
        }
    )

videoHlsWorker.on(
    'completed',
    async (job) => {
        console.log(
            `VIDEO_JOB_COMPLETED :: ${job.id}`
        )
    }
)

videoHlsWorker.on(
    'failed',
    async (job, error) => {
        console.error(
            `VIDEO_JOB_FAILED :: ${job?.id}`,
            error
        )
    }
)

videoHlsWorker.on(
    'error',
    async (error) => {
        console.error(
            'VIDEO_WORKER_ERROR',
            error
        )
    }
)