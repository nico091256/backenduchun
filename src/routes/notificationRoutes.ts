import { Router } from 'express';
import {
  getMyNotifications,
  markAsRead,
  markAllAsRead,
  clearAllNotifications,
} from '../controllers/notificationController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/', getMyNotifications);
router.patch('/read-all', markAllAsRead);
router.patch('/:id/read', markAsRead);
router.delete('/clear', clearAllNotifications);

export default router;
