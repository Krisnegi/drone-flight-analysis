import { MqttClient } from 'mqtt';

interface Waypoint {
  latitude: number;
  longitude: number;
  altitude: number; // in meters
  speed: number;    // in m/s
}

export class SimulatedDrone {
  private droneId: string;
  private mqttClient: MqttClient;

  // Home coordinates
  private homeLatitude: number;
  private homeLongitude: number;

  // Drone State Variables
  private status: string = 'IDLE'; // IDLE, TAKING_OFF, FLYING, RETURNING, LANDING, EMERGENCY
  private latitude: number;
  private longitude: number;
  private altitude: number = 0.0;
  private speed: number = 0.0;
  private batteryLevel: number = 100;
  private temperature: number = 25.0; // °C
  private signalStrength: number = -30; // dBm
  private flightSessionId: string | null = null;

  // Mission Variables
  private waypoints: Waypoint[] = [];
  private currentWaypointIndex: number = 0;

  constructor(droneId: string, mqttClient: MqttClient, startLat: number = 12.971598, startLng: number = 77.594562) {
    this.droneId = droneId;
    this.mqttClient = mqttClient;
    this.homeLatitude = startLat;
    this.homeLongitude = startLng;
    this.latitude = startLat;
    this.longitude = startLng;

    // Subscribe to commands for this specific drone
    const commandTopic = `drones/${this.droneId}/commands`;
    this.mqttClient.subscribe(commandTopic, (err) => {
      if (err) {
        console.error(`[Drone ${this.droneId}] Failed to subscribe to commands topic:`, err);
      } else {
        console.log(`[Drone ${this.droneId}] Listening for commands on: ${commandTopic}`);
      }
    });

    // Handle incoming command messages
    this.mqttClient.on('message', (topic, message) => {
      if (topic === commandTopic) {
        this.handleCommand(message.toString());
      }
    });
  }

  /**
   * Process commands received via MQTT
   */
  private handleCommand(messageStr: string) {
    try {
      const payload = JSON.parse(messageStr);
      console.log(`[Drone ${this.droneId}] Received command:`, payload);

      switch (payload.command) {
        case 'START_MISSION':
          if (!payload.flightSessionId || !payload.waypoints || payload.waypoints.length === 0) {
            console.error(`[Drone ${this.droneId}] Invalid START_MISSION payload.`);
            return;
          }
          this.startMission(payload.flightSessionId, payload.waypoints);
          break;

        case 'RETURN_TO_BASE':
          this.returnToBase();
          break;

        case 'LAND':
          this.land();
          break;

        case 'EMERGENCY_LAND':
          this.triggerEmergency();
          break;

        default:
          console.warn(`[Drone ${this.droneId}] Unknown command received: ${payload.command}`);
      }
    } catch (err) {
      console.error(`[Drone ${this.droneId}] Error parsing command message:`, err);
    }
  }

  private startMission(flightSessionId: string, waypoints: Waypoint[]) {
    this.flightSessionId = flightSessionId;
    this.waypoints = waypoints;
    this.currentWaypointIndex = 0;
    this.status = 'TAKING_OFF';
    console.log(`[Drone ${this.droneId}] Starting mission: ${flightSessionId}. Taking off...`);
  }

  private returnToBase() {
    this.status = 'RETURNING';
    console.log(`[Drone ${this.droneId}] Returning to base.`);
  }

  private land() {
    this.status = 'LANDING';
    console.log(`[Drone ${this.droneId}] Initiating immediate landing sequence.`);
  }

  private triggerEmergency() {
    this.status = 'EMERGENCY';
    console.error(`[Drone ${this.droneId}] EMERGENCY LAND ACTIVE! DESCENDING IMMEDIATELY.`);
  }

  /**
   * Run physics / state tick (Called once per second)
   */
  public updateState() {
    const ambientTemp = 25.0;

    switch (this.status) {
      case 'IDLE':
        // Battery recharges slowly if idle at home base
        if (this.isNearHome() && this.batteryLevel < 100) {
          this.batteryLevel = Math.min(100, this.batteryLevel + 1);
        }
        // Cool down towards ambient temperature
        this.temperature += (ambientTemp - this.temperature) * 0.1;
        this.speed = 0.0;
        this.altitude = 0.0;
        this.signalStrength = -30;
        break;

      case 'TAKING_OFF': {
        const targetAlt = this.waypoints.length > 0 ? this.waypoints[0].altitude : 15.0;
        const climbRate = 2.0; // 2 meters per second ascent

        if (this.altitude < targetAlt) {
          this.altitude = Math.min(targetAlt, this.altitude + climbRate);
        } else {
          this.status = this.waypoints.length > 0 ? 'FLYING' : 'IDLE';
          console.log(`[Drone ${this.droneId}] Takeoff complete. Current altitude: ${this.altitude}m. Transitioning to state: ${this.status}`);
        }

        // Taking off drains battery and increases temp
        this.batteryLevel = Math.max(0, this.batteryLevel - 0.15);
        this.temperature += (45.0 - this.temperature) * 0.08;
        this.signalStrength = this.calculateSignalStrength();
        break;
      }

      case 'FLYING': {
        if (this.waypoints.length === 0 || this.currentWaypointIndex >= this.waypoints.length) {
          this.status = 'RETURNING';
          break;
        }

        const target = this.waypoints[this.currentWaypointIndex];
        const dist = this.getDistanceMeters(this.latitude, this.longitude, target.latitude, target.longitude);

        // Adjust speed towards target waypoint speed
        const accel = 1.5; // m/s² acceleration
        if (this.speed < target.speed) {
          this.speed = Math.min(target.speed, this.speed + accel);
        } else if (this.speed > target.speed) {
          this.speed = Math.max(target.speed, this.speed - accel);
        }

        // Adjust altitude towards target waypoint altitude
        const vertRate = 1.5; // m/s vertical speed
        if (this.altitude < target.altitude) {
          this.altitude = Math.min(target.altitude, this.altitude + vertRate);
        } else if (this.altitude > target.altitude) {
          this.altitude = Math.max(target.altitude, this.altitude - vertRate);
        }

        // Move position towards target coordinates based on current speed
        if (dist > 2.0) {
          const dy = (target.latitude - this.latitude) * 111000;
          const dx = (target.longitude - this.longitude) * 111000 * Math.cos((this.latitude * Math.PI) / 180);
          
          const angle = Math.atan2(dy, dx);
          
          // Speed is m/s. Move by speed * 1s
          const moveDist = this.speed * 1.0; 
          const moveY = moveDist * Math.sin(angle);
          const moveX = moveDist * Math.cos(angle);

          this.latitude += moveY / 111000;
          this.longitude += moveX / (111000 * Math.cos((this.latitude * Math.PI) / 180));
        } else {
          // Reached current waypoint
          console.log(`[Drone ${this.droneId}] Reached waypoint index ${this.currentWaypointIndex} at (${this.latitude.toFixed(6)}, ${this.longitude.toFixed(6)})`);
          this.currentWaypointIndex++;
          if (this.currentWaypointIndex >= this.waypoints.length) {
            console.log(`[Drone ${this.droneId}] Mission path completed. Returning to base.`);
            this.status = 'RETURNING';
          }
        }

        // Calculate battery depletion: base + speed multiplier + climb penalty
        const climbPenalty = this.altitude < target.altitude ? 0.05 : 0.0;
        const depletion = 0.05 + (this.speed * 0.01) + climbPenalty;
        this.batteryLevel = Math.max(0, this.batteryLevel - depletion);

        // Calculate temperature based on engine strain (speed + climb)
        const targetTemp = 35.0 + (this.speed * 3.5) + (climbPenalty > 0 ? 10.0 : 0.0);
        this.temperature += (targetTemp - this.temperature) * 0.1;

        this.signalStrength = this.calculateSignalStrength();
        break;
      }

      case 'RETURNING': {
        const dist = this.getDistanceMeters(this.latitude, this.longitude, this.homeLatitude, this.homeLongitude);
        const returnSpeed = 8.0; // 8 m/s return cruise speed
        const returnAlt = 20.0; // 20m return altitude safety line

        // Adjust speed
        if (this.speed < returnSpeed) this.speed = Math.min(returnSpeed, this.speed + 1.5);
        else if (this.speed > returnSpeed) this.speed = Math.max(returnSpeed, this.speed - 1.5);

        // Adjust altitude
        if (this.altitude < returnAlt) this.altitude = Math.min(returnAlt, this.altitude + 1.5);
        else if (this.altitude > returnAlt) this.altitude = Math.max(returnAlt, this.altitude - 1.5);

        if (dist > 3.0) {
          const dy = (this.homeLatitude - this.latitude) * 111000;
          const dx = (this.homeLongitude - this.longitude) * 111000 * Math.cos((this.latitude * Math.PI) / 180);
          
          const angle = Math.atan2(dy, dx);
          const moveDist = this.speed * 1.0;
          const moveY = moveDist * Math.sin(angle);
          const moveX = moveDist * Math.cos(angle);

          this.latitude += moveY / 111000;
          this.longitude += moveX / (111000 * Math.cos((this.latitude * Math.PI) / 180));
        } else {
          console.log(`[Drone ${this.droneId}] Arrived back above home base. Landing...`);
          this.status = 'LANDING';
        }

        // Return flight battery & temperature drain
        this.batteryLevel = Math.max(0, this.batteryLevel - 0.12);
        this.temperature += (50.0 - this.temperature) * 0.1;
        this.signalStrength = this.calculateSignalStrength();
        break;
      }

      case 'LANDING': {
        const descentRate = 1.5; // 1.5 m/s descent
        this.speed = 0.5; // slow drift horizontal speed

        if (this.altitude > 0) {
          this.altitude = Math.max(0.0, this.altitude - descentRate);
        } else {
          console.log(`[Drone ${this.droneId}] Landed successfully.`);
          this.status = 'IDLE';
          this.flightSessionId = null;
        }

        // Landing power consumption and engine cooldown
        this.batteryLevel = Math.max(0, this.batteryLevel - 0.05);
        this.temperature += (ambientTemp - this.temperature) * 0.15;
        this.signalStrength = this.calculateSignalStrength();
        break;
      }

      case 'EMERGENCY': {
        const dropRate = 3.0; // Rapid emergency drop descent rate
        this.speed = 0.0;

        if (this.altitude > 0) {
          this.altitude = Math.max(0.0, this.altitude - dropRate);
        } else {
          console.log(`[Drone ${this.droneId}] Emergency landing complete.`);
          this.status = 'IDLE';
          this.flightSessionId = null;
        }

        // Temperature cools down quickly since power cut
        this.temperature += (ambientTemp - this.temperature) * 0.2;
        this.signalStrength = this.calculateSignalStrength();
        break;
      }
    }

    // Publish telemetry over MQTT
    this.publishTelemetry();
  }

  private isNearHome(): boolean {
    return this.getDistanceMeters(this.latitude, this.longitude, this.homeLatitude, this.homeLongitude) < 1.0;
  }

  private calculateSignalStrength(): number {
    const dist = this.getDistanceMeters(this.latitude, this.longitude, this.homeLatitude, this.homeLongitude);
    // Base -30dBm at 0 meters. Drops by 0.06 dBm per meter.
    const rawSignal = -30 - (dist * 0.06);
    // Add random signal flutter (-2 to +2 dBm)
    const flutter = (Math.random() * 4) - 2;
    // Cap at minimum -100dBm
    return Math.max(-100, Math.round(rawSignal + flutter));
  }

  private getDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const dy = (lat2 - lat1) * 111000;
    const dx = (lng2 - lng1) * 111000 * Math.cos((lat1 * Math.PI) / 180);
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Publish current telemetry state via MQTT
   */
  private publishTelemetry() {
    const topic = `drones/${this.droneId}/telemetry`;
    const payload = {
      droneId: this.droneId,
      flightSessionId: this.flightSessionId,
      timestamp: new Date().toISOString(),
      status: this.status,
      latitude: parseFloat(this.latitude.toFixed(6)),
      longitude: parseFloat(this.longitude.toFixed(6)),
      altitude: parseFloat(this.altitude.toFixed(1)),
      speed: parseFloat(this.speed.toFixed(1)),
      batteryLevel: Math.round(this.batteryLevel),
      temperature: parseFloat(this.temperature.toFixed(1)),
      signalStrength: this.signalStrength,
    };

    this.mqttClient.publish(topic, JSON.stringify(payload), { qos: 0 }, (err) => {
      if (err) {
        console.error(`[Drone ${this.droneId}] Failed to publish telemetry:`, err);
      }
    });
  }
}
