import mqtt from 'mqtt';
import { prisma } from '../services/db';

const MQTT_URL = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';

function getDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dy = (lat2 - lat1) * 111000;
  const dx = (lng2 - lng1) * 111000 * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(dx * dx + dy * dy);
}

async function runTests() {
  console.log('🧪 Starting Phase 4 WebSocket & BullMQ End-to-End Integration Tests...\n');

  const timestamp = Date.now();
  const testUserEmail = `pilot_test_${timestamp}@example.com`;
  let pilotId = '';
  let flightSessionId = '';

  const mqttClient = mqtt.connect(MQTT_URL);

  // Wait for MQTT client to connect
  await new Promise<void>((resolve) => {
    mqttClient.on('connect', () => {
      resolve();
    });
  });
  console.log('✔ Test MQTT Client connected.');

  try {
    // 1. Setup test pilot user in database
    const pilot = await prisma.user.create({
      data: {
        email: testUserEmail,
        passwordHash: 'dummyhash',
        name: 'Test Pilot Phase 4',
        role: 'PILOT',
      },
    });
    pilotId = pilot.id;
    console.log(`✔ Created test pilot user in database. ID: ${pilotId}`);

    // 2. Create active flight session in database
    const session = await prisma.flightSession.create({
      data: {
        droneId: 'drone-alpha-111',
        pilotId: pilotId,
        status: 'ACTIVE',
      },
    });
    flightSessionId = session.id;
    console.log(`✔ Created active flight session. ID: ${flightSessionId}`);

    // 3. Publish simulated telemetry logs over MQTT
    console.log('\n📡 Streaming simulated telemetry over MQTT...');

    // Message 1: Takeoff (all parameters safe)
    const t1 = {
      droneId: 'drone-alpha-111',
      flightSessionId,
      timestamp: new Date(Date.now() - 4000).toISOString(),
      status: 'TAKING_OFF',
      latitude: 12.971598,
      longitude: 77.594562,
      altitude: 15.0,
      speed: 5.0,
      batteryLevel: 100,
      temperature: 30.0,
      signalStrength: -35,
    };
    mqttClient.publish('drones/drone-alpha-111/telemetry', JSON.stringify(t1));
    console.log(' - Sent Takeoff Telemetry (Safe parameters)');
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Message 2: Cruise (breaches battery, temp, signal, and geofence)
    const t2 = {
      droneId: 'drone-alpha-111',
      flightSessionId,
      timestamp: new Date(Date.now() - 2000).toISOString(),
      status: 'FLYING',
      latitude: 12.981598,   // Offset by ~1.1km (Violates geofence >300m)
      longitude: 77.604562,
      altitude: 25.0,
      speed: 10.0,
      batteryLevel: 15,      // Violates battery <20%
      temperature: 78.0,     // Violates temperature >70°C
      signalStrength: -88,   // Violates signal <-85dBm
    };
    mqttClient.publish('drones/drone-alpha-111/telemetry', JSON.stringify(t2));
    console.log(' - Sent Cruise Telemetry (Low Battery, High Temp, Weak Signal, Geofence Breach)');
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Message 3: Landed (resets flightSessionId to trigger compilation worker)
    const t3 = {
      droneId: 'drone-alpha-111',
      flightSessionId: null, // Landed state -> flightSessionId becomes null
      timestamp: new Date(Date.now()).toISOString(),
      status: 'IDLE',
      latitude: 12.971598,
      longitude: 77.594562,
      altitude: 0.0,
      speed: 0.0,
      batteryLevel: 10,
      temperature: 28.0,
      signalStrength: -30,
    };
    mqttClient.publish('drones/drone-alpha-111/telemetry', JSON.stringify(t3));
    console.log(' - Sent Landing Telemetry (Landed -> triggers analytics calculation)');

    // 4. Wait for background flusher and BullMQ queue workers to complete
    console.log('\n⏳ Waiting 8 seconds for Redis queue workers and batch database flusher to process...');
    await new Promise((resolve) => setTimeout(resolve, 8000));

    // 5. Query and Assert results in database
    console.log('\n🔍 Fetching database results to assert correctness...');

    // A. Check for Alerts
    const alerts = await prisma.alert.findMany({
      where: { flightSessionId },
    });

    console.log(`\n--- Active Alerts Found: ${alerts.length} ---`);
    alerts.forEach((alert) => {
      console.log(`[${alert.severity}] ${alert.type}: ${alert.message}`);
    });

    const alertTypes = alerts.map(a => a.type);
    const expectedAlerts = ['LOW_BATTERY', 'HIGH_TEMP', 'SIGNAL_LOSS', 'GEOFENCE_VIOLATION'];
    for (const expected of expectedAlerts) {
      if (!alertTypes.includes(expected)) {
        throw new Error(`Assert failed: Expected alert ${expected} was not created in database.`);
      }
    }
    console.log('✔ ASSERT SUCCESS: All expected safety alarms were correctly written to database by the alert-worker.');

    // B. Check for Flight Session Analytics
    const compiledSession = await prisma.flightSession.findUnique({
      where: { id: flightSessionId },
    });

    if (!compiledSession || compiledSession.status !== 'COMPLETED') {
      throw new Error(`Assert failed: FlightSession status is ${compiledSession?.status} (Expected: COMPLETED).`);
    }

    console.log('\n--- Compiled Flight Analytics ---');
    console.log(`Status:            ${compiledSession.status}`);
    console.log(`Distance Flown:    ${compiledSession.distanceTraveled} km`);
    console.log(`Average Speed:     ${compiledSession.avgSpeed} m/s`);
    console.log(`Peak Altitude:     ${compiledSession.maxAltitude} m`);
    console.log(`Battery Depleted:  ${compiledSession.batteryConsumed}%`);

    // Verify distance: Takeoff (12.971598, 77.594562) to Cruise (12.981598, 77.604562)
    const expectedDistMeters = getDistanceMeters(12.971598, 77.594562, 12.981598, 77.604562);
    const totalExpectedDistKM = parseFloat((expectedDistMeters / 1000).toFixed(3));

    // Allow slight float tolerances
    if (Math.abs(compiledSession.distanceTraveled - totalExpectedDistKM) > 0.05) {
      throw new Error(`Assert failed: Expected distance ~${totalExpectedDistKM} km, got ${compiledSession.distanceTraveled} km.`);
    }

    if (compiledSession.batteryConsumed !== 85) { // 100% to 15%
      throw new Error(`Assert failed: Expected batteryConsumed 85%, got ${compiledSession.batteryConsumed}%.`);
    }

    if (Math.abs(compiledSession.avgSpeed - 7.5) > 0.5) { // Average of 5.0 and 10.0 is 7.5
      throw new Error(`Assert failed: Expected average speed ~7.5 m/s, got ${compiledSession.avgSpeed} m/s.`);
    }

    if (compiledSession.maxAltitude !== 25.0) { // Max of 15.0 and 25.0
      throw new Error(`Assert failed: Expected max altitude 25.0 m, got ${compiledSession.maxAltitude} m.`);
    }

    console.log('✔ ASSERT SUCCESS: Flight analytics metrics are mathematically accurate.');

    console.log('\n🎉 ALL PHASE 4 TESTS PASSED! Telemetry alerts and session analytics queues run perfectly off-thread in the background.');

  } catch (error) {
    console.error('\n✖ Integration test failed:', error);
  } finally {
    // Cleanup Database records
    console.log('\n🧹 Cleaning up database test records...');
    try {
      await prisma.user.deleteMany({ where: { id: pilotId } });
      console.log('✔ Test data removed successfully.');
    } catch (cleanupErr) {
      console.error('Failed to cleanup test data:', cleanupErr);
    }
    
    mqttClient.end();
    prisma.$disconnect();
    process.exit(0);
  }
}

runTests();
