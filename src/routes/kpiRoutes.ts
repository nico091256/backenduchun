import { Router } from 'express';
import { getPersonalKPI, getUserKPI, getAllUsersKPI } from '../controllers/kpiController';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/roleGuard';

const router = Router();

router.use(authenticate);

// GET /api/kpi/personal — xodimning o'z KPI ko'rsatkichlari
router.get('/personal', getPersonalKPI);

// GET /api/kpi/users — Admin: barcha xodimlar KPI reytingi
router.get('/users', requireAdmin, getAllUsersKPI);

// GET /api/kpi/user/:userId — Admin: bitta xodimning KPI si
router.get('/user/:userId', requireAdmin, getUserKPI);

export default router;
