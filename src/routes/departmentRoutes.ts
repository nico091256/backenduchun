import { Router } from 'express';
import {
  getDepartments,
  getDepartmentTree,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  assignUserToDepartment,
  unassignUserFromDepartment,
} from '../controllers/departmentController';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/roleGuard';

const router = Router();

router.use(authenticate);

router.get('/', getDepartments);
router.get('/tree', getDepartmentTree);
router.post('/', requireAdmin, createDepartment);
router.put('/:id', requireAdmin, updateDepartment);
router.delete('/:id', requireAdmin, deleteDepartment);
router.post('/:id/assign-user', assignUserToDepartment);
router.post('/:id/unassign-user', unassignUserFromDepartment);

export default router;
