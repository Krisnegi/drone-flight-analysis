import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { checkDatabaseConnection, prisma } from './services/db';
import { checkRedisConnection } from './services/redis';
import authRouter from './routes/auth';
import droneRouter from './routes/drone';
import sessionRouter from './routes/session';
import analyticsRouter from './routes/analytics';
import { initMqtt } from './services/mqtt';
import { initSocket } from './services/socket';
import { initAlertWorker } from './workers/alert';
import { initAnalyticsWorker } from './workers/analytics';

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Mount API routes
app.use('/api/auth', authRouter);
app.use('/api/drones', droneRouter);
app.use('/api/sessions', sessionRouter);
app.use('/api/analytics', analyticsRouter);

// Base health check endpoint
app.get('/health', async (_req, res) => {
  const dbOk = await checkDatabaseConnection();
  const redisOk = await checkRedisConnection();

  const status = dbOk && redisOk ? 'OK' : 'DEGRADED';
  const statusCode = dbOk && redisOk ? 200 : 503;

  res.status(statusCode).json({
    status,
    timestamp: new Date().toISOString(),
    services: {
      database: dbOk ? 'CONNECTED' : 'DISCONNECTED',
      redis: redisOk ? 'CONNECTED' : 'DISCONNECTED',
    },
  });
});

// Root path message
app.get('/', (_req, res) => {
  res.json({
    message: 'Drone Flight Analysis API is active. Access /health to check service health status.',
  });
});

// Startup checks
async function bootstrap() {
  console.log('Validating service connections...');
  const dbConnected = await checkDatabaseConnection();
  const redisConnected = await checkRedisConnection();

  if (dbConnected) {
    console.log('✔ PostgreSQL connection verified.');
    try {
      await prisma.drone.upsert({
        where: { id: 'drone-alpha-111' },
        update: {},
        create: {
          id: 'drone-alpha-111',
          name: 'Alpha Scout',
          serialNumber: 'SN-ALPHA111',
          model: 'DJI Mavic 3 Pro',
          status: 'IDLE',
        },
      });

      await prisma.drone.upsert({
        where: { id: 'drone-beta-222' },
        update: {},
        create: {
          id: 'drone-beta-222',
          name: 'Beta Sentinel',
          serialNumber: 'SN-BETA222',
          model: 'Freefly Alta X',
          status: 'IDLE',
        },
      });
      console.log('✔ Default simulated drones seeded in database.');
    } catch (seedErr) {
      console.error('Failed to seed default simulated drones:', seedErr);
    }
  } else {
    console.warn('✖ WARNING: PostgreSQL connection failed.');
  }

  if (redisConnected) {
    console.log('✔ Redis connection verified.');
  } else {
    console.warn('✖ WARNING: Redis connection failed.');
  }

  // Start MQTT Telemetry Ingestion Client
  initMqtt();

  // Start BullMQ background workers
  initAlertWorker();
  initAnalyticsWorker();

  const server = app.listen(port, () => {
    console.log(`🚀 Server listening on http://localhost:${port}`);
  });

  // Initialize WebSockets server
  initSocket(server);
}

bootstrap().catch((err) => {
  console.error('Fatal initialization error:', err);
  process.exit(1);
});
