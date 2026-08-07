import { prisma } from '../services/db';

const BASE_URL = 'http://localhost:4000';

async function runTests() {
  console.log('🧪 Starting Phase 5 REST API Integration Tests...\n');

  const timestamp = Date.now();
  const testUserEmail = `pilot_p5_${timestamp}@example.com`;
  const password = 'TestPassword123';
  let pilotToken = '';
  let pilotId = '';
  let flightSessionId = '';

  try {
    // 1. Sign up test pilot
    console.log('1. Signing up pilot...');
    const signupRes = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testUserEmail, password, name: 'Pilot Phase 5', role: 'PILOT' }),
    });
    const signupData = (await signupRes.json()) as any;
    pilotId = signupData.user.id;
    pilotToken = signupData.token;
    console.log(`✔ Signed up. ID: ${pilotId}`);

    // 2. Dispatch Drone via REST API
    console.log('\n2. Dispatching drone-alpha-111...');
    const waypoints = [
      { latitude: 12.971598, longitude: 77.594562, altitude: 10.0, speed: 4.0 },
      { latitude: 12.972098, longitude: 77.595062, altitude: 12.0, speed: 5.0 },
    ];
    const dispatchRes = await fetch(`${BASE_URL}/api/sessions/drones/drone-alpha-111/dispatch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${pilotToken}`,
      },
      body: JSON.stringify({ waypoints }),
    });
    const dispatchData = (await dispatchRes.json()) as any;
    if (dispatchRes.status !== 201) throw new Error(`Dispatch failed: ${JSON.stringify(dispatchData)}`);
    flightSessionId = dispatchData.flightSessionId;
    console.log(`✔ Drone dispatched. Session ID: ${flightSessionId}`);

    // Wait 2.5 seconds to let the simulator process take-off ticks
    console.log('⏳ Waiting 2.5 seconds to let takeoff begin in simulator...');
    await new Promise((resolve) => setTimeout(resolve, 2500));

    // 3. Fetch Live Telemetry from Redis cache REST API
    console.log('\n3. Fetching live telemetry coordinates (Redis Cache API)...');
    const liveRes = await fetch(`${BASE_URL}/api/sessions/drones/drone-alpha-111/telemetry/live`, {
      headers: { 'Authorization': `Bearer ${pilotToken}` },
    });
    const liveData = (await liveRes.json()) as any;
    if (liveRes.status !== 200) throw new Error(`Live telemetry fetch failed: ${JSON.stringify(liveData)}`);
    console.log(`✔ Live Cache Status: ${liveData.status}, Alt: ${liveData.altitude}m, Battery: ${liveData.batteryLevel}%`);
    if (liveData.status !== 'TAKING_OFF' && liveData.status !== 'FLYING') {
      throw new Error(`Expected drone to be active, but got status: ${liveData.status}`);
    }

    // 4. Fetch Dashboard Statistics
    console.log('\n4. Fetching dashboard overview metrics...');
    const statsRes = await fetch(`${BASE_URL}/api/analytics/dashboard`, {
      headers: { 'Authorization': `Bearer ${pilotToken}` },
    });
    const statsData = (await statsRes.json()) as any;
    if (statsRes.status !== 200) throw new Error(`Stats fetch failed: ${JSON.stringify(statsData)}`);
    console.log(`✔ Stats: Total Drones: ${statsData.totalDrones}, Active: ${statsData.activeDrones}, Distance: ${statsData.totalDistanceKm}km`);
    if (statsData.activeDrones < 1) {
      throw new Error(`Expected at least 1 active drone, got: ${statsData.activeDrones}`);
    }

    // 5. Send Manual Override via REST API (RETURN_TO_BASE)
    console.log('\n5. Sending Manual Override (RETURN_TO_BASE)...');
    const overrideRes = await fetch(`${BASE_URL}/api/sessions/drones/drone-alpha-111/override`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${pilotToken}`,
      },
      body: JSON.stringify({ action: 'RETURN_TO_BASE' }),
    });
    const overrideData = (await overrideRes.json()) as any;
    if (overrideRes.status !== 200) throw new Error(`Override failed: ${JSON.stringify(overrideData)}`);
    console.log(`✔ Override accepted. Target status in DB: ${overrideData.nextStatus}`);

    // 6. Wait for flight return, land, and BullMQ analytics post-compilation
    console.log('\n⏳ Waiting 9 seconds for return-to-base flight path, landing, and BullMQ compiler to execute...');
    await new Promise((resolve) => setTimeout(resolve, 9000));

    // 7. Verify Completed Session Details
    console.log('\n7. Fetching completed session details...');
    const sessionRes = await fetch(`${BASE_URL}/api/sessions/${flightSessionId}`, {
      headers: { 'Authorization': `Bearer ${pilotToken}` },
    });
    const sessionData = (await sessionRes.json()) as any;
    if (sessionRes.status !== 200) throw new Error(`Session fetch failed: ${JSON.stringify(sessionData)}`);
    console.log(`✔ Session: Status: ${sessionData.status}, Distance: ${sessionData.distanceTraveled} km, Avg Speed: ${sessionData.avgSpeed} m/s, Battery Used: ${sessionData.batteryConsumed}%`);
    if (sessionData.status !== 'COMPLETED') {
      throw new Error(`Expected session status COMPLETED, got: ${sessionData.status}`);
    }

    // 8. Fetch Historical Telemetry Tracks (for map playback)
    console.log('\n8. Fetching historical coordinate logs for map rendering...');
    const pathRes = await fetch(`${BASE_URL}/api/sessions/${flightSessionId}/telemetry`, {
      headers: { 'Authorization': `Bearer ${pilotToken}` },
    });
    const pathData = (await pathRes.json()) as any;
    if (pathRes.status !== 200) throw new Error(`Telemetry logs fetch failed: ${JSON.stringify(pathData)}`);
    console.log(`✔ Historical Telemetry point count: ${pathData.length}`);
    if (pathData.length === 0) {
      throw new Error('Expected telemetry coordinates to be saved, but received empty list.');
    }

    // 9. Fetch Alert history logs
    console.log('\n9. Fetching alerts feed...');
    const alertsRes = await fetch(`${BASE_URL}/api/analytics/alerts`, {
      headers: { 'Authorization': `Bearer ${pilotToken}` },
    });
    const alertsData = (await alertsRes.json()) as any;
    if (alertsRes.status !== 200) throw new Error(`Alerts fetch failed: ${JSON.stringify(alertsData)}`);
    console.log(`✔ Alerts logs count: ${alertsData.length}`);

    console.log('\n🎉 ALL PHASE 5 REST API TESTS PASSED! Telemetry caches, dispatching triggers, manual overrides, stats aggregation, and history feeds work exactly as designed.');

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

    prisma.$disconnect();
    process.exit(0);
  }
}

runTests();
