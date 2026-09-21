import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/roleGuard';
import {
  updateDocumentDeadline,
  updateStepDeadline,
  reassignStep,
  forceApproveStep,
  cancelDocument,
  rollbackDocumentToApproval,
} from '../controllers/adminController';
import {
  getAuditLog,
  getAuditActionTypes,
  getUserActivity,
} from '../controllers/auditController';

const router = Router();

// Only ADMIN users can access these routes
router.use(authenticate, requireAdmin);

router.patch('/documents/:id/deadline', updateDocumentDeadline);
router.patch('/steps/:stepId/deadline', updateStepDeadline);
router.patch('/steps/:stepId/reassign', reassignStep);
router.post('/steps/:stepId/force-approve', forceApproveStep);
router.post('/documents/:id/cancel', cancelDocument);
router.post('/documents/:id/rollback-to-approval', rollbackDocumentToApproval);

// Audit Log routes
router.get('/audit-log', getAuditLog);
router.get('/audit-log/actions', getAuditActionTypes);
router.get('/users/:userId/activity', getUserActivity);

export default router;
