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
import { requireAdmin, requireAdminOrPermission } from '../middleware/roleGuard';

const router = Router();

router.use(authenticate);

router.get('/approvers', getApprovers);
router.get('/', getUsers);
router.get('/:id', getUserById);
router.post('/', requireAdminOrPermission('USERS_MANAGE'), createUser);
router.patch('/:id/password', requireAdminOrPermission('USERS_MANAGE'), resetUserPassword);
router.patch('/:id', requireAdminOrPermission('USERS_MANAGE'), updateUser);
router.delete('/:id', requireAdminOrPermission('USERS_MANAGE'), deleteUser);

export default router;
