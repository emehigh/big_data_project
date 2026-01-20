import { NextResponse } from 'next/server';
import { imageQueue, ProcessingResult } from '@/lib/queue-manager';
import { getRedisClient } from '@/lib/redis-client';

// API endpoint for worker nodes to process jobs
export async function POST(request: Request) {
  const workerId = process.env.WORKER_ID || 'unknown';
  const partitions = process.env.PARTITIONS?.split(',').map(Number) || [];
  
  console.log(` Worker ${workerId} starting, assigned partitions: ${partitions.join(', ')}`);

  // Process jobs from the queue
  imageQueue.process(4, async (job) => {
    const { id, imageUrl, filename, partition, bucket } = job.data;
    
    // Check if this worker should handle this partition
    if (!partitions.includes(partition)) {
      throw new Error(`Worker ${workerId} not assigned to partition ${partition}`);
    }

    const startTime = Date.now();
    
    try {
      console.log(`[Worker ${workerId}] Processing ${id} (Partition ${partition})`);
      
      // Download image from S3
      const { downloadImage } = await import('@/lib/s3-storage');
      const imageBuffer = await downloadImage(imageUrl);
      
      // Process with AI
      const { ImageProcessor } = await import('@/lib/image-processor');
      const processor = new ImageProcessor();
      const description = await processor.processImage(imageBuffer.toString('base64'));
      
      const processingTime = Date.now() - startTime;
      
      // Store result
      const { storeResult } = await import('@/lib/s3-storage');
      await storeResult(id, {
        description,
        partition,
        workerId: parseInt(workerId),
        processingTime,
      });

      const result: ProcessingResult = {
        id,
        filename,
        status: 'completed',
        description,
        partition,
        workerThread: parseInt(workerId),
        processingTime,
      };

      console.log(`[Worker ${workerId}] ✓ Completed ${id} in ${processingTime}ms`);
      
      return result;
    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error(`[Worker ${workerId}] ✗ Failed ${id}:`, error);
      
      return {
        id,
        filename,
        status: 'error' as const,
        error: (error as Error).message,
        partition,
        workerThread: parseInt(workerId),
        processingTime,
      };
    }
  });

  return NextResponse.json({
    message: `Worker ${workerId} started`,
    partitions,
  });
}

// Health check endpoint
export async function GET() {
  const workerId = process.env.WORKER_ID || 'unknown';
  const partitions = process.env.PARTITIONS?.split(',').map(Number) || [];
  
  try {
    const redis = await getRedisClient();
    await redis.ping();
    
    const queueStats = await imageQueue.getJobCounts();
    
    return NextResponse.json({
      status: 'healthy',
      workerId,
      partitions,
      queue: queueStats,
      timestamp: Date.now(),
    });
  } catch (error) {
    return NextResponse.json({
      status: 'unhealthy',
      error: (error as Error).message,
    }, { status: 503 });
  }
}
