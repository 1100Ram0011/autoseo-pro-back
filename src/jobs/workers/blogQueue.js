import { Worker } from 'bullmq';
import Blog from '../../models/blog/Blog.model.js';
import redisClient from '../../config/redis.js';
import { blogPublishQueue } from '../../queue/index.js';
import { publishArticle as publishToDevto } from '../../services/devto.service.js';
import { publishToBlogger } from '../../services/blogger.service.js';

// ─── Worker ──────────────────────────────────────────────────────────────────
const worker = new Worker('publish-blog', async (job) => {
  const { blogId } = job.data;
  console.log(`\n🔄 Processing job ${job.id} for blog ${blogId}`);

  const blog = await Blog.findById(blogId);
  if (!blog) throw new Error(`Blog not found: ${blogId}`);

  await blog.markAsPublishing();

  const blogData = {
    title:      blog.title,
    content:    blog.content,
    tags:       blog.tags,
    coverImage: blog.coverImage,
  };

  const targetPlatforms = job.data.platforms || ['devto'];
  
  let devtoPayload = null;
  let bloggerPayload = null;
  const errors = [];

  if (targetPlatforms.includes('devto')) {
    console.log('🚀 Dev.to pe publish kar rahe hain...');
    try {
      const r = await publishToDevto({ ...blogData, coverImageUrl: blog.coverImage });
      devtoPayload = { success: true, platform: 'devto', url: r.devtoUrl, id: r.devtoId };
      console.log(`✅ Dev.to published! URL: ${r.devtoUrl}`);
    } catch (error) {
      console.error(`❌ Dev.to failed: ${error.message}`);
      errors.push(`Dev.to error: ${error.message}`);
    }
  }
  
  if (targetPlatforms.includes('blogger')) {
    console.log('🚀 Blogger pe publish kar rahe hain...');
    try {
      const r = await publishToBlogger(blogData, blog.author);
      bloggerPayload = { success: true, platform: 'blogger', url: r.bloggerUrl, id: r.bloggerId };
      console.log(`✅ Blogger published! URL: ${r.bloggerUrl}`);
    } catch (error) {
      console.error(`❌ Blogger failed: ${error.message}`);
      errors.push(`Blogger error: ${error.message}`);
    }
  }

  const successfulResults = [devtoPayload, bloggerPayload].filter(Boolean);

  // If ALL targeted platforms failed
  if (successfulResults.length === 0) {
    const errorMsg = errors.join(' | ');
    throw new Error(errorMsg);
  }

  // ─── DB update karo ───────────────────────────────────────────────────────
  const partialError = errors.length > 0 ? errors.join(' | ') : null;
  await blog.markAsPublished(successfulResults, partialError);
  console.log(`🎉 Blog ${blogId} published on: ${successfulResults.map(r => r.platform).join(', ')}`);

  return {
    platforms:   successfulResults.map(r => r.platform),
    devtoUrl:    devtoPayload?.url    || null,
    bloggerUrl:  bloggerPayload?.url  || null,
    partialError: partialError
  };
}, {
  connection:   redisClient.duplicate(),
  skipVersionCheck: true,
  concurrency:  1,
});

// ─── Events ──────────────────────────────────────────────────────────────────
worker.on('completed', (job) => {
  console.log(`✅ Job ${job.id} completed!`);
});

worker.on('failed', async (job, error) => {
  console.error(`❌ Job ${job.id} failed: ${error.message}`);
  if (job.attemptsMade >= (job.opts.attempts || 3)) {
    await Blog.findByIdAndUpdate(job.data.blogId, {
      status:       'failed',
      errorMessage: error.message,
    });
  }
});

worker.on('error', (err) => {
  console.error('❌ blogQueue worker error:', err.message);
});

// ─── Add Job Helper ───────────────────────────────────────────────────────────
export const addPublishJob = async (blog, platforms = ['devto']) => {
  const uniqueJobId = `blog-${blog._id.toString()}-${Date.now()}`;

  const job = await blogPublishQueue.add('publish-blog', {
    blogId: blog._id.toString(),
    platforms,
  }, {
    jobId:           uniqueJobId,
    attempts:        3,
    backoff:         { type: 'exponential', delay: 2000 },
    removeOnComplete: true,
    removeOnFail:    false,
  });

  console.log(`📬 Job ${job.id} added to queue for blog ${blog._id}`);
  return job;
};