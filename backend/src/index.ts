import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { checkDatabaseConnection } from './services/db';
import { checkRedisConnection } from './services/redis';
import authRouter from './routes/auth';
import droneRouter from './routes/drone';

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Mount API routes
app.use('/api/auth', authRouter);
app.use('/api/drones', droneRouter);

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
  } else {
    console.warn('✖ WARNING: PostgreSQL connection failed.');
  }

  if (redisConnected) {
    console.log('✔ Redis connection verified.');
  } else {
    console.warn('✖ WARNING: Redis connection failed.');
  }

  app.listen(port, () => {
    console.log(`🚀 Server listening on http://localhost:${port}`);
  });
}

bootstrap().catch((err) => {
  console.error('Fatal initialization error:', err);
  process.exit(1);
});
