import { NextRequest, NextResponse } from 'next/server';
import { addImagesToQueue, ImageProcessingTask } from '@/lib/queue-manager';
import { uploadImages } from '@/lib/s3-storage';
import crypto from 'crypto';

// API endpoint for bulk dataset ingestion
export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  let streamClosed = false;

  // Safe write helper
  const safeWrite = async (data: string) => {
    if (streamClosed) return;
    try {
      await writer.write(encoder.encode(data));
    } catch (error) {
      streamClosed = true;
      console.error('Stream write error:', error);
    }
  };

  const sendEvent = async (type: string, data: any) => {
    await safeWrite(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  };

  // Start ingestion process
  (async () => {
    try {
      const formData = await request.formData();
      const images = formData.getAll('images') as File[];
      const datasetName = formData.get('datasetName') as string || 'unknown';
      const batchSize = parseInt(formData.get('batchSize') as string) || 100;

      await sendEvent('log', {
        logType: 'info',
        message: ` Starting ingestion: ${images.length} images from ${datasetName}`,
      });

      // Process in batches
      const batches = [];
      for (let i = 0; i < images.length; i += batchSize) {
        batches.push(images.slice(i, Math.min(i + batchSize, images.length)));
      }

      let totalIngested = 0;

      for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
        const batch = batches[batchIdx];
        
        await sendEvent('log', {
          logType: 'info',
          message: ` Processing batch ${batchIdx + 1}/${batches.length} (${batch.length} images)`,
        });

        // Convert images to buffers
        const imageBuffers = await Promise.all(
          batch.map(async (file, idx) => {
            const arrayBuffer = await file.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            const partition = crypto.createHash('md5').update(buffer).digest()[0] % 8;
            
            return {
              buffer,
              filename: file.name,
              partition,
            };
          })
        );

        // Upload to S3
        await sendEvent('log', {
          logType: 'info',
          message: `⬆ Uploading batch ${batchIdx + 1} to S3...`,
        });

        const uploadResults = await uploadImages(imageBuffers);

        // Add to processing queue
        const tasks: ImageProcessingTask[] = uploadResults.map((upload) => ({
          id: `img-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
          imageUrl: upload.key,
          filename: upload.filename,
          bucket: 'bigdata-images',
          partition: upload.partition,
          timestamp: Date.now(),
        }));

        await addImagesToQueue(tasks);
        totalIngested += tasks.length;

        await sendEvent('progress', {
          batchIndex: batchIdx + 1,
          totalBatches: batches.length,
          batchSize: batch.length,
          totalIngested,
          totalImages: images.length,
        });

        await sendEvent('log', {
          logType: 'success',
          message: ` Batch ${batchIdx + 1} ingested: ${batch.length} images added to queue`,
        });
      }

      await sendEvent('complete', {
        totalIngested,
        datasetName,
        message: ` Ingestion complete! ${totalIngested} images queued for processing`,
      });

    } catch (error) {
      console.error('Ingestion error:', error);
      await sendEvent('error', {
        message: ` Ingestion failed: ${(error as Error).message}`,
      });
    } finally {
      streamClosed = true;
      try {
        await writer.close();
      } catch (e) {
        // Stream already closed
      }
    }
  })();

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

// Get ingestion statistics
export async function GET() {
  try {
    const { getQueueStats } = await import('@/lib/queue-manager');
    const { getStorageStats } = await import('@/lib/s3-storage');

    const [queueStats, storageStats] = await Promise.all([
      getQueueStats(),
      getStorageStats(),
    ]);

    return NextResponse.json({
      queue: queueStats,
      storage: storageStats,
      timestamp: Date.now(),
    });
  } catch (error) {
    return NextResponse.json({
      error: (error as Error).message,
    }, { status: 500 });
  }
}
