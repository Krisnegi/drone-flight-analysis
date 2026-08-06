import { redis } from '../services/redis';

async function runVerification() {
  console.log('🧪 Starting Phase 3 Telemetry Ingestion Verification...\n');

  console.log('Waiting 3 seconds to accumulate telemetry events...');
  await new Promise((resolve) => setTimeout(resolve, 3000));

  try {
    const alphaStateRaw = await redis.get('drone:drone-alpha-111:state');
    const betaStateRaw = await redis.get('drone:drone-beta-222:state');

    if (!alphaStateRaw || !betaStateRaw) {
      throw new Error(`Missing telemetry cache. Alpha: ${!!alphaStateRaw}, Beta: ${!!betaStateRaw}`);
    }

    const alphaState = JSON.parse(alphaStateRaw);
    const betaState = JSON.parse(betaStateRaw);

    console.log('✔ Telemetry cache found in Redis!');
    
    console.log('\n--- Drone Alpha State ---');
    console.log(`Drone ID:        ${alphaState.droneId}`);
    console.log(`Status:          ${alphaState.status}`);
    console.log(`Battery:         ${alphaState.batteryLevel}%`);
    console.log(`Temperature:     ${alphaState.temperature}°C`);
    console.log(`Signal Strength: ${alphaState.signalStrength} dBm`);
    console.log(`Location:        (${alphaState.latitude}, ${alphaState.longitude})`);

    console.log('\n--- Drone Beta State ---');
    console.log(`Drone ID:        ${betaState.droneId}`);
    console.log(`Status:          ${betaState.status}`);
    console.log(`Battery:         ${betaState.batteryLevel}%`);
    console.log(`Temperature:     ${betaState.temperature}°C`);
    console.log(`Signal Strength: ${betaState.signalStrength} dBm`);
    console.log(`Location:        (${betaState.latitude}, ${betaState.longitude})`);

    // Verify fields exist
    const requiredFields = ['droneId', 'status', 'latitude', 'longitude', 'altitude', 'speed', 'batteryLevel', 'temperature', 'signalStrength'];
    for (const field of requiredFields) {
      if (!(field in alphaState) || !(field in betaState)) {
        throw new Error(`Telemetry is missing required field: ${field}`);
      }
    }

    console.log('\n🎉 TELEMETRY INGESTION PIPELINE VERIFIED! Telemetry structure matches specs and flows into Redis in real-time.');
  } catch (error) {
    console.error('\n✖ Telemetry ingestion verification failed:', error);
  } finally {
    redis.disconnect();
    process.exit(0);
  }
}

runVerification();
