export interface User {
  id: string;
  email: string;
  name: string;
  role: 'PILOT' | 'ADMIN';
}

export interface Drone {
  id: string;
  name: string;
  serialNumber: string;
  model: string;
  status: 'IDLE' | 'TAKING_OFF' | 'FLYING' | 'RETURNING' | 'LANDING' | 'EMERGENCY' | 'OFFLINE';
  batteryLevel: number;
  currentLatitude: number | null;
  currentLongitude: number | null;
  currentAltitude: number | null;
  isOnline?: boolean;
  waypoints?: Waypoint[];
  createdAt: string;
  updatedAt: string;
}

export interface Waypoint {
  latitude: number;
  longitude: number;
  altitude: number | '';
  speed: number | '';
}

export interface FlightSession {
  id: string;
  droneId: string;
  drone: { name: string; model: string };
  pilotId: string | null;
  pilot?: { name: string; email: string };
  startTime: string;
  endTime: string | null;
  status: 'ACTIVE' | 'COMPLETED' | 'ABORTED';
  distanceTraveled: number;
  avgSpeed: number;
  maxAltitude: number;
  batteryConsumed: number;
  createdAt: string;
}

export interface TelemetryLog {
  id: string;
  flightSessionId: string;
  timestamp: string;
  latitude: number;
  longitude: number;
  altitude: number;
  speed: number;
  batteryLevel: number;
  temperature: number;
  signalStrength: number;
}

export interface Alert {
  id: string;
  droneId: string;
  drone: { name: string; model: string };
  flightSessionId: string | null;
  type: 'LOW_BATTERY' | 'HIGH_TEMP' | 'SIGNAL_LOSS' | 'GEOFENCE_VIOLATION';
  severity: 'WARNING' | 'CRITICAL';
  message: string;
  timestamp: string;
  resolved: boolean;
}

export interface DashboardStats {
  totalDrones: number;
  activeDrones: number;
  completedSessions: number;
  activeAlerts: number;
  totalDistanceKm: number;
}
