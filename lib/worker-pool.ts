import { ImageProcessor } from "./image-processor";

/**
 * Worker Pool pentru procesare paralelă de imagini
 * Simulează un cluster de worker threads pentru Big Data processing
 * Cu Producer-Consumer pattern: 1 coordinator + N workers
 */
export class WorkerPool {
  private workers: Worker[];
  private currentWorkerIndex: number;
  private processor: ImageProcessor;
  private concurrentLimit: number;
  private activeProcessing: number;
  private taskQueue: Array<QueuedTask>;
  private isProcessingQueue: boolean;
  private onAssignCallback?: (workerId: number, queueSize: number, imageId?: string) => void;

  constructor(workerCount: number = 4) {
    this.workers = Array.from({ length: workerCount }, (_, i) => ({
      id: i,
      busy: false,
      processed: 0,
    }));
    this.currentWorkerIndex = 0;
    this.processor = new ImageProcessor();
    this.concurrentLimit = workerCount;
    this.activeProcessing = 0;
    this.taskQueue = [];
    this.isProcessingQueue = false;

    console.log(`✓ Worker Pool initialized with ${workerCount} workers + 1 coordinator`);
  }

  /**
   * Set callback pentru când coordinator assignează un task
   */
  setOnAssignCallback(callback: (workerId: number, queueSize: number, imageId?: string) => void) {
    this.onAssignCallback = callback;
  }

  private getNextWorker(): Worker {
    // Strategy 1: Găsește primul worker LIBER (idle)
    const idleWorker = this.workers.find(w => !w.busy);
    if (idleWorker) {
      idleWorker.processed++;
      return idleWorker;
    }
    
    // Strategy 2: Dacă toți sunt busy, alege worker-ul cu cele mai puține task-uri procesate (load balancing)
    const leastBusyWorker = this.workers.reduce((min, worker) => 
      worker.processed < min.processed ? worker : min
    );
    leastBusyWorker.processed++;
    return leastBusyWorker;
  }

  /**
   * Coordinator thread - distribuie task-uri către workers
   */
  private async processQueueCoordinator() {
    if (this.isProcessingQueue) return; // Coordinator deja activ
    this.isProcessingQueue = true;

    while (true) {
      // Dacă queue-ul e gol ȘI nu mai sunt task-uri active, ieși
      if (this.taskQueue.length === 0) {
        if (this.activeProcessing === 0) {
          // Așteaptă puțin să vadă dacă mai vin task-uri
          await new Promise((resolve) => setTimeout(resolve, 100));
          if (this.taskQueue.length === 0 && this.activeProcessing === 0) {
            break; // Gata, chiar nu mai sunt task-uri
          }
        } else {
          // Mai sunt task-uri active, așteaptă
          await new Promise((resolve) => setTimeout(resolve, 50));
          continue;
        }
      }

      // Așteaptă ca un worker să se elibereze
      while (this.activeProcessing >= this.concurrentLimit) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      const queueSizeBeforeShift = this.taskQueue.length;
      const task = this.taskQueue.shift();
      if (!task) continue;

      // Coordinator: Assign task to next available worker (fără await - fire and forget)
      this.executeTask(task, queueSizeBeforeShift - 1).catch((error) => {
        console.error("Task execution error:", error);
        task.reject(error);
      });
    }

    this.isProcessingQueue = false;
  }

  /**
   * Worker execution - procesează o imagine
   */
  private async executeTask(task: QueuedTask, initialQueueSize: number) {
    this.activeProcessing++;
    const worker = this.getNextWorker();
    worker.busy = true;

    // Notifică callback IMEDIAT când task-ul e assignat (cu queue size și imageId)
    if (this.onAssignCallback) {
      this.onAssignCallback(worker.id, initialQueueSize, task.imageId);
    }

    try {
      console.log(
        `Coordinator → Worker ${worker.id} | Queue: ${initialQueueSize} pending | Total processed: ${worker.processed}`
      );
      
      const result = await this.processor.processImage(task.base64Image);
      task.resolve({ result, workerId: worker.id });
    } catch (error) {
      task.reject(error);
    } finally {
      worker.busy = false;
      this.activeProcessing--;
    }
  }

  /**
   * Producer: Adaugă task în queue și activează coordinator
   */
  async processImage(base64Image: string, imageId?: string): Promise<{ result: string; workerId: number }> {
    return new Promise((resolve, reject) => {
      // Producer: Push task to queue
      this.taskQueue.push({
        base64Image,
        imageId,
        resolve,
        reject,
      });

      // Start coordinator thread dacă nu rulează deja (non-blocking)
      if (!this.isProcessingQueue) {
        this.processQueueCoordinator().catch((error) => {
          console.error("Coordinator error:", error);
        });
      }
    });
  }

  getStats() {
    return {
      workers: this.workers.map((w) => ({
        id: w.id,
        busy: w.busy,
        processed: w.processed,
      })),
      activeProcessing: this.activeProcessing,
      queueSize: this.taskQueue.length,
      coordinatorActive: this.isProcessingQueue,
    };
  }
}

interface Worker {
  id: number;
  busy: boolean;
  processed: number;
}

interface QueuedTask {
  base64Image: string;
  imageId?: string;
  resolve: (value: { result: string; workerId: number }) => void;
  reject: (error: any) => void;
}
