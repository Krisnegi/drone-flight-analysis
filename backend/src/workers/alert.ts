import { Worker } from 'bullmq';
import { queueConnection } from '../services/queue';
import { prisma } from '../services/db';
import { broadcastAlert } from '../services/socket';

// Base station coordinates (Bangalore takeoff pads)
const BASE_LAT = 12.971598;
const BASE_LNG = 77.594562;
const MAX_GEOFENCE_RADIUS_METERS = 300.0;

function getDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dy = (lat2 - lat1) * 111000;
  const dx = (lng2 - lng1) * 111000 * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(dx * dx + dy * dy);
}

export function initAlertWorker() {
  const worker = new Worker(
    'alert-queue',
    async (job) => {
      const telemetry = job.data;
      const { droneId, flightSessionId, batteryLevel, temperature, signalStrength, latitude, longitude } = telemetry;

      const checks = [
        {
          condition: batteryLevel < 20,
          type: 'LOW_BATTERY',
          severity: batteryLevel < 10 ? 'CRITICAL' : 'WARNING',
          message: `Low battery warning: ${batteryLevel}% capacity remaining.`,
        },
        {
          condition: temperature > 70,
          type: 'HIGH_TEMP',
          severity: temperature > 75 ? 'CRITICAL' : 'WARNING',
          message: `Abnormal engine temperature detected: ${temperature}°C.`,
        },
        {
          condition: signalStrength < -85,
          type: 'SIGNAL_LOSS',
          severity: signalStrength < -92 ? 'CRITICAL' : 'WARNING',
          message: `Weak radio frequency control link: ${signalStrength} dBm.`,
        },
        {
          condition: getDistanceMeters(latitude, longitude, BASE_LAT, BASE_LNG) > MAX_GEOFENCE_RADIUS_METERS,
          type: 'GEOFENCE_VIOLATION',
          severity: 'CRITICAL',
          message: `Geofence breach! Drone drifted outside the safe operational radius.`,
        },
      ];

      for (const check of checks) {
        if (check.condition) {
          // Check if unresolved alert of this type already exists
          const existingAlert = await prisma.alert.findFirst({
            where: {
              droneId,
              type: check.type,
              resolved: false,
            },
          });

          if (!existingAlert) {
            console.log(`🔔 Safety breach found [${check.type}] for Drone: ${droneId}. Creating alert...`);
            const alert = await prisma.alert.create({
              data: {
                droneId,
                flightSessionId: flightSessionId || null,
                type: check.type,
                severity: check.severity,
                message: check.message,
              },
            });
            // Broadcast alert over WebSockets
            broadcastAlert(alert);
          }
        } else {
          // If condition is fine, check if we need to resolve a previously active alert of this type
          const activeAlert = await prisma.alert.findFirst({
            where: {
              droneId,
              type: check.type,
              resolved: false,
            },
          });

          if (activeAlert) {
            console.log(`💚 Resolving alert [${check.type}] for Drone: ${droneId}. Parameters normalized.`);
            await prisma.alert.update({
              where: { id: activeAlert.id },
              data: { resolved: true },
            });
            // Broadcast the resolution update
            broadcastAlert({ ...activeAlert, resolved: true });
          }
        }
      }
    },
    { connection: queueConnection }
  );

  worker.on('failed', (job, err) => {
    console.error(`✖ Job [${job?.id}] failed in alert worker:`, err);
  });

  console.log('✔ BullMQ Alert Worker initialized.');
}
