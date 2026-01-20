"use client";

import { useCallback, useState, useEffect, useRef } from "react";
import { useDropzone } from "react-dropzone";
import { bigDataStore } from "@/lib/bigdata-store";
import { FixedSizeList as List } from "react-window";

// Import DB utils pentru debugging în console
if (typeof window !== 'undefined') {
  import("@/lib/db-utils");
}

interface ProcessingResult {
  id: string;
  filename: string;
  status: "queued" | "pending" | "processing" | "completed" | "error";
  description?: string;
  partition?: number;
  workerThread?: number;
  processingTime?: number;
  error?: string;
  timestamp?: number;
}

interface WorkerStatus {
  id: number;
  busy: boolean;
  processed: number;
  currentTask?: string;
}

interface PartitionStats {
  id: number;
  itemCount: number;
  size: number;
}

interface LogEntry {
  timestamp: number;
  type: "info" | "success" | "error" | "worker" | "partition";
  message: string;
}

export default function Home() {
  const [fileCount, setFileCount] = useState(0);
  const [results, setResults] = useState<ProcessingResult[]>([]);
  const [processing, setProcessing] = useState(false);
  const [stats, setStats] = useState({
    total: 0,
    completed: 0,
    pending: 0,
    processing: 0,
    errors: 0,
  });
  const [workerStats, setWorkerStats] = useState<WorkerStatus[]>([]);
  const [partitionStats, setPartitionStats] = useState<PartitionStats[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showBigDataDashboard, setShowBigDataDashboard] = useState(true);
  const fileQueueRef = useRef<File[]>([]);
  const [useVirtualScroll, setUseVirtualScroll] = useState(false);
  
  // Big Data Ingestion
  const [showBulkIngestion, setShowBulkIngestion] = useState(false);
  const [bulkSource, setBulkSource] = useState<'url' | 'unsplash' | 'dataset'>('url');
  const [imageUrls, setImageUrls] = useState('');
  const [unsplashCount, setUnsplashCount] = useState(100);
  const [unsplashQuery, setUnsplashQuery] = useState('nature');
  const [datasetUrl, setDatasetUrl] = useState('');
  const [ingesting, setIngesting] = useState(false);

  // Încarcă rezultate din IndexedDB la mount
  useEffect(() => {
    const loadResults = async () => {
      if (typeof window === 'undefined') return; // SSR protection
      
      const savedResults = await bigDataStore.getAllResults();
      if (savedResults.length > 0) {
        setResults(savedResults);
        setFileCount(savedResults.length);
        setUseVirtualScroll(savedResults.length > 100);
        addLog("info", `Loaded ${savedResults.length} results from IndexedDB`);
      }
    };
    loadResults();
  }, []);

  const addLog = (type: LogEntry["type"], message: string) => {
    setLogs((prev) => [
      { timestamp: Date.now(), type, message },
      ...prev.slice(0, 99), // Keep only last 100 logs
    ]);
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    // BIG DATA: Nu stocăm în state, doar în queue
    fileQueueRef.current = [...fileQueueRef.current, ...acceptedFiles];
    setFileCount((prev) => prev + acceptedFiles.length);
    
    // Enable virtual scroll pentru multe fișiere
    if (fileQueueRef.current.length > 100) {
      setUseVirtualScroll(true);
    }
    
    addLog("info", `Added ${acceptedFiles.length} images to queue (Total: ${fileQueueRef.current.length})`);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"] },
    multiple: true,
  });

  const processImages = async () => {
    if (fileQueueRef.current.length === 0) return;

    setProcessing(true);
    setResults([]);
    setLogs([]);
    await bigDataStore.clearResults();
    
    const totalFiles = fileQueueRef.current.length;
    addLog("info", `Starting Big Data processing for ${totalFiles} images`);
    addLog("info", `Initializing Worker Pool with 4 parallel workers`);
    addLog("info", `Distributed Storage: 8 partitions with 2x replication`);
    addLog("info", `IndexedDB persistence enabled for scalability`);

    // BIG DATA: Streaming upload - procesează batch câte batch
    // Batch size mai mare pentru ca workers să aibă mereu imagini în queue
    const BATCH_SIZE = 20; // Workers iau continuu imagini, nu așteaptă între batches

    // BIG DATA: Inițializează rezultate în IndexedDB cu status diferit per batch
    const initialResults: ProcessingResult[] = [];
    for (let idx = 0; idx < totalFiles; idx++) {
      const file = fileQueueRef.current[idx];
      // Generează ID din numele fișierului (fără extensie + index pentru unicitate)
      const fileNameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
      
      // Status: "pending" pentru primul batch, "queued" pentru restul
      const isInFirstBatch = idx < BATCH_SIZE;
      const status: ProcessingResult["status"] = isInFirstBatch ? "pending" : "queued";
      const result: ProcessingResult = {
        id: `${fileNameWithoutExt}-${idx}`,
        filename: file.name,
        status,
        timestamp: Date.now(),
      };
      // Ensure timestamp is always a number
      const resultWithTimestamp = { ...result, timestamp: result.timestamp ?? Date.now() };
      await bigDataStore.addResult(resultWithTimestamp as any);
      initialResults.push(result);
    }
    setResults(initialResults);

    try {
      const batches = [];
      
      for (let i = 0; i < totalFiles; i += BATCH_SIZE) {
        batches.push({ start: i, end: Math.min(i + BATCH_SIZE, totalFiles) });
      }

      addLog("info", `Split into ${batches.length} batches (${BATCH_SIZE} images/batch)`);

      // Process batches
      for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
        const batch = batches[batchIdx];
        const formData = new FormData();
        
        // Update status from "queued" to "pending" pentru imaginile din batch-ul curent
        if (batchIdx > 0) {
          for (let i = batch.start; i < batch.end; i++) {
            const file = fileQueueRef.current[i];
            const fileNameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
            const imageId = `${fileNameWithoutExt}-${i}`;
            
            // Update în IndexedDB și state
            await bigDataStore.updateResult(imageId, { status: "pending" });
            setResults((prev) =>
              prev.map((r) => (r.id === imageId ? { ...r, status: "pending" } : r))
            );
          }
        }
        
        // BIG DATA: Citește fișierele doar când sunt necesare
        for (let i = batch.start; i < batch.end; i++) {
          const file = fileQueueRef.current[i];
          const fileNameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
          formData.append("images", file);
          formData.append("imageIds", `${fileNameWithoutExt}-${i}`);
        }

        addLog("info", `Uploading batch ${batchIdx + 1}/${batches.length}`);

        // Upload batch și primește stream de rezultate
        const response = await fetch("/api/process", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        // Stream rezultatele
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split("\n").filter((line) => line.trim());

            for (const line of lines) {
              if (line.startsWith("data: ")) {
                try {
                  const data = JSON.parse(line.slice(6));
                  
                  if (data.type === "result") {
                    // BIG DATA: Update în IndexedDB
                    await bigDataStore.updateResult(data.id, {
                      status: data.status,
                      description: data.description,
                      partition: data.partition,
                      workerThread: data.workerThread,
                      processingTime: data.processingTime,
                      error: data.error,
                    });

                    // Update doar în state pentru UI reactivity
                    setResults((prev) =>
                      prev.map((r) =>
                        r.id === data.id
                          ? {
                              ...r,
                              status: data.status,
                              description: data.description,
                              partition: data.partition,
                              workerThread: data.workerThread,
                              processingTime: data.processingTime,
                              error: data.error,
                            }
                          : r
                      )
                    );

                    // Log doar la completed când avem worker ID real
                    if (data.status === "completed") {
                      addLog(
                        "success",
                        `${data.id} completed in ${data.processingTime}ms by Worker ${data.workerThread} (Partition ${data.partition})`
                      );
                    } else if (data.status === "error") {
                      addLog("error", `${data.id} failed: ${data.error}`);
                    }
                  } else if (data.type === "stats") {
                    setStats(data.stats);
                    await bigDataStore.saveStats(data.stats);
                  } else if (data.type === "workers") {
                    setWorkerStats(data.workers);
                  } else if (data.type === "partitions") {
                    setPartitionStats(data.partitions);
                    if (data.message) {
                      addLog("partition", data.message);
                    }
                  } else if (data.type === "log") {
                    addLog(data.logType || "info", data.message);
                  }
                } catch (e) {
                  console.error("Parse error:", e);
                }
              }
            }
          }
        }

        // BIG DATA: Garbage collect batch
        formData.delete("images");
      }

      addLog("success", `Processing completed! ${stats.completed} successful, ${stats.errors} errors`);
    } catch (error) {
      console.error("Processing error:", error);
      addLog("error", `Processing error: ${(error as Error).message}`);
      alert("Eroare la procesare: " + (error as Error).message);
    } finally {
      setProcessing(false);
    }
  };

  const clearAll = () => {
    fileQueueRef.current = [];
    setFileCount(0);
    setResults([]);
    setStats({ total: 0, completed: 0, pending: 0, processing: 0, errors: 0 });
    setWorkerStats([]);
    setPartitionStats([]);
    setLogs([]);
    bigDataStore.clearResults();
    addLog("info", "System reset");
  };

  // Bulk ingestion from URLs
  const ingestFromUrls = async () => {
    const urls = imageUrls.split('\n').filter(url => url.trim());
    if (urls.length === 0) {
      alert('Please enter at least one image URL');
      return;
    }

    setIngesting(true);
    addLog("info", `Starting bulk ingestion from ${urls.length} URLs`);

    try {
      const formData = new FormData();
      formData.append('datasetName', 'url-batch');
      formData.append('batchSize', '50');

      // Download images from URLs
      for (let i = 0; i < urls.length; i++) {
        try {
          addLog("info", `Downloading ${i + 1}/${urls.length}: ${urls[i]}`);
          
          const response = await fetch(urls[i]);
          const blob = await response.blob();
          const filename = `url-${i}.${blob.type.split('/')[1] || 'jpg'}`;
          formData.append('images', blob, filename);

          if ((i + 1) % 10 === 0) {
            addLog("info", `Progress: ${i + 1}/${urls.length} downloaded`);
          }
        } catch (error) {
          addLog("error", `Failed to download ${urls[i]}: ${(error as Error).message}`);
        }
      }

      // Send to ingestion API
      addLog("info", 'Sending to processing queue...');
      const response = await fetch('/api/ingest', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Ingestion failed: ${response.status}`);
      }

      addLog("success", `Successfully queued ${urls.length} images for processing`);
      setImageUrls('');
      setShowBulkIngestion(false);
    } catch (error) {
      addLog("error", `Ingestion error: ${(error as Error).message}`);
    } finally {
      setIngesting(false);
    }
  };

  // Bulk ingestion from Unsplash
  const ingestFromUnsplash = async () => {
    setIngesting(true);
    addLog("info", `Downloading ${unsplashCount} images from Unsplash (${unsplashQuery})`);

    try {
      const formData = new FormData();
      formData.append('datasetName', `unsplash-${unsplashQuery}`);
      formData.append('batchSize', '50');

      for (let i = 0; i < unsplashCount; i++) {
        try {
          const url = `https://source.unsplash.com/800x600/?${unsplashQuery}&sig=${Date.now()}-${i}`;
          addLog("info", `Downloading ${i + 1}/${unsplashCount} from Unsplash`);
          
          const response = await fetch(url);
          const blob = await response.blob();
          formData.append('images', blob, `unsplash-${unsplashQuery}-${i}.jpg`);

          if ((i + 1) % 25 === 0) {
            addLog("info", `Progress: ${i + 1}/${unsplashCount} downloaded`);
          }

          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          addLog("error", `Failed to download image ${i}: ${(error as Error).message}`);
        }
      }

      addLog("info", 'Sending to processing queue...');
      const response = await fetch('/api/ingest', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Ingestion failed: ${response.status}`);
      }

      addLog("success", `Successfully queued ${unsplashCount} images for processing`);
      setShowBulkIngestion(false);
    } catch (error) {
      addLog("error", `Ingestion error: ${(error as Error).message}`);
    } finally {
      setIngesting(false);
    }
  };

  // Bulk ingestion from dataset URL
  const ingestFromDataset = async () => {
    if (!datasetUrl.trim()) {
      alert('Please enter a dataset URL');
      return;
    }

    setIngesting(true);
    addLog("info", `Starting dataset ingestion from ${datasetUrl}`);

    try {
      const response = await fetch('/api/ingest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          datasetUrl,
          type: 'remote',
        }),
      });

      if (!response.ok) {
        throw new Error(`Ingestion failed: ${response.status}`);
      }

      // Stream the results
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n').filter(line => line.trim());

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                
                if (data.type === 'log') {
                  addLog(data.logType || 'info', data.message);
                } else if (data.type === 'complete') {
                  addLog("success", data.message);
                }
              } catch (e) {
                console.error('Parse error:', e);
              }
            }
          }
        }
      }

      setDatasetUrl('');
      setShowBulkIngestion(false);
    } catch (error) {
      addLog("error", `Ingestion error: ${(error as Error).message}`);
    } finally {
      setIngesting(false);
    }
  };

  return (
    <div className="min-h-screen p-8 bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 text-white">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-5xl font-bold mb-2 bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
                Big Data Image Processor
              </h1>
              <p className="text-gray-300 text-lg">
                Distributed Processing | Parallel Workers | Partitioned Storage | Real-time Streaming
              </p>
            </div>
            <button
              onClick={() => setShowBigDataDashboard(!showBigDataDashboard)}
              className="px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg font-semibold transition"
            >
              {showBigDataDashboard ? "Hide" : "Show"} Big Data Dashboard
            </button>
          </div>
        </div>

        {/* Big Data Dashboard */}
        {showBigDataDashboard && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* Worker Pool Status */}
            <div className="bg-gray-800 rounded-lg p-6 shadow-2xl border border-gray-700">
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                Worker Pool Status
                <span className="text-sm font-normal text-gray-400">
                  (Parallel Processing)
                </span>
              </h3>
              {workerStats.length > 0 ? (
                <div className="space-y-3">
                  {workerStats.map((worker) => (
                    <div
                      key={worker.id}
                      className={`p-3 rounded-lg border-2 ${
                        worker.busy
                          ? "bg-green-900 border-green-500"
                          : "bg-gray-700 border-gray-600"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-semibold">Worker {worker.id}</span>
                          <span className="ml-2 text-sm text-gray-300">
                            • {worker.processed} processed
                          </span>
                        </div>
                        <span
                          className={`px-3 py-1 rounded text-xs font-bold ${
                            worker.busy
                              ? "bg-green-500 text-white"
                              : "bg-gray-600 text-gray-300"
                          }`}
                        >
                          {worker.busy ? "BUSY" : "IDLE"}
                        </span>
                      </div>
                      {worker.currentTask && (
                        <div className="mt-2 text-xs text-gray-300">
                          Processing: {worker.currentTask}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-400 text-center py-8">
                  Workers will appear here during processing
                </p>
              )}
            </div>

            {/* Partition Distribution */}
            <div className="bg-gray-800 rounded-lg p-6 shadow-2xl border border-gray-700">
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                Partition Distribution
                <span className="text-sm font-normal text-gray-400">
                  (Distributed Storage)
                </span>
              </h3>
              {partitionStats.length > 0 ? (
                <div className="space-y-2">
                  {partitionStats.map((partition) => (
                    <div
                      key={partition.id}
                      className="flex items-center gap-3 p-2 bg-gray-700 rounded"
                    >
                      <div className="w-24 font-mono text-sm">
                        Partition {partition.id}
                      </div>
                      <div className="flex-1">
                        <div className="h-6 bg-gray-600 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300"
                            style={{
                              width: `${Math.min(
                                (partition.itemCount / Math.max(...partitionStats.map((p) => p.itemCount), 1)) * 100,
                                100
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                      <div className="w-20 text-right text-sm font-semibold">
                        {partition.itemCount} items
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-400 text-center py-8">
                  Partition stats will appear here during processing
                </p>
              )}
            </div>

            {/* Processing Logs */}
            <div className="bg-gray-800 rounded-lg p-6 shadow-2xl border border-gray-700 lg:col-span-2">
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                Real-time Processing Logs
                <span className="text-sm font-normal text-gray-400">
                  (Stream Processing)
                </span>
              </h3>
              <div className="bg-black rounded-lg p-4 h-64 overflow-y-auto font-mono text-sm space-y-1">
                {logs.length > 0 ? (
                  logs.map((log, idx) => (
                    <div
                      key={idx}
                      className={`${
                        log.type === "error"
                          ? "text-red-400"
                          : log.type === "success"
                          ? "text-green-400"
                          : log.type === "worker"
                          ? "text-blue-400"
                          : log.type === "partition"
                          ? "text-purple-400"
                          : "text-gray-300"
                      }`}
                    >
                      [{new Date(log.timestamp).toLocaleTimeString()}] {log.message}
                    </div>
                  ))
                ) : (
                  <p className="text-gray-500 text-center py-8">
                    Logs will appear here during processing
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Upload Zone */}
        <div
          {...getRootProps()}
          className={`border-4 border-dashed rounded-lg p-12 mb-8 text-center cursor-pointer transition-all ${
            isDragActive
              ? "border-blue-400 bg-blue-900 bg-opacity-20"
              : "border-gray-600 bg-gray-800 bg-opacity-50 hover:border-gray-500"
          }`}
        >
          <input {...getInputProps()} />
          <div className="text-6xl mb-4">FILES</div>
          {isDragActive ? (
            <p className="text-xl text-blue-300">Drop imaginile aici...</p>
          ) : (
            <div>
              <p className="text-xl mb-2">
                Drag & drop imagini sau click pentru a selecta
              </p>
              <p className="text-sm text-gray-400">
                Suportă procesare masivă - oricâte imagini
              </p>
            </div>
          )}
        </div>

        {/* Big Data Bulk Ingestion */}
        <div className="bg-gradient-to-r from-purple-900 to-blue-900 rounded-lg p-6 mb-8 shadow-2xl border-2 border-purple-500">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-2xl font-bold flex items-center gap-2">
                Big Data Bulk Ingestion
                <span className="text-sm font-normal text-gray-300">
                  (Ingest Thousands of Images Automatically)
                </span>
              </h2>
              <p className="text-sm text-gray-300 mt-1">
                Download and process large datasets directly from URLs, APIs, or remote sources
              </p>
            </div>
            <button
              onClick={() => setShowBulkIngestion(!showBulkIngestion)}
              className="px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg font-semibold transition"
            >
              {showBulkIngestion ? "Hide" : "Show"} Bulk Ingestion
            </button>
          </div>

          {showBulkIngestion && (
            <div className="bg-gray-900 rounded-lg p-6 space-y-4">
              {/* Source Selection */}
              <div className="flex gap-2">
                <button
                  onClick={() => setBulkSource('url')}
                  className={`flex-1 py-3 px-4 rounded-lg font-semibold transition ${
                    bulkSource === 'url'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  URL List
                </button>
                <button
                  onClick={() => setBulkSource('unsplash')}
                  className={`flex-1 py-3 px-4 rounded-lg font-semibold transition ${
                    bulkSource === 'unsplash'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  Unsplash API
                </button>
                <button
                  onClick={() => setBulkSource('dataset')}
                  className={`flex-1 py-3 px-4 rounded-lg font-semibold transition ${
                    bulkSource === 'dataset'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  Dataset URL
                </button>
              </div>

              {/* URL List Input */}
              {bulkSource === 'url' && (
                <div className="space-y-3">
                  <label className="block text-sm font-semibold text-gray-300">
                    Image URLs (one per line)
                  </label>
                  <textarea
                    value={imageUrls}
                    onChange={(e) => setImageUrls(e.target.value)}
                    placeholder="https://example.com/image1.jpg&#10;https://example.com/image2.jpg&#10;https://example.com/image3.jpg"
                    className="w-full h-40 bg-gray-800 text-white rounded-lg p-4 font-mono text-sm border border-gray-700 focus:border-blue-500 focus:outline-none"
                    disabled={ingesting}
                  />
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-400">
                      {imageUrls.split('\n').filter(u => u.trim()).length} URLs ready
                    </p>
                    <button
                      onClick={ingestFromUrls}
                      disabled={ingesting || !imageUrls.trim()}
                      className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {ingesting ? 'Ingesting...' : 'Start Bulk Ingestion'}
                    </button>
                  </div>
                </div>
              )}

              {/* Unsplash API Input */}
              {bulkSource === 'unsplash' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-300 mb-2">
                        Search Query
                      </label>
                      <input
                        type="text"
                        value={unsplashQuery}
                        onChange={(e) => setUnsplashQuery(e.target.value)}
                        placeholder="nature, architecture, people..."
                        className="w-full bg-gray-800 text-white rounded-lg p-3 border border-gray-700 focus:border-blue-500 focus:outline-none"
                        disabled={ingesting}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-300 mb-2">
                        Number of Images
                      </label>
                      <input
                        type="number"
                        value={unsplashCount}
                        onChange={(e) => setUnsplashCount(parseInt(e.target.value) || 100)}
                        min="1"
                        max="1000"
                        className="w-full bg-gray-800 text-white rounded-lg p-3 border border-gray-700 focus:border-blue-500 focus:outline-none"
                        disabled={ingesting}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between bg-yellow-900 bg-opacity-20 border border-yellow-700 rounded-lg p-3">
                    <p className="text-sm text-yellow-300">
                      Rate limited to ~10 images/second. {unsplashCount} images ≈ {Math.ceil(unsplashCount / 10)} seconds
                    </p>
                    <button
                      onClick={ingestFromUnsplash}
                      disabled={ingesting}
                      className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {ingesting ? 'Downloading...' : 'Download & Ingest'}
                    </button>
                  </div>
                </div>
              )}

              {/* Dataset URL Input */}
              {bulkSource === 'dataset' && (
                <div className="space-y-3">
                  <label className="block text-sm font-semibold text-gray-300">
                    Dataset URL (ImageNet, COCO, OpenImages, etc.)
                  </label>
                  <input
                    type="text"
                    value={datasetUrl}
                    onChange={(e) => setDatasetUrl(e.target.value)}
                    placeholder="http://www.image-net.org/api/text/imagenet.synset.geturls?wnid=n02084071"
                    className="w-full bg-gray-800 text-white rounded-lg p-3 border border-gray-700 focus:border-blue-500 focus:outline-none"
                    disabled={ingesting}
                  />
                  <div className="bg-blue-900 bg-opacity-20 border border-blue-700 rounded-lg p-4 space-y-2">
                    <p className="text-sm font-semibold text-blue-300">Example Dataset URLs:</p>
                    <ul className="text-xs text-gray-300 space-y-1 font-mono">
                      <li>• ImageNet: http://www.image-net.org/api/...</li>
                      <li>• COCO: http://images.cocodataset.org/...</li>
                      <li>• OpenImages: https://storage.googleapis.com/openimages/...</li>
                    </ul>
                  </div>
                  <div className="flex justify-end">
                    <button
                      onClick={ingestFromDataset}
                      disabled={ingesting || !datasetUrl.trim()}
                      className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {ingesting ? 'Ingesting...' : 'Ingest Dataset'}
                    </button>
                  </div>
                </div>
              )}

              {/* Quick Actions */}
              <div className="border-t border-gray-700 pt-4 mt-4">
                <p className="text-sm font-semibold text-gray-300 mb-3">Quick Start Templates:</p>
                <div className="grid grid-cols-3 gap-3">
                  <button
                    onClick={() => {
                      setBulkSource('unsplash');
                      setUnsplashQuery('nature');
                      setUnsplashCount(500);
                    }}
                    className="bg-gray-800 hover:bg-gray-700 rounded-lg p-3 text-left transition"
                  >
                    <div className="text-sm font-semibold">Nature Dataset</div>
                    <div className="text-xs text-gray-400">500 nature images</div>
                  </button>
                  <button
                    onClick={() => {
                      setBulkSource('unsplash');
                      setUnsplashQuery('architecture');
                      setUnsplashCount(1000);
                    }}
                    className="bg-gray-800 hover:bg-gray-700 rounded-lg p-3 text-left transition"
                  >
                    <div className="text-sm font-semibold">Architecture</div>
                    <div className="text-xs text-gray-400">1000 buildings</div>
                  </button>
                  <button
                    onClick={() => {
                      setBulkSource('unsplash');
                      setUnsplashQuery('people');
                      setUnsplashCount(2000);
                    }}
                    className="bg-gray-800 hover:bg-gray-700 rounded-lg p-3 text-left transition"
                  >
                    <div className="text-sm font-semibold">People</div>
                    <div className="text-xs text-gray-400">2000 portraits</div>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* File Count & Actions */}
        {fileCount > 0 && (
          <div className="bg-gray-800 rounded-lg p-6 mb-8 shadow-2xl border border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-2xl font-bold">
                  {fileCount} imagini în queue
                </p>
                <p className="text-sm text-gray-400">
                  {useVirtualScroll && (
                    <span className="text-green-400">Virtual scrolling enabled pentru performance</span>
                  )}
                  {!useVirtualScroll && "Standard rendering"}
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={clearAll}
                  disabled={processing}
                  className="px-6 py-3 bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition font-semibold"
                >
                  Clear All
                </button>
                <button
                  onClick={processImages}
                  disabled={processing}
                  className="px-8 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition font-semibold shadow-lg"
                >
                  {processing ? "Processing..." : "Process Images"}
                </button>
              </div>
            </div>

            {/* Stats Dashboard */}
            {stats.total > 0 && (
              <div className="grid grid-cols-5 gap-4 pt-4 border-t border-gray-700">
                <div className="text-center bg-gray-700 rounded-lg p-3">
                  <div className="text-2xl font-bold">{stats.total}</div>
                  <div className="text-sm text-gray-400">Total</div>
                </div>
                <div className="text-center bg-yellow-900 bg-opacity-40 rounded-lg p-3">
                  <div className="text-2xl font-bold text-yellow-400">{stats.pending}</div>
                  <div className="text-sm text-gray-400">Pending</div>
                </div>
                <div className="text-center bg-blue-900 bg-opacity-40 rounded-lg p-3">
                  <div className="text-2xl font-bold text-blue-400">{stats.processing}</div>
                  <div className="text-sm text-gray-400">Processing</div>
                </div>
                <div className="text-center bg-green-900 bg-opacity-40 rounded-lg p-3">
                  <div className="text-2xl font-bold text-green-400">{stats.completed}</div>
                  <div className="text-sm text-gray-400">Completed</div>
                </div>
                <div className="text-center bg-red-900 bg-opacity-40 rounded-lg p-3">
                  <div className="text-2xl font-bold text-red-400">{stats.errors}</div>
                  <div className="text-sm text-gray-400">Errors</div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Results Grid */}
        {results.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold flex items-center gap-2">
                Rezultate procesare
                <span className="text-sm font-normal text-gray-400">
                  ({results.length} items) {useVirtualScroll && "- Virtual Scroll"}
                </span>
              </h2>
              {results.length > 100 && (
                <button
                  onClick={() => setUseVirtualScroll(!useVirtualScroll)}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm transition"
                >
                  {useVirtualScroll ? "Disable" : "Enable"} Virtual Scroll
                </button>
              )}
            </div>

            {useVirtualScroll ? (
              // BIG DATA: Virtual Scrolling - render doar 50 items vizibili
              <div className="border border-gray-700 rounded-lg">
                <List
                  height={600}
                  itemCount={results.length}
                  itemSize={180}
                  width="100%"
                  className="bg-gray-900"
                >
                  {({ index, style }: { index: number; style: React.CSSProperties }) => {
                    const result = results[index];
                    return (
                      <div style={style} className="px-4 py-2">\n                        <div
                          className={`bg-gray-800 rounded-lg p-4 shadow-xl border-l-4 border border-gray-700 h-full ${
                            result.status === "completed"
                              ? "border-l-green-500"
                              : result.status === "processing"
                              ? "border-l-blue-500 animate-pulse"
                              : result.status === "error"
                              ? "border-l-red-500"
                              : result.status === "queued"
                              ? "border-l-yellow-500"
                              : "border-l-gray-500"
                          }`}
                        >
                          <div className="flex items-start justify-between mb-2">
                            <h3 className="font-semibold text-sm truncate flex-1">
                              {result.filename}
                            </h3>
                            <span
                              className={`text-xs px-2 py-1 rounded font-bold ${
                                result.status === "completed"
                                  ? "bg-green-600 text-white"
                                  : result.status === "processing"
                                  ? "bg-blue-600 text-white"
                                  : result.status === "error"
                                  ? "bg-red-600 text-white"
                                  : result.status === "queued"
                                  ? "bg-yellow-600 text-black"
                                  : "bg-gray-600 text-gray-300"
                              }`}
                            >
                              {result.status === "queued" ? "queued" : result.status}
                            </span>
                          </div>

                          {result.description && (
                            <p className="text-xs text-gray-300 mb-2 line-clamp-2">
                              {result.description}
                            </p>
                          )}

                          {result.error && (
                            <p className="text-xs text-red-400 mb-2">{result.error}</p>
                          )}

                          {(result.partition !== undefined || result.workerThread !== undefined) && (
                            <div className="text-xs text-gray-400 space-y-1 border-t border-gray-700 pt-2">
                              <div className="flex gap-2">
                                {result.partition !== undefined && (
                                  <span className="bg-purple-900 bg-opacity-40 px-2 py-1 rounded">
                                    P:{result.partition}
                                  </span>
                                )}
                                {result.workerThread !== undefined && (
                                  <span className="bg-blue-900 bg-opacity-40 px-2 py-1 rounded">
                                    W:{result.workerThread}
                                  </span>
                                )}
                                {result.processingTime && (
                                  <span className="bg-green-900 bg-opacity-40 px-2 py-1 rounded">
                                    {result.processingTime}ms
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  }}
                </List>
              </div>
            ) : (
              // Standard grid pentru < 100 items
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {results.map((result) => (
                  <div
                    key={result.id}
                    className={`bg-gray-800 rounded-lg p-4 shadow-xl border-l-4 border border-gray-700 ${
                      result.status === "completed"
                        ? "border-l-green-500"
                        : result.status === "processing"
                        ? "border-l-blue-500 animate-pulse"
                        : result.status === "error"
                        ? "border-l-red-500"
                        : result.status === "queued"
                        ? "border-l-yellow-500"
                        : "border-l-gray-500"
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-semibold text-sm truncate flex-1">
                        {result.filename}
                      </h3>
                      <span
                        className={`text-xs px-2 py-1 rounded font-bold ${
                          result.status === "completed"
                            ? "bg-green-600 text-white"
                            : result.status === "processing"
                            ? "bg-blue-600 text-white"
                            : result.status === "error"
                            ? "bg-red-600 text-white"
                            : result.status === "queued"
                            ? "bg-yellow-600 text-black"
                            : "bg-gray-600 text-gray-300"
                        }`}
                      >
                        {result.status === "queued" ? "queued" : result.status}
                      </span>
                    </div>

                    {result.description && (
                      <p className="text-sm text-gray-300 mb-3 line-clamp-3">
                        {result.description}
                      </p>
                    )}

                    {result.error && (
                      <p className="text-sm text-red-400 mb-3">{result.error}</p>
                    )}

                    {(result.partition !== undefined || result.workerThread !== undefined) && (
                      <div className="text-xs text-gray-400 space-y-1 border-t border-gray-700 pt-2">
                        {result.partition !== undefined && (
                          <div className="flex items-center gap-2">
                            <span className="bg-purple-900 bg-opacity-40 px-2 py-1 rounded">
                              Partition: {result.partition}
                            </span>
                          </div>
                        )}
                        {result.workerThread !== undefined && (
                          <div className="flex items-center gap-2">
                            <span className="bg-blue-900 bg-opacity-40 px-2 py-1 rounded">
                              Worker: {result.workerThread}
                            </span>
                          </div>
                        )}
                        {result.processingTime && (
                          <div className="flex items-center gap-2">
                            <span className="bg-green-900 bg-opacity-40 px-2 py-1 rounded">
                              Time: {result.processingTime}ms
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
