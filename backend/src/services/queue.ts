import { Queue } from 'bullmq';

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

// Parse the Redis URL to extract connection fields for BullMQ
let host = '127.0.0.1';
let port = 6379;
let password: string | undefined = undefined;

try {
  const parsed = new URL(redisUrl);
  host = parsed.hostname;
  port = parseInt(parsed.port || '6379', 10);
  password = parsed.password || undefined;
} catch (err) {
  console.warn('Failed to parse REDIS_URL environment variable, defaulting to localhost:6379');
}

export const queueConnection = {
  host,
  port,
  password,
};

// Define queues
export const alertQueue = new Queue('alert-queue', { connection: queueConnection });
export const analyticsQueue = new Queue('analytics-queue', { connection: queueConnection });

/**
 * Add a telemetry verification job to evaluate rules (Low Battery, High Temp, Signal Loss, Geofencing)
 */
export async function queueAlertCheck(telemetryPayload: any) {
  try {
    await alertQueue.add('check-telemetry-alert', telemetryPayload, {
      removeOnComplete: true,
      removeOnFail: true,
    });
  } catch (error) {
    console.error('Failed to queue telemetry alert check job:', error);
  }
}

/**
 * Add a flight session compiler job when a drone lands
 */
export async function queueFlightSessionCompilation(flightSessionId: string) {
  try {
    await analyticsQueue.add('compile-flight-session', { flightSessionId }, {
      removeOnComplete: true,
      removeOnFail: true,
      delay: 2000, // delay 2 seconds to allow the final telemetry buffer logs to be flushed from Redis to Postgres
    });
    console.log(`💼 Queued flight compilation job for session: ${flightSessionId}`);
  } catch (error) {
    console.error('Failed to queue flight session compilation job:', error);
  }
}
