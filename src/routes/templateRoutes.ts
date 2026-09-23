import { Router } from 'express';
import {
  getAllTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from '../controllers/templateController';
import { authenticate } from '../middleware/auth';
import { requireInitiator } from '../middleware/roleGuard';

const router = Router();

router.use(authenticate);

router.get('/', getAllTemplates);
router.get('/:id', getTemplateById);
router.post('/', requireInitiator, createTemplate);
router.put('/:id', requireInitiator, updateTemplate);
router.delete('/:id', requireInitiator, deleteTemplate);

export default router;
