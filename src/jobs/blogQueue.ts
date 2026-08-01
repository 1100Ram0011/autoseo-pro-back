import { Queue, Worker, QueueEvents } from 'bullmq';
import { redis } from '../config/redis';
import prisma from '../config/prisma';
import { generateBlogFromTitle } from '../services/blogGeneration.service';

export const BLOG_QUEUE_NAME = 'blog-generation-queue';

export const blogQueue = new Queue(BLOG_QUEUE_NAME, {
  connection: redis
});

export const blogQueueEvents = new QueueEvents(BLOG_QUEUE_NAME, {
  connection: redis
});

interface BlogJobData {
  siteId: string;
  selectedTitle: string;
  userId: string;
  blogPageUrl?: string;
}

export const blogWorker = new Worker<BlogJobData>(
  BLOG_QUEUE_NAME,
  async (job) => {
    const { siteId, selectedTitle, userId, blogPageUrl } = job.data;
    job.log(`Starting blog generation for title: ${selectedTitle}`);

    try {
      job.updateProgress({ percent: 10, label: "Generating content with Gemini..." });
      
      const { blogResult } = await generateBlogFromTitle(siteId, selectedTitle, blogPageUrl);
      
      job.updateProgress({ percent: 80, label: "Saving to database..." });

      const blog = await prisma.blog.create({
        data: {
          siteId,
          title: blogResult.title,
          content: blogResult.content,
          tags: JSON.stringify(blogResult.tags || []),
          status: 'draft',
          jobId: job.id
        }
      });

      job.updateProgress({ percent: 100, label: "Completed!" });
      
      return { success: true, blogId: blog.id, title: blog.title };
    } catch (error: any) {
      job.log(`Blog generation failed: ${error.message}`);
      throw error;
    }
  },
  { connection: redis, concurrency: 2 }
);

blogWorker.on('completed', async (job, result) => {
  console.log(`Blog job ${job.id} completed!`);
  // Update BlogSession to remove the active job
  try {
    const session = await prisma.blogSession.findUnique({ where: { userId: job.data.userId } });
    if (session && session.activeJobs) {
      let activeJobs = JSON.parse(session.activeJobs);
      activeJobs = activeJobs.filter((j: any) => j.jobId !== job.id);
      await prisma.blogSession.update({
        where: { userId: job.data.userId },
        data: { activeJobs: JSON.stringify(activeJobs) }
      });
    }
    // Also notify via socket if socketService exists
    // socketService.emitToUser(job.data.userId, 'blog:completed', result);
  } catch (err) {
    console.error('Failed to cleanup active job', err);
  }
});

blogWorker.on('failed', async (job, err) => {
  console.error(`Blog job ${job?.id} failed:`, err);
  if (job) {
    try {
      const session = await prisma.blogSession.findUnique({ where: { userId: job.data.userId } });
      if (session && session.activeJobs) {
        let activeJobs = JSON.parse(session.activeJobs);
        activeJobs = activeJobs.filter((j: any) => j.jobId !== job.id);
        await prisma.blogSession.update({
          where: { userId: job.data.userId },
          data: { activeJobs: JSON.stringify(activeJobs) }
        });
      }
    } catch (e) {
      console.error('Failed to cleanup failed active job', e);
    }
  }
});
