import { prisma } from '../services/db';

const BASE_URL = 'http://localhost:4000';

async function runTests() {
  console.log('🧪 Starting Phase 2 Integration Tests...\n');

  const timestamp = Date.now();
  const adminEmail = `admin_${timestamp}@test.com`;
  const pilotEmail = `pilot_${timestamp}@test.com`;
  const password = 'TestPassword123';

  let adminToken = '';
  let pilotToken = '';
  let createdDroneId = '';

  try {
    // 1. Sign up Admin
    console.log('1. Signing up Admin...');
    const signupAdminRes = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password, name: 'Test Admin', role: 'ADMIN' }),
    });
    const signupAdminData = (await signupAdminRes.json()) as any;
    if (signupAdminRes.status !== 201) throw new Error(`Admin signup failed: ${JSON.stringify(signupAdminData)}`);
    console.log('✔ Admin signed up successfully.');

    // 2. Sign up Pilot
    console.log('2. Signing up Pilot...');
    const signupPilotRes = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: pilotEmail, password, name: 'Test Pilot', role: 'PILOT' }),
    });
    const signupPilotData = (await signupPilotRes.json()) as any;
    if (signupPilotRes.status !== 201) throw new Error(`Pilot signup failed: ${JSON.stringify(signupPilotData)}`);
    console.log('✔ Pilot signed up successfully.');

    // 3. Log in Admin
    console.log('3. Logging in Admin...');
    const loginAdminRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password }),
    });
    const loginAdminData = (await loginAdminRes.json()) as any;
    adminToken = loginAdminData.token;
    console.log('✔ Admin logged in. Token acquired.');

    // 4. Log in Pilot
    console.log('4. Logging in Pilot...');
    const loginPilotRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: pilotEmail, password }),
    });
    const loginPilotData = (await loginPilotRes.json()) as any;
    pilotToken = loginPilotData.token;
    console.log('✔ Pilot logged in. Token acquired.');

    // 5. Create Drone as Admin (Should succeed)
    console.log('5. Registering Drone as Admin...');
    const createDroneRes = await fetch(`${BASE_URL}/api/drones`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: 'Alpha Sentinel',
        serialNumber: `SN-${timestamp}`,
        model: 'Quadcopter X-200',
      }),
    });
    const createDroneData = (await createDroneRes.json()) as any;
    if (createDroneRes.status !== 201) throw new Error(`Drone registration failed: ${JSON.stringify(createDroneData)}`);
    createdDroneId = createDroneData.drone.id;
    console.log(`✔ Drone registered. ID: ${createdDroneId}`);

    // 6. Create Drone as Pilot (Should fail - 403)
    console.log('6. Attempting to register Drone as Pilot...');
    const createDroneFailRes = await fetch(`${BASE_URL}/api/drones`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${pilotToken}`,
      },
      body: JSON.stringify({
        name: 'Forbidden Drone',
        serialNumber: `SN-FAIL-${timestamp}`,
        model: 'Glider G-1',
      }),
    });
    console.log(`✔ Received status ${createDroneFailRes.status} (Expected: 403 Forbidden)`);
    if (createDroneFailRes.status !== 403) throw new Error('Authorization check failed: Pilot was able to create drone.');

    // 7. List Drones as Pilot (Should succeed)
    console.log('7. Listing drones as Pilot...');
    const listDronesRes = await fetch(`${BASE_URL}/api/drones`, {
      headers: { 'Authorization': `Bearer ${pilotToken}` },
    });
    const listDronesData = (await listDronesRes.json()) as any;
    if (listDronesRes.status !== 200) throw new Error('Pilot failed to list drones.');
    console.log(`✔ Drones retrieved by Pilot. Count: ${listDronesData.length}`);

    // 8. Retrieve Drone Details as Pilot (Should succeed)
    console.log(`8. Retrieving drone details for ${createdDroneId} as Pilot...`);
    const getDroneRes = await fetch(`${BASE_URL}/api/drones/${createdDroneId}`, {
      headers: { 'Authorization': `Bearer ${pilotToken}` },
    });
    const getDroneData = (await getDroneRes.json()) as any;
    if (getDroneRes.status !== 200) throw new Error('Pilot failed to retrieve drone details.');
    console.log(`✔ Drone details fetched. Name: ${getDroneData.name}`);

    // 9. Delete Drone as Pilot (Should fail - 403)
    console.log(`9. Attempting to delete drone as Pilot...`);
    const deleteDroneFailRes = await fetch(`${BASE_URL}/api/drones/${createdDroneId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${pilotToken}` },
    });
    console.log(`✔ Received status ${deleteDroneFailRes.status} (Expected: 403 Forbidden)`);
    if (deleteDroneFailRes.status !== 403) throw new Error('Authorization check failed: Pilot was able to delete drone.');

    // 10. Delete Drone as Admin (Should succeed)
    console.log(`10. Deleting drone as Admin...`);
    const deleteDroneRes = await fetch(`${BASE_URL}/api/drones/${createdDroneId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${adminToken}` },
    });
    if (deleteDroneRes.status !== 200) throw new Error('Admin failed to delete drone.');
    console.log('✔ Drone deleted successfully by Admin.');

    console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! Routing, JWT verification, and RBAC policies work as expected.');

  } catch (error) {
    console.error('\n✖ TEST SUITE FAILED:', error);
  } finally {
    // Cleanup database users
    console.log('\n🧹 Cleaning up test database records...');
    try {
      await prisma.user.deleteMany({
        where: { email: { in: [adminEmail, pilotEmail] } },
      });
      if (createdDroneId) {
        await prisma.drone.deleteMany({
          where: { id: createdDroneId },
        });
      }
      console.log('✔ Database cleaned.');
    } catch (cleanupError) {
      console.error('Failed to cleanup test data:', cleanupError);
    }
    prisma.$disconnect();
    process.exit(0);
  }
}

runTests();
