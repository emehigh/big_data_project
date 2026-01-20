import Queue from 'bull';
import { getRedisClient } from './redis-client';

export interface ImageProcessingTask {
  id: string;
  imageUrl: string;
  filename: string;
  bucket: string;
  partition: number;
  timestamp: number;
}

export interface ProcessingResult {
  id: string;
  filename: string;
  status: 'completed' | 'error';
  description?: string;
  partition: number;
  workerThread: number;
  processingTime: number;
  error?: string;
}

// Create Bull queue for image processing
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const imageQueue = new Queue<ImageProcessingTask>('image-processing', REDIS_URL, {
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: 1000, // Keep last 1000 completed jobs
    removeOnFail: 5000, // Keep last 5000 failed jobs
  },
  settings: {
    maxStalledCount: 3,
    stalledInterval: 30000, // Check for stalled jobs every 30s
  },
});

// Priority queue for urgent processing
export const priorityQueue = new Queue<ImageProcessingTask>('priority-processing', REDIS_URL, {
  defaultJobOptions: {
    attempts: 3,
    priority: 1, // Higher priority
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  },
});

// Queue for dataset ingestion (bulk operations)
export const ingestionQueue = new Queue<{ datasetUrl: string; batchSize: number }>('dataset-ingestion', REDIS_URL, {
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    timeout: 600000, // 10 minutes per batch
  },
});

// Add image to processing queue
export async function addImageToQueue(task: ImageProcessingTask, priority = false): Promise<string> {
  const queue = priority ? priorityQueue : imageQueue;
  const job = await queue.add(task, {
    jobId: task.id,
    priority: priority ? 1 : 10,
  });
  return job.id.toString();
}

// Batch add images to queue
export async function addImagesToQueue(tasks: ImageProcessingTask[]): Promise<void> {
  const jobs = tasks.map(task => ({
    data: task,
    opts: {
      jobId: task.id,
    },
  }));
  
  await imageQueue.addBulk(jobs);
}

// Get queue statistics
export async function getQueueStats() {
  const [waiting, active, completed, failed, delayed, paused] = await Promise.all([
    imageQueue.getWaitingCount(),
    imageQueue.getActiveCount(),
    imageQueue.getCompletedCount(),
    imageQueue.getFailedCount(),
    imageQueue.getDelayedCount(),
    imageQueue.getPausedCount(),
  ]);

  return {
    waiting,
    active,
    completed,
    failed,
    delayed,
    paused,
    total: waiting + active + completed + failed + delayed + paused,
  };
}

// Clean old jobs
export async function cleanOldJobs() {
  await imageQueue.clean(3600000); // Remove jobs older than 1 hour
  await priorityQueue.clean(3600000);
  console.log('✓ Cleaned old jobs from queues');
}

// Get worker assignments (for monitoring)
export async function getWorkerAssignments() {
  const redisClient = await getRedisClient();
  const workers = await redisClient.keys('bull:image-processing:*:lock');
  
  return workers.map(key => {
    const match = key.match(/bull:image-processing:(\d+):lock/);
    return match ? parseInt(match[1]) : null;
  }).filter(Boolean);
}

// Pause/Resume queue
export async function pauseQueue() {
  await imageQueue.pause();
  console.log(' Queue paused');
}

export async function resumeQueue() {
  await imageQueue.resume();
  console.log(' Queue resumed');
}

// Graceful shutdown
export async function closeQueues() {
  await imageQueue.close();
  await priorityQueue.close();
  await ingestionQueue.close();
  console.log('✓ All queues closed');
}

// Event listeners for monitoring
imageQueue.on('completed', (job, result) => {
  console.log(`✓ Job ${job.id} completed in ${result.processingTime}ms`);
});

imageQueue.on('failed', (job, err) => {
  console.error(`✗ Job ${job?.id} failed:`, err.message);
});

imageQueue.on('stalled', (job) => {
  console.warn(`⚠ Job ${job.id} stalled, will retry`);
});

imageQueue.on('error', (error) => {
  console.error('Queue error:', error);
});

// Health check
export async function queueHealthCheck(): Promise<boolean> {
  try {
    await imageQueue.client.ping();
    return true;
  } catch (error) {
    console.error('Queue health check failed:', error);
    return false;
  }
}
