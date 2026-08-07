import { Router } from 'express';
import { getDashboardStats, listAlerts, resolveAlert } from '../controllers/analytics';
import { authenticateToken, authorize } from '../middleware/auth';

const router = Router();

// Secure all endpoints with authentication
router.use(authenticateToken);

router.get('/dashboard', authorize(['PILOT', 'ADMIN']), getDashboardStats);
router.get('/alerts', authorize(['PILOT', 'ADMIN']), listAlerts);
router.put('/alerts/:id/resolve', authorize(['PILOT', 'ADMIN']), resolveAlert);

export default router;
