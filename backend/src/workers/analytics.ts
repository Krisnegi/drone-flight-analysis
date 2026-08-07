import { Worker } from 'bullmq';
import { queueConnection } from '../services/queue';
import { prisma } from '../services/db';
import { flushTelemetryBuffer } from '../services/mqtt';

function getDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dy = (lat2 - lat1) * 111000;
  const dx = (lng2 - lng1) * 111000 * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(dx * dx + dy * dy);
}

export function initAnalyticsWorker() {
  const worker = new Worker(
    'analytics-queue',
    async (job) => {
      const { flightSessionId } = job.data;
      console.log(`💼 Background worker compiling analytics for flight session: ${flightSessionId}`);

      // Force flush any pending telemetry logs in the Redis buffer to PostgreSQL
      await flushTelemetryBuffer();

      // 1. Retrieve all raw telemetry logs compiled for this session ordered by time
      const logs = await prisma.telemetryLog.findMany({
        where: { flightSessionId },
        orderBy: { timestamp: 'asc' },
      });

      if (logs.length === 0) {
        console.warn(`[Analytics Worker] No telemetry logs found for session: ${flightSessionId}. Skipping compilation.`);
        return;
      }

      // 2. Compute diagnostics
      let totalDistanceMeters = 0.0;
      let totalSpeed = 0.0;
      let maxAltitude = 0.0;

      for (let i = 0; i < logs.length; i++) {
        totalSpeed += logs[i].speed;
        if (logs[i].altitude > maxAltitude) {
          maxAltitude = logs[i].altitude;
        }

        if (i < logs.length - 1) {
          totalDistanceMeters += getDistanceMeters(
            logs[i].latitude,
            logs[i].longitude,
            logs[i + 1].latitude,
            logs[i + 1].longitude
          );
        }
      }

      const avgSpeed = totalSpeed / logs.length;
      const batteryConsumed = Math.max(0, logs[0].batteryLevel - logs[logs.length - 1].batteryLevel);

      // Convert meters to kilometers for flight analytics database records
      const distanceKM = parseFloat((totalDistanceMeters / 1000).toFixed(3));

      // 3. Update the flight session record
      const updatedSession = await prisma.flightSession.update({
        where: { id: flightSessionId },
        data: {
          status: 'COMPLETED',
          endTime: new Date(),
          distanceTraveled: distanceKM,
          avgSpeed: parseFloat(avgSpeed.toFixed(2)),
          maxAltitude: parseFloat(maxAltitude.toFixed(1)),
          batteryConsumed,
        },
      });

      // 4. Update the parent drone's status back to IDLE
      await prisma.drone.update({
        where: { id: updatedSession.droneId },
        data: { status: 'IDLE' },
      });

      console.log(`✔ Finished analytics compilation for Flight Session: ${flightSessionId}.`);
      console.log(`   - Distance: ${distanceKM} km`);
      console.log(`   - Avg Speed: ${avgSpeed.toFixed(2)} m/s`);
      console.log(`   - Max Alt: ${maxAltitude.toFixed(1)} m`);
      console.log(`   - Battery Consumed: ${batteryConsumed}%`);
    },
    { connection: queueConnection }
  );

  worker.on('failed', (job, err) => {
    console.error(`✖ Job [${job?.id}] failed in analytics worker:`, err);
  });

  console.log('✔ BullMQ Flight Analytics Worker initialized.');
}
