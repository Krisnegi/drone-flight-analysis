import { Response } from 'express';
import { prisma } from '../services/db';
import { redis } from '../services/redis';
import { sendDroneCommand } from '../services/mqtt';
import { AuthenticatedRequest } from '../middleware/auth';

/**
 * Dispatch a drone on a flight mission with waypoints (Pilots and Admins)
 */
export async function dispatchDrone(req: AuthenticatedRequest, res: Response) {
  try {
    const { id: droneId } = req.params;
    const { waypoints } = req.body; // Array of { latitude, longitude, altitude, speed }

    if (!waypoints || !Array.isArray(waypoints) || waypoints.length === 0) {
      return res.status(400).json({ error: 'Waypoints are required and must be a non-empty array.' });
    }

    // 1. Fetch drone status
    const drone = await prisma.drone.findUnique({ where: { id: droneId } });
    if (!drone) {
      return res.status(404).json({ error: 'Drone not found.' });
    }

    if (drone.status !== 'IDLE' && drone.status !== 'LANDED') {
      return res.status(400).json({ error: `Cannot dispatch drone. Current status is ${drone.status}. Drone must be IDLE.` });
    }

    // 2. Persist flight plan waypoints in database (replaces old flight plan)
    await prisma.waypoint.deleteMany({ where: { droneId } });
    await prisma.waypoint.createMany({
      data: waypoints.map((wp: any, idx: number) => ({
        droneId,
        latitude: wp.latitude,
        longitude: wp.longitude,
        altitude: wp.altitude,
        speed: wp.speed,
        orderIndex: idx,
      })),
    });

    // 3. Register a new active flight session
    const session = await prisma.flightSession.create({
      data: {
        droneId,
        pilotId: req.user?.id || null,
        status: 'ACTIVE',
      },
    });

    // 4. Update status in database
    await prisma.drone.update({
      where: { id: droneId },
      data: { status: 'TAKING_OFF' },
    });

    // 5. Send command to simulator via MQTT broker
    sendDroneCommand(droneId, 'START_MISSION', {
      flightSessionId: session.id,
      waypoints: waypoints.map((wp: any) => ({
        latitude: wp.latitude,
        longitude: wp.longitude,
        altitude: wp.altitude,
        speed: wp.speed,
      })),
    });

    return res.status(201).json({
      message: 'Drone dispatched successfully.',
      flightSessionId: session.id,
    });
  } catch (error) {
    console.error('Dispatch drone error:', error);
    return res.status(500).json({ error: 'Internal server error while dispatching drone.' });
  }
}

/**
 * Handle manual overrides e.g. RETURN_TO_BASE, LAND, EMERGENCY_LAND (Pilots and Admins)
 */
export async function manualOverride(req: AuthenticatedRequest, res: Response) {
  try {
    const { id: droneId } = req.params;
    const { action } = req.body; // RETURN_TO_BASE, LAND, EMERGENCY_LAND

    const validActions = ['RETURN_TO_BASE', 'LAND', 'EMERGENCY_LAND'];
    if (!action || !validActions.includes(action)) {
      return res.status(400).json({ error: `Invalid action. Supported overrides: ${validActions.join(', ')}` });
    }

    const drone = await prisma.drone.findUnique({ where: { id: droneId } });
    if (!drone) {
      return res.status(404).json({ error: 'Drone not found.' });
    }

    // Determine target database status based on action
    let nextStatus = 'IDLE';
    if (action === 'RETURN_TO_BASE') nextStatus = 'RETURNING';
    else if (action === 'LAND') nextStatus = 'LANDING';
    else if (action === 'EMERGENCY_LAND') nextStatus = 'EMERGENCY';

    // 1. Dispatch override command to drone
    sendDroneCommand(droneId, action);

    // 2. Update status in database
    await prisma.drone.update({
      where: { id: droneId },
      data: { status: nextStatus },
    });

    return res.json({
      message: `Manual override "${action}" sent successfully.`,
      nextStatus,
    });
  } catch (error) {
    console.error('Manual override error:', error);
    return res.status(500).json({ error: 'Internal server error during manual override.' });
  }
}

/**
 * Fetch list of historical flight sessions (Pilots and Admins)
 */
export async function listSessions(req: AuthenticatedRequest, res: Response) {
  try {
    const { droneId, status } = req.query;

    const sessions = await prisma.flightSession.findMany({
      where: {
        droneId: droneId ? String(droneId) : undefined,
        status: status ? String(status) : undefined,
      },
      include: {
        drone: { select: { name: true, model: true } },
        pilot: { select: { name: true, email: true } },
      },
      orderBy: { startTime: 'desc' },
    });

    return res.json(sessions);
  } catch (error) {
    console.error('List sessions error:', error);
    return res.status(500).json({ error: 'Internal server error while fetching flight sessions.' });
  }
}

/**
 * Get details of a single flight session (Pilots and Admins)
 */
export async function getSession(req: AuthenticatedRequest, res: Response) {
  try {
    const { id } = req.params;

    const session = await prisma.flightSession.findUnique({
      where: { id },
      include: {
        drone: true,
        pilot: { select: { id: true, name: true, email: true } },
      },
    });

    if (!session) {
      return res.status(404).json({ error: 'Flight session not found.' });
    }

    return res.json(session);
  } catch (error) {
    console.error('Get session error:', error);
    return res.status(500).json({ error: 'Internal server error while fetching session details.' });
  }
}

/**
 * Get coordinate/telemetry logs for map route drawing (Pilots and Admins)
 */
export async function getSessionTelemetry(req: AuthenticatedRequest, res: Response) {
  try {
    const { id } = req.params;

    const logs = await prisma.telemetryLog.findMany({
      where: { flightSessionId: id },
      orderBy: { timestamp: 'asc' },
    });

    return res.json(logs);
  } catch (error) {
    console.error('Get session telemetry logs error:', error);
    return res.status(500).json({ error: 'Internal server error while fetching telemetry track.' });
  }
}

/**
 * Fetch current state from Redis cache (Pilots and Admins)
 */
export async function getLiveTelemetry(req: AuthenticatedRequest, res: Response) {
  try {
    const { id: droneId } = req.params;

    const cacheState = await redis.get(`drone:${droneId}:state`);
    if (!cacheState) {
      return res.status(404).json({ error: 'Live telemetry state not found. Drone may be offline.' });
    }

    return res.json(JSON.parse(cacheState));
  } catch (error) {
    console.error('Get live telemetry error:', error);
    return res.status(500).json({ error: 'Internal server error while fetching live telemetry.' });
  }
}
