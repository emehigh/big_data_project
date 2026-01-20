import { NextResponse } from 'next/server';
import { queueHealthCheck } from '@/lib/queue-manager';
import { s3HealthCheck } from '@/lib/s3-storage';
import { getRedisClient } from '@/lib/redis-client';

export async function GET() {
  try {
    const [queueHealthy, s3Healthy, redisHealthy] = await Promise.all([
      queueHealthCheck(),
      s3HealthCheck(),
      (async () => {
        try {
          const redis = await getRedisClient();
          await redis.ping();
          return true;
        } catch {
          return false;
        }
      })(),
    ]);

    const healthy = queueHealthy && s3Healthy && redisHealthy;

    return NextResponse.json({
      status: healthy ? 'healthy' : 'degraded',
      checks: {
        queue: queueHealthy,
        s3: s3Healthy,
        redis: redisHealthy,
      },
      timestamp: Date.now(),
    }, {
      status: healthy ? 200 : 503,
    });
  } catch (error) {
    return NextResponse.json({
      status: 'unhealthy',
      error: (error as Error).message,
    }, { status: 503 });
  }
}
