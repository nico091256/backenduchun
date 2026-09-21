import { Router } from 'express';
import {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  resetUserPassword,
  deleteUser,
  getApprovers,
} from '../controllers/userController';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/roleGuard';

const router = Router();

router.use(authenticate);

router.get('/approvers', getApprovers);
router.get('/', requireAdmin, getUsers);
router.get('/:id', getUserById);
router.post('/', requireAdmin, createUser);
router.patch('/:id/password', requireAdmin, resetUserPassword);
router.patch('/:id', requireAdmin, updateUser);
router.delete('/:id', requireAdmin, deleteUser);

export default router;
