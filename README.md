# AERO-FLOW: Drone Flight Analysis & Command Center

Aero-Flow is a real-time IoT drone fleet management and telemetry monitoring dashboard. It allows operators to design flight paths, dispatch drones, track flight parameters (altitude, speed, engine temperature, battery levels), receive instant safety breach warnings, and review detailed post-flight analytical logs.

### 🌐 [Live Production App](https://drone-flight-analysis.vercel.app/)

---

## ⚡ Tech Stack & Architecture

Aero-Flow is built with a distributed, message-driven IoT architecture:

* **Frontend**: React (Vite, Tailwind CSS, Leaflet maps for GPS pathing, Recharts for live parameter telemetry, Socket.io-client).
* **Backend API**: Node.js (Express, TypeScript, Prisma ORM, Socket.io WebSockets).
* **Database & Caching**: PostgreSQL (metadata persistence) + Redis (telemetry queues and job storage).
* **Message Broker**: MQTT (standard light-weight machine-to-machine IoT protocol).
* **Asynchronous Jobs**: BullMQ (handling background diagnostic alerts and flight logs compilation).
* **Simulator**: Node.js telemetry simulator generating realistic drone physics, signal loss, battery drain, and thermal engine loads.



## 🚀 Key Features

1. **Real-Time Map Telemetry**: Live UAV positioning, course headings, and multi-sensor readings.
2. **Interactive Mission Planner**: Click to design waypoint courses, and dynamically configure altitude checkpoints and cruise speed targets.
3. **Avionic Overrides**: Instant manual override control triggers: *Return to Base*, *Land in Place*, and *Emergency Land*.
4. **Autonomous Safety Checks**:
   * **Geofence Breach**: Alarms if drone flies outside the $300\text{m}$ home perimeter.
   * **Engine Overheating**: Monitors aerodynamic load thermal models and alarms if temperature exceeds $70^\circ\text{C}$.
   * **Radio Link Degradation**: Monitors signal attenuation and flags packet losses below $-85\text{ dBm}$.
   * **Low Battery Warn**: Alerts when capacity drops under $20\%$.
5. **Post-Flight Analytics Logs**: Client-side paginated index table to review compiled flights, view battery usages, average speed metrics, and launch coordinate replays.
6. **Role-Based Access Control**:
   * **Pilots**: View telemetries and monitor live missions.
   * **Admins**: Provision new drones, delete drones, and issue manual override commands.

---

## 🛠 Local Development Setup

### Prerequisites
* [Node.js](https://nodejs.org) (v18+)
* [Docker Desktop](https://www.docker.com/products/docker-desktop/)

### 1. Clone & Set Up Environmental Variables
In the `backend/` and `simulator/` folders, configure your `.env` files:

**`backend/.env`**:
```ini
PORT=4000
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/drone_flight?schema=public"
REDIS_URL="redis://localhost:6379"
MQTT_BROKER_URL="mqtt://localhost:1883"
JWT_SECRET="your-secure-secret-key"
```

**`simulator/.env`**:
```ini
MQTT_BROKER_URL="mqtt://localhost:1883"
SIMULATED_DRONE_IDS="drone-alpha-111,drone-beta-222"
```

### 2. Launch Local Database & Broker
Use Docker Compose in the root folder to spin up PostgreSQL, Redis, and a Mosquitto MQTT broker:
```bash
docker compose up -d
```

### 3. Initialize the Backend
Run Prisma migrations and launch the Express server:
```bash
cd backend
npm install
npx prisma db push
npm run dev
```

### 4. Start the Simulator
Run the simulated drones to generate telemetry:
```bash
cd simulator
npm install
npm run dev
```

### 5. Launch the Frontend
Start the React app local development server:
```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:5173` in your browser.
