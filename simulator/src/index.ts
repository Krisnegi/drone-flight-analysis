import mqtt from 'mqtt';
import dotenv from 'dotenv';
import { SimulatedDrone } from './drone';

import http from 'http';

// Load environment variables
dotenv.config();

const mqttUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
const droneIds = (process.env.SIMULATED_DRONE_IDS || 'drone-alpha-111,drone-beta-222').split(',');

// Simple HTTP server to bind to $PORT for free Render Web Service hosting
const port = process.env.PORT || 4001;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'simulator-active' }));
}).listen(port, () => {
  console.log(`📡 Simulator health check server listening on port ${port}`);
});

console.log(`🔌 Connecting simulator to MQTT broker at ${mqttUrl}...`);
const client = mqtt.connect(mqttUrl);

const drones: SimulatedDrone[] = [];

client.on('connect', () => {
  console.log('✔ Simulator connected to MQTT Broker.');

  // Initialize drones
  console.log(`✈ Launching simulation for drone fleet: [${droneIds.join(', ')}]`);
  
  // Base GPS position (Bangalore, India)
  const baseLat = 12.971598;
  const baseLng = 77.594562;

  droneIds.forEach((id, index) => {
    // Give each drone a small coordinate offset (approx. 7 meters) to represent adjacent launch pads
    const latOffset = index * 0.00005;
    const lngOffset = index * 0.00005;
    
    const drone = new SimulatedDrone(id, client, baseLat + latOffset, baseLng + lngOffset);
    drones.push(drone);
  });

  // Schedule the 1Hz (1-second interval) physical simulation update
  setInterval(() => {
    drones.forEach((drone) => {
      drone.updateState();
    });
  }, 1000);
});

client.on('error', (err) => {
  console.error('MQTT connection error:', err);
});
