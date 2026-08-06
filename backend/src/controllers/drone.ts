import { Response } from 'express';
import { prisma } from '../services/db';
import { AuthenticatedRequest } from '../middleware/auth';

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
    return res.json(drones);
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

    return res.json(drone);
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
