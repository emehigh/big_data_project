/**
 * Distributed Storage Simulation
 * Simulează un sistem de stocare distribuită cu partitioning și sharding
 * Similar cu HDFS (Hadoop Distributed File System) sau Cassandra
 */
export class DistributedStorage {
  private partitions: Map<number, Partition>;
  private partitionCount: number;
  private replicationFactor: number;

  constructor(partitionCount = 8, replicationFactor = 2) {
    this.partitionCount = partitionCount;
    this.replicationFactor = replicationFactor;
    this.partitions = new Map();

    // Inițializează partițiile
    for (let i = 0; i < partitionCount; i++) {
      this.partitions.set(i, {
        id: i,
        data: new Map(),
        size: 0,
        itemCount: 0,
      });
    }

    console.log(
      `✓ Distributed Storage initialized: ${partitionCount} partitions, replication factor ${replicationFactor}`
    );
  }

  /**
   * Hash function pentru a determina partiția (consistent hashing)
   */
  getPartition(key: string): number {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash) % this.partitionCount;
  }

  /**
   * Stochează date în partiția corespunzătoare (cu replicare)
   */
  async store(key: string, data: any): Promise<void> {
    const primaryPartition = this.getPartition(key);
    const partition = this.partitions.get(primaryPartition)!;

    // Stochează în partiția primară
    partition.data.set(key, {
      key,
      data,
      timestamp: Date.now(),
      partition: primaryPartition,
    });
    partition.itemCount++;
    partition.size += JSON.stringify(data).length;

    // Simulare replicare pe alte partiții
    for (let i = 1; i < this.replicationFactor; i++) {
      const replicaPartition =
        (primaryPartition + i) % this.partitionCount;
      const replica = this.partitions.get(replicaPartition)!;
      replica.data.set(key, {
        key,
        data,
        timestamp: Date.now(),
        partition: replicaPartition,
        isReplica: true,
        primaryPartition,
      });
    }

    console.log(
      `Stored ${key} in partition ${primaryPartition} with ${
        this.replicationFactor - 1
      } replicas`
    );
  }

  /**
   * Retrieve data din storage
   */
  async retrieve(key: string): Promise<any> {
    const partitionId = this.getPartition(key);
    const partition = this.partitions.get(partitionId)!;
    const item = partition.data.get(key);

    if (!item) {
      throw new Error(`Key ${key} not found in partition ${partitionId}`);
    }

    return item.data;
  }

  /**
   * Statistici despre storage
   */
  getStats() {
    const stats = {
      totalPartitions: this.partitionCount,
      replicationFactor: this.replicationFactor,
      partitions: [] as any[],
      totalItems: 0,
      totalSize: 0,
    };

    this.partitions.forEach((partition, id) => {
      stats.partitions.push({
        id,
        itemCount: partition.itemCount,
        size: partition.size,
        sizeKB: (partition.size / 1024).toFixed(2),
      });
      stats.totalItems += partition.itemCount;
      stats.totalSize += partition.size;
    });

    return stats;
  }

  /**
   * Rebalance partițiile (pentru Big Data scaling)
   */
  async rebalance(): Promise<void> {
    console.log("Starting partition rebalancing...");
    // În production, aici ar fi logica de rebalansare între noduri
    // Pentru demo, doar logăm statisticile
    const stats = this.getStats();
    console.log("Rebalancing stats:", stats);
  }
}

interface Partition {
  id: number;
  data: Map<string, StoredItem>;
  size: number;
  itemCount: number;
}

interface StoredItem {
  key: string;
  data: any;
  timestamp: number;
  partition: number;
  isReplica?: boolean;
  primaryPartition?: number;
}
