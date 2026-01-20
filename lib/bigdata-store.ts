import { openDB, DBSchema, IDBPDatabase } from 'idb';

interface ProcessingResult {
  id: string;
  filename: string;
  status: "queued" | "pending" | "processing" | "completed" | "error";
  description?: string;
  partition?: number;
  workerThread?: number;
  processingTime?: number;
  error?: string;
  timestamp: number;
}

interface BigDataDB extends DBSchema {
  results: {
    key: string;
    value: ProcessingResult;
    indexes: { 'by-status': string; 'by-timestamp': number };
  };
  stats: {
    key: string;
    value: any;
  };
}

class BigDataStore {
  private db: IDBPDatabase<BigDataDB> | null = null;
  private initPromise: Promise<void> | null = null;

  async init() {
    if (typeof window === 'undefined') return; // SSR protection
    if (this.initPromise) return this.initPromise;
    
    this.initPromise = (async () => {
      this.db = await openDB<BigDataDB>('big-data-processor', 1, {
        upgrade(db) {
          // Results store cu indexuri pentru queries rapide
          const resultStore = db.createObjectStore('results', {
            keyPath: 'id',
          });
          resultStore.createIndex('by-status', 'status');
          resultStore.createIndex('by-timestamp', 'timestamp');

          // Stats store pentru metrici
          db.createObjectStore('stats', { keyPath: 'key' });
        },
      });
    })();

    return this.initPromise;
  }

  async addResult(result: ProcessingResult) {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');
    await this.db.put('results', result);
  }

  async updateResult(id: string, updates: Partial<ProcessingResult>) {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');
    
    const existing = await this.db.get('results', id);
    if (existing) {
      await this.db.put('results', { ...existing, ...updates });
    }
  }

  async getResult(id: string): Promise<ProcessingResult | undefined> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');
    return this.db.get('results', id);
  }

  async getAllResults(): Promise<ProcessingResult[]> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');
    return this.db.getAll('results');
  }

  async getResultsByStatus(status: string): Promise<ProcessingResult[]> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');
    return this.db.getAllFromIndex('results', 'by-status', status);
  }

  async getResultCount(): Promise<number> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');
    return this.db.count('results');
  }

  async clearResults() {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');
    await this.db.clear('results');
  }

  async saveStats(stats: any) {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');
    await this.db.put('stats', { key: 'current', ...stats });
  }

  async getStats() {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');
    return this.db.get('stats', 'current');
  }
}

export const bigDataStore = new BigDataStore();
export type { ProcessingResult };
