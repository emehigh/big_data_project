import * as Minio from 'minio';
import crypto from 'crypto';

let minioClient: Minio.Client | null = null;

const BUCKET_NAME = 'bigdata-images';
const RESULTS_BUCKET = 'bigdata-results';

export async function getMinioClient(): Promise<Minio.Client> {
  if (minioClient) {
    return minioClient;
  }

  const endpoint = process.env.MINIO_ENDPOINT || 'localhost';
  const port = parseInt(process.env.MINIO_PORT || '9000');
  const useSSL = process.env.MINIO_USE_SSL === 'true';
  const accessKey = process.env.MINIO_ACCESS_KEY || 'minioadmin';
  const secretKey = process.env.MINIO_SECRET_KEY || 'minioadmin123';

  minioClient = new Minio.Client({
    endPoint: endpoint,
    port: port,
    useSSL: useSSL,
    accessKey: accessKey,
    secretKey: secretKey,
  });

  console.log(`✓ Connected to MinIO at ${endpoint}:${port}`);

  // Ensure buckets exist
  await ensureBucket(BUCKET_NAME);
  await ensureBucket(RESULTS_BUCKET);

  return minioClient;
}

async function ensureBucket(bucketName: string): Promise<void> {
  const client = await getMinioClient();
  const exists = await client.bucketExists(bucketName);
  
  if (!exists) {
    await client.makeBucket(bucketName, 'us-east-1');
    console.log(`✓ Created bucket: ${bucketName}`);
    
    // Set bucket policy to allow read access
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${bucketName}/*`],
        },
      ],
    };
    
    await client.setBucketPolicy(bucketName, JSON.stringify(policy));
    console.log(`✓ Set policy for bucket: ${bucketName}`);
  }
}

// Upload image to S3/MinIO
export async function uploadImage(
  buffer: Buffer,
  filename: string,
  partition: number,
  metadata: Record<string, string> = {}
): Promise<{ key: string; url: string; partition: number }> {
  const client = await getMinioClient();
  
  // Generate unique key with partition prefix
  const hash = crypto.createHash('md5').update(buffer).digest('hex').substring(0, 8);
  const ext = filename.split('.').pop();
  const key = `partition-${partition}/${hash}-${Date.now()}.${ext}`;
  
  // Upload to MinIO
  await client.putObject(BUCKET_NAME, key, buffer, buffer.length, {
    'Content-Type': `image/${ext}`,
    'X-Partition': partition.toString(),
    'X-Original-Filename': filename,
    ...metadata,
  });

  // Generate URL
  const url = await client.presignedGetObject(BUCKET_NAME, key, 24 * 60 * 60); // 24 hours

  console.log(`✓ Uploaded ${filename} to ${key} (Partition ${partition})`);

  return { key, url, partition };
}

// Upload multiple images in parallel
export async function uploadImages(
  images: Array<{ buffer: Buffer; filename: string; partition: number }>
): Promise<Array<{ key: string; url: string; partition: number; filename: string }>> {
  const uploadPromises = images.map(async ({ buffer, filename, partition }) => {
    const result = await uploadImage(buffer, filename, partition);
    return { ...result, filename };
  });

  return Promise.all(uploadPromises);
}

// Download image from S3/MinIO
export async function downloadImage(key: string): Promise<Buffer> {
  const client = await getMinioClient();
  
  const stream = await client.getObject(BUCKET_NAME, key);
  const chunks: Buffer[] = [];
  
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

// Get image URL (temporary access)
export async function getImageUrl(key: string, expirySeconds = 3600): Promise<string> {
  const client = await getMinioClient();
  return await client.presignedGetObject(BUCKET_NAME, key, expirySeconds);
}

// Store processing result
export async function storeResult(
  imageId: string,
  result: {
    description: string;
    partition: number;
    workerId: number;
    processingTime: number;
  }
): Promise<string> {
  const client = await getMinioClient();
  
  const resultKey = `results/${imageId}.json`;
  const resultData = JSON.stringify({
    ...result,
    timestamp: Date.now(),
  });

  await client.putObject(
    RESULTS_BUCKET,
    resultKey,
    resultData,
    resultData.length,
    {
      'Content-Type': 'application/json',
    }
  );

  return resultKey;
}

// List images by partition
export async function listImagesByPartition(partition: number): Promise<string[]> {
  const client = await getMinioClient();
  const prefix = `partition-${partition}/`;
  
  const objectsStream = client.listObjects(BUCKET_NAME, prefix, true);
  const objects: string[] = [];

  return new Promise((resolve, reject) => {
    objectsStream.on('data', (obj) => {
      if (obj.name) {
        objects.push(obj.name);
      }
    });
    objectsStream.on('end', () => resolve(objects));
    objectsStream.on('error', reject);
  });
}

// Get storage statistics
export async function getStorageStats(): Promise<{
  totalImages: number;
  totalSize: number;
  partitionStats: Array<{ partition: number; count: number; size: number }>;
}> {
  const client = await getMinioClient();
  const partitions = Array.from({ length: 8 }, (_, i) => i);
  
  const partitionStats = await Promise.all(
    partitions.map(async (partition) => {
      const prefix = `partition-${partition}/`;
      const objectsStream = client.listObjects(BUCKET_NAME, prefix, true);
      
      let count = 0;
      let size = 0;

      return new Promise<{ partition: number; count: number; size: number }>((resolve, reject) => {
        objectsStream.on('data', (obj) => {
          count++;
          size += obj.size || 0;
        });
        objectsStream.on('end', () => resolve({ partition, count, size }));
        objectsStream.on('error', reject);
      });
    })
  );

  const totalImages = partitionStats.reduce((sum, p) => sum + p.count, 0);
  const totalSize = partitionStats.reduce((sum, p) => sum + p.size, 0);

  return { totalImages, totalSize, partitionStats };
}

// Delete image
export async function deleteImage(key: string): Promise<void> {
  const client = await getMinioClient();
  await client.removeObject(BUCKET_NAME, key);
  console.log(`✓ Deleted ${key}`);
}

// Batch delete images
export async function deleteImages(keys: string[]): Promise<void> {
  const client = await getMinioClient();
  await client.removeObjects(BUCKET_NAME, keys);
  console.log(`✓ Deleted ${keys.length} images`);
}

// Health check
export async function s3HealthCheck(): Promise<boolean> {
  try {
    const client = await getMinioClient();
    await client.bucketExists(BUCKET_NAME);
    return true;
  } catch (error) {
    console.error('S3 health check failed:', error);
    return false;
  }
}
