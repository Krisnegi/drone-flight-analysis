import { Response } from 'express';
import { prisma } from '../services/db';
import { AuthenticatedRequest } from '../middleware/auth';

/**
 * Fetch aggregated metrics for the dashboard stats grid (Pilots & Admins)
 */
export async function getDashboardStats(req: AuthenticatedRequest, res: Response) {
  try {
    const [totalDrones, activeDrones, completedSessions, activeAlerts, distanceSum] = await Promise.all([
      prisma.drone.count(),
      prisma.drone.count({
        where: {
          status: {
            in: ['TAKING_OFF', 'FLYING', 'RETURNING', 'LANDING', 'EMERGENCY'],
          },
        },
      }),
      prisma.flightSession.count({ where: { status: 'COMPLETED' } }),
      prisma.alert.count({ where: { resolved: false } }),
      prisma.flightSession.aggregate({
        _sum: {
          distanceTraveled: true,
        },
      }),
    ]);

    return res.json({
      totalDrones,
      activeDrones,
      completedSessions,
      activeAlerts,
      totalDistanceKm: parseFloat((distanceSum._sum.distanceTraveled || 0.0).toFixed(2)),
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    return res.status(500).json({ error: 'Internal server error while compiling stats.' });
  }
}

/**
 * Fetch alerts history feed (Pilots & Admins)
 */
export async function listAlerts(req: AuthenticatedRequest, res: Response) {
  try {
    const { droneId, resolved, severity } = req.query;

    const alerts = await prisma.alert.findMany({
      where: {
        droneId: droneId ? String(droneId) : undefined,
        resolved: resolved !== undefined ? resolved === 'true' : undefined,
        severity: severity ? String(severity) : undefined,
      },
      include: {
        drone: { select: { name: true, model: true } },
      },
      orderBy: { timestamp: 'desc' },
    });

    return res.json(alerts);
  } catch (error) {
    console.error('List alerts error:', error);
    return res.status(500).json({ error: 'Internal server error while fetching alerts feed.' });
  }
}

/**
 * Resolve an active alert manually (Pilots & Admins)
 */
export async function resolveAlert(req: AuthenticatedRequest, res: Response) {
  try {
    const { id } = req.params;

    const alert = await prisma.alert.findUnique({ where: { id } });
    if (!alert) {
      return res.status(404).json({ error: 'Alert not found.' });
    }

    const updatedAlert = await prisma.alert.update({
      where: { id },
      data: { resolved: true },
    });

    return res.json({
      message: 'Alert marked as resolved.',
      alert: updatedAlert,
    });
  } catch (error) {
    console.error('Resolve alert error:', error);
    return res.status(500).json({ error: 'Internal server error while resolving alert.' });
  }
}
