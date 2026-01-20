import { NextRequest } from "next/server";
import { WorkerPool } from "@/lib/worker-pool";
import { DistributedStorage } from "@/lib/distributed-storage";
import { ImageProcessor } from "@/lib/image-processor";

// Simulare de distributed storage cu partitioning
const storage = new DistributedStorage();

// Worker pool pentru procesare paralelă
const workerPool = new WorkerPool(4); // 4 worker threads

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  // Procesează request-ul asincron (nu așteaptă)
  processRequest(req, writer).catch((error) => {
    console.error("Fatal processing error:", error);
  });

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

async function processRequest(
  req: NextRequest,
  writer: WritableStreamDefaultWriter
) {
  const encoder = new TextEncoder();
  let streamClosed = false;

  // Helper pentru a scrie în stream doar dacă este deschis
  const safeWrite = async (data: string) => {
    if (streamClosed) return;
    try {
      await writer.write(encoder.encode(data));
    } catch (error) {
      if (!streamClosed) {
        console.log("Stream closed by client");
        streamClosed = true;
      }
    }
  };

  try {
    const formData = await req.formData();
    const images = formData.getAll("images") as File[];
    const imageIds = formData.getAll("imageIds") as string[];

    console.log(`Received ${images.length} images for processing`);

    const stats = {
      total: images.length,
      completed: 0,
      pending: images.length,
      processing: 0,
      errors: 0,
    };

    // Stream stats inițiale
    await safeWrite(`data: ${JSON.stringify({ type: "stats", stats })}\n\n`);

    // Log inițial
    await safeWrite(
      `data: ${JSON.stringify({
        type: "log",
        logType: "info",
        message: ` Received batch of ${images.length} images`,
      })}\n\n`
    );

    // Send worker stats
    const sendWorkerStats = async () => {
      const workerStatsData = workerPool.getStats();
      await safeWrite(
        `data: ${JSON.stringify({
          type: "workers",
          workers: workerStatsData.workers,
        })}\n\n`
      );
    };

    // Send partition stats
    const sendPartitionStats = async () => {
      const storageStats = storage.getStats();
      await safeWrite(
        `data: ${JSON.stringify({
          type: "partitions",
          partitions: storageStats.partitions,
        })}\n\n`
      );
    };

    // Send inițial workers și partitions
    await sendWorkerStats();
    await sendPartitionStats();

    // Map pentru a ține evidența imaginilor și a le marca ca "processing"
    const imageMetadata = new Map<string, { partition: number }>();

    // Setup callback pentru coordinator logging și status update
    workerPool.setOnAssignCallback(async (workerId: number, queueSize: number, imageId?: string) => {
      await safeWrite(
        `data: ${JSON.stringify({
          type: "log",
          logType: "worker",
          message: ` Coordinator → Worker ${workerId} (Queue: ${queueSize} remaining)`,
        })}\n\n`
      );

      // Marchează imaginea ca "processing" când worker-ul o preia
      if (imageId && imageMetadata.has(imageId)) {
        stats.pending--;
        stats.processing++;
        
        const metadata = imageMetadata.get(imageId)!;
        
        await safeWrite(
          `data: ${JSON.stringify({
            type: "result",
            id: imageId,
            status: "processing",
            partition: metadata.partition,
            workerThread: workerId,
          })}\n\n`
        );
        await safeWrite(`data: ${JSON.stringify({ type: "stats", stats })}\n\n`);
      }

      //  Trimite worker stats IMEDIAT când worker devine busy
      await sendWorkerStats();
    });

    //  PRIMUL: Pregătește TOATE imaginile și adaugă task-uri în queue IMEDIAT
    const imageTaskData: Array<{
      imageId: string;
      partition: number;
      base64Image: string;
      startTime: number;
    }> = [];

    // Procesează toate imaginile și adaugă-le în queue
    for (let idx = 0; idx < images.length; idx++) {
      const image = images[idx];
      const imageId = imageIds[idx] || `img-${idx}`;
      const startTime = Date.now();
      
      // Determine partition
      const partition = storage.getPartition(imageId);

      await safeWrite(
        `data: ${JSON.stringify({
          type: "log",
          logType: "partition",
          message: ` ${imageId} → Partition ${partition} (consistent hashing)`,
        })}\n\n`
      );

      // Convert to base64
      const buffer = await image.arrayBuffer();
      const base64Image = Buffer.from(buffer).toString("base64");

      // Storage
      await storage.store(imageId, {
        filename: image.name,
        size: image.size,
        data: base64Image.substring(0, 100),
      });

      await sendPartitionStats();

      await safeWrite(
        `data: ${JSON.stringify({
          type: "log",
          logType: "info",
          message: `✓ ${imageId} stored with replication factor 2x`,
        })}\n\n`
      );

      // Salvează metadata
      imageMetadata.set(imageId, { partition });

      // Salvează pentru procesare
      imageTaskData.push({ imageId, partition, base64Image, startTime });
    }

    //  AL DOILEA: Adaugă TOATE task-urile în queue SIMULTAN (nu aștepta)
    const processingPromises = imageTaskData.map(({ imageId, partition, base64Image, startTime }) => {
      // Returnează promise-ul direct, NU aștepta aici
      return workerPool.processImage(base64Image, imageId).then(({ result: description, workerId: workerThread }) => {
        const processingTime = Date.now() - startTime;

        // Update status: completed
        stats.processing--;
        stats.completed++;
        
        return safeWrite(
          `data: ${JSON.stringify({
            type: "result",
            id: imageId,
            status: "completed",
            description,
            partition,
            workerThread,
            processingTime,
          })}\n\n`
        ).then(() => safeWrite(`data: ${JSON.stringify({ type: "stats", stats })}\n\n`))
          .then(() => sendWorkerStats()) // Worker devine idle
          .then(() => {
            console.log(
              ` ${imageId} processed in ${processingTime}ms by worker ${workerThread} (partition ${partition})`
            );
          });
      }).catch((error) => {
        const processingTime = Date.now() - startTime;
        
        // Dacă era în processing, scade processing; altfel scade pending
        if (stats.processing > 0) {
          stats.processing--;
        } else {
          stats.pending--;
        }
        stats.errors++;

        return safeWrite(
          `data: ${JSON.stringify({
            type: "result",
            id: imageId,
            status: "error",
            error: (error as Error).message,
            processingTime,
          })}\n\n`
        ).then(() => safeWrite(`data: ${JSON.stringify({ type: "stats", stats })}\n\n`))
          .then(() => safeWrite(
            `data: ${JSON.stringify({
              type: "log",
              logType: "error",
              message: ` ${imageId} failed: ${(error as Error).message}`,
            })}\n\n`
          ))
          .then(() => {
            console.error(` ${imageId} failed:`, error);
          });
      });
    });

    // Așteaptă finalizarea tuturor procesărilor
    await Promise.all(processingPromises);

    // Final stats
    await sendWorkerStats();
    await sendPartitionStats();

    await safeWrite(
      `data: ${JSON.stringify({
        type: "log",
        logType: "success",
        message: ` Batch completed: ${stats.completed} success, ${stats.errors} errors`,
      })}\n\n`
    );

    console.log(
      `Processing completed: ${stats.completed} success, ${stats.errors} errors`
    );
  } catch (error) {
    console.error("Request processing error:", error);
    await safeWrite(
      `data: ${JSON.stringify({
        type: "error",
        message: (error as Error).message,
      })}\n\n`
    );
  } finally {
    // Închide stream-ul doar dacă nu e deja închis
    if (!streamClosed) {
      try {
        await writer.close();
      } catch (error) {
        // Ignoră erorile la închidere - stream-ul e deja închis
        console.log("Stream already closed");
      }
    }
  }
}
