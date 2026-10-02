import { Router } from 'express';
import {
  getTasks,
  getTaskStats,
  getTaskById,
  createTask,
  completeTask,
  addTaskComment,
  deleteTask,
  updateTask,
} from '../controllers/taskController';
import { authenticate } from '../middleware/auth';
import { upload } from '../middleware/upload';

const router = Router();

router.use(authenticate);

const taskUpload = upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'files', maxCount: 10 },
]);

router.get('/stats', getTaskStats);
router.get('/', getTasks);
router.get('/:id', getTaskById);
router.patch('/:id', updateTask);
router.post('/', taskUpload, createTask);
router.patch('/:id/execute', upload.single('executionFile'), completeTask);
router.post('/:id/comments', upload.single('file'), addTaskComment);
router.delete('/:id', deleteTask);

export default router;
