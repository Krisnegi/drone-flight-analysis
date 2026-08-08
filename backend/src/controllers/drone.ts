import { Response } from 'express';
import { prisma } from '../services/db';
import { AuthenticatedRequest } from '../middleware/auth';
import { redis } from '../services/redis';

/**
 * Register a new drone in the database (Admin only)
 */
export async function createDrone(req: AuthenticatedRequest, res: Response) {
  try {
    const { name, serialNumber, model } = req.body;

    if (!name || !serialNumber || !model) {
      return res.status(400).json({ error: 'Drone name, serialNumber, and model are required' });
    }

    // Verify uniqueness of serial number
    const existingDrone = await prisma.drone.findUnique({ where: { serialNumber } });
    if (existingDrone) {
      return res.status(400).json({ error: 'A drone with this serial number is already registered' });
    }

    const drone = await prisma.drone.create({
      data: {
        name,
        serialNumber,
        model,
      },
    });

    return res.status(201).json({
      message: 'Drone registered successfully',
      drone,
    });
  } catch (error) {
    console.error('Create drone error:', error);
    return res.status(500).json({ error: 'Internal server error while registering drone' });
  }
}

/**
 * Fetch all registered drones (Pilots & Admins)
 */
export async function listDrones(req: AuthenticatedRequest, res: Response) {
  try {
    const drones = await prisma.drone.findMany({
      orderBy: { createdAt: 'desc' },
    });

    // Check if the drone is actively broadcasting simulator telemetry in the last 5 seconds
    const dronesWithStatus = await Promise.all(
      drones.map(async (drone) => {
        const cacheState = await redis.get(`drone:${drone.id}:state`);
        let isOnline = false;
        if (cacheState) {
          try {
            const payload = JSON.parse(cacheState);
            const lastUpdated = new Date(payload.timestamp).getTime();
            isOnline = (Date.now() - lastUpdated) < 5000;
          } catch (e) {
            // ignore JSON parse errors
          }
        }
        const waypoints = await prisma.waypoint.findMany({
          where: { droneId: drone.id },
          orderBy: { orderIndex: 'asc' },
        });
        return {
          ...drone,
          isOnline,
          waypoints,
        };
      })
    );

    return res.json(dronesWithStatus);
  } catch (error) {
    console.error('List drones error:', error);
    return res.status(500).json({ error: 'Internal server error while fetching drones list' });
  }
}

/**
 * Retrieve specific drone details by ID along with its 5 most recent flight sessions (Pilots & Admins)
 */
export async function getDrone(req: AuthenticatedRequest, res: Response) {
  try {
    const { id } = req.params;

    const drone = await prisma.drone.findUnique({
      where: { id },
      include: {
        sessions: {
          take: 5,
          orderBy: { startTime: 'desc' },
        },
      },
    });

    if (!drone) {
      return res.status(404).json({ error: 'Drone not found' });
    }

    const cacheState = await redis.get(`drone:${drone.id}:state`);
    let isOnline = false;
    if (cacheState) {
      try {
        const payload = JSON.parse(cacheState);
        const lastUpdated = new Date(payload.timestamp).getTime();
        isOnline = (Date.now() - lastUpdated) < 5000;
      } catch (e) {}
    }

    const waypoints = await prisma.waypoint.findMany({
      where: { droneId: drone.id },
      orderBy: { orderIndex: 'asc' },
    });

    return res.json({
      ...drone,
      isOnline,
      waypoints,
    });
  } catch (error) {
    console.error('Get drone error:', error);
    return res.status(500).json({ error: 'Internal server error while fetching drone' });
  }
}

/**
 * Remove a drone record from the database (Admin only)
 */
export async function deleteDrone(req: AuthenticatedRequest, res: Response) {
  try {
    const { id } = req.params;

    const drone = await prisma.drone.findUnique({ where: { id } });
    if (!drone) {
      return res.status(404).json({ error: 'Drone not found' });
    }

    await prisma.drone.delete({ where: { id } });

    return res.json({
      message: 'Drone removed successfully'
    });
  } catch (error) {
    console.error('Delete drone error:', error);
    return res.status(500).json({ error: 'Internal server error while deleting drone' });
  }
}
