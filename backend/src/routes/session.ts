import { Router } from 'express';
import {
  dispatchDrone,
  manualOverride,
  listSessions,
  getSession,
  getSessionTelemetry,
  getLiveTelemetry,
} from '../controllers/session';
import { authenticateToken, authorize } from '../middleware/auth';

const router = Router();

// Secure all endpoints with authentication
router.use(authenticateToken);

router.post('/drones/:id/dispatch', authorize(['PILOT', 'ADMIN']), dispatchDrone);
router.post('/drones/:id/override', authorize(['PILOT', 'ADMIN']), manualOverride);
router.get('/drones/:id/telemetry/live', authorize(['PILOT', 'ADMIN']), getLiveTelemetry);

router.get('/', authorize(['PILOT', 'ADMIN']), listSessions);
router.get('/:id', authorize(['PILOT', 'ADMIN']), getSession);
router.get('/:id/telemetry', authorize(['PILOT', 'ADMIN']), getSessionTelemetry);

export default router;
