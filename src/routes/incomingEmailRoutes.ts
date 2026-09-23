import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/roleGuard';
import { incomingEmailController } from '../controllers/incomingEmailController';

const router = Router();

// All incoming email routes require authentication and ADMIN or SECRETARY role
router.use(authenticate);
router.use(requireRole('ADMIN', 'SECRETARY'));


// GET /api/incoming-emails - Get all incoming emails
router.get('/', (req, res) => incomingEmailController.getIncomingEmails(req, res));

// POST /api/incoming-emails/sync - Trigger manual email sync
router.post('/sync', (req, res) => incomingEmailController.triggerSync(req, res));

// POST /api/incoming-emails/:id/assign - Assign incoming email to executor
router.post('/:id/assign', (req, res) => incomingEmailController.assignIncomingEmail(req, res));

export default router;
