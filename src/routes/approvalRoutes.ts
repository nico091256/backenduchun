import { Router } from 'express';
import {
  getMyPendingApprovals,
  getMyApprovalHistory,
  getApprovalTabs,
  approveStep,
  rejectStep,
  bulkApproveSteps,
} from '../controllers/approvalController';
import { authenticate } from '../middleware/auth';
import { requireApprover } from '../middleware/roleGuard';

const router = Router();

router.use(authenticate);

router.get('/my', getMyPendingApprovals);
router.get('/history', getMyApprovalHistory);
router.get('/tabs', getApprovalTabs);
router.post('/bulk-approve', requireApprover, bulkApproveSteps);
router.post('/:stepId/approve', requireApprover, approveStep);
router.post('/:stepId/reject', requireApprover, rejectStep);

export default router;
