import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getMyDelegations, createDelegation, cancelDelegation } from '../controllers/delegationController';

const router = Router();

router.use(authenticate);

router.get('/', getMyDelegations);
router.post('/', createDelegation);
router.patch('/:id/cancel', cancelDelegation);

export default router;
