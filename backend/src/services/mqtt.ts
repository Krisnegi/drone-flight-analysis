import mqtt from 'mqtt';
import { EventEmitter } from 'events';
import { redis } from './redis';
import { prisma } from './db';
import { queueAlertCheck, queueFlightSessionCompilation } from './queue';

const mqttUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';

// Decoupled emitter to pipe telemetry updates to WebSockets (Socket.IO)
export const telemetryEmitter = new EventEmitter();

let client: mqtt.MqttClient;

/**
 * Initialize MQTT Client, subscribe to telemetry, and process incoming telemetry
 */
export function initMqtt() {
  console.log(`🔌 Connecting backend to MQTT broker at ${mqttUrl}...`);
  client = mqtt.connect(mqttUrl);

  client.on('connect', () => {
    console.log('✔ Backend connected to MQTT Broker.');
    
    // Subscribe to telemetry topic for all drones (+ is wild-card)
    client.subscribe('drones/+/telemetry', (err) => {
      if (err) {
        console.error('Failed to subscribe to drone telemetry topic:', err);
      } else {
        console.log('✔ Subscribed to MQTT topic: drones/+/telemetry');
      }
    });
  });

  client.on('message', async (topic, message) => {
    try {
      const topicParts = topic.split('/');
      // Topic structure: drones/{droneId}/telemetry
      if (topicParts.length === 3 && topicParts[0] === 'drones' && topicParts[2] === 'telemetry') {
        const droneId = topicParts[1];
        const payload = JSON.parse(message.toString());

        // 1. Check for session completion (transition: has flightSessionId -> does not have flightSessionId)
        const previousStateRaw = await redis.get(`drone:${droneId}:state`);
        if (previousStateRaw) {
          const previousState = JSON.parse(previousStateRaw);
          if (previousState.flightSessionId && !payload.flightSessionId) {
            console.log(`✈ Drone ${droneId} landed. Triggering post-flight compilation for session: ${previousState.flightSessionId}`);
            await queueFlightSessionCompilation(previousState.flightSessionId);
          }
        }

        // 2. Emit telemetry event for real-time WebSockets pipe
        telemetryEmitter.emit('telemetry', payload);

        // 3. Cache the latest state in Redis (expires in 1 hour if drone goes offline)
        await redis.set(`drone:${droneId}:state`, JSON.stringify(payload), 'EX', 3600);

        // 4. Queue off-thread safety alerts review
        await queueAlertCheck(payload);

        // 5. Buffer logs in Redis for batch PostgreSQL insert (only when drone is actively in a flight session)
        if (payload.flightSessionId) {
          await redis.rpush('telemetry:buffer:queue', JSON.stringify(payload));
        }
      }
    } catch (err) {
      console.error('Error processing incoming MQTT telemetry message:', err);
    }
  });

  client.on('error', (err) => {
    console.error('MQTT Ingestor connection error:', err);
  });
}

/**
 * Publish command to a drone via MQTT
 */
export function sendDroneCommand(droneId: string, command: string, payload: any = {}) {
  if (!client) {
    console.error('MQTT client not initialized.');
    return;
  }
  const topic = `drones/${droneId}/commands`;
  const message = JSON.stringify({ command, ...payload });
  client.publish(topic, message, { qos: 1 });
  console.log(`✉ Sent command to topic "${topic}":`, message);
}

/**
 * Flush telemetry logs from Redis buffer to PostgreSQL in batches to save IOPS
 */
export async function flushTelemetryBuffer() {
  try {
    const queueLength = await redis.llen('telemetry:buffer:queue');
    if (queueLength === 0) return;

    // Pop the items from the queue atomically using LRANGE + LTRIM
    const rawItems = await redis.lrange('telemetry:buffer:queue', 0, queueLength - 1);
    await redis.ltrim('telemetry:buffer:queue', queueLength, -1);

    if (rawItems.length === 0) return;

    console.log(`📥 Batching ${rawItems.length} telemetry logs from Redis to PostgreSQL...`);
    const logs = rawItems.map(item => JSON.parse(item));

    // Prepare inputs for createMany
    const telemetryRecords = logs.map((log: any) => ({
      flightSessionId: log.flightSessionId,
      timestamp: new Date(log.timestamp),
      latitude: log.latitude,
      longitude: log.longitude,
      altitude: log.altitude,
      speed: log.speed,
      batteryLevel: log.batteryLevel,
      temperature: log.temperature,
      signalStrength: log.signalStrength,
    }));

    // 1. Bulk insert telemetry logs
    await prisma.telemetryLog.createMany({
      data: telemetryRecords,
    });

    // 2. Extract the latest telemetry state for each unique drone to update the Drone table
    const latestDroneStates: { [droneId: string]: any } = {};
    for (const log of logs) {
      const existing = latestDroneStates[log.droneId];
      if (!existing || new Date(log.timestamp) > new Date(existing.timestamp)) {
        latestDroneStates[log.droneId] = log;
      }
    }

    // 3. Write latest location/status updates to Drone table in PostgreSQL in parallel
    await Promise.all(
      Object.keys(latestDroneStates).map(async (droneId) => {
        const state = latestDroneStates[droneId];
        await prisma.drone.update({
          where: { id: droneId },
          data: {
            status: state.status,
            batteryLevel: state.batteryLevel,
            currentLatitude: state.latitude,
            currentLongitude: state.longitude,
            currentAltitude: state.altitude,
          },
        });
      })
    );

    console.log(`✔ Successfully persisted ${rawItems.length} telemetry records.`);
  } catch (error) {
    console.error('Failed to flush telemetry logs from Redis buffer to database:', error);
  }
}

// Flush telemetry buffer every 5 seconds
setInterval(flushTelemetryBuffer, 5000);
