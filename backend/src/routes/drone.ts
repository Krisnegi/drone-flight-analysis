import { Router } from 'express';
import { createDrone, listDrones, getDrone, deleteDrone } from '../controllers/drone';
import { authenticateToken, authorize } from '../middleware/auth';

const router = Router();

// Secure all endpoints below with JWT authentication
router.use(authenticateToken);

router.post('/', authorize(['ADMIN']), createDrone);
router.get('/', authorize(['PILOT', 'ADMIN']), listDrones);
router.get('/:id', authorize(['PILOT', 'ADMIN']), getDrone);
router.delete('/:id', authorize(['ADMIN']), deleteDrone);

export default router;
