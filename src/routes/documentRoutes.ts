import { Router } from 'express';
import {
  getDocuments,
  getDocumentById,
  createDocument,
  updateDocument,
  submitDocument,
  executeDocument,
  resubmitDocument,
  closeDocument,
  deleteDocument,
  getDocumentStats,
  uploadDocumentFile,
  addDocumentAttachment,
  deleteDocumentAttachment,
  viewDocumentAttachment,
} from '../controllers/documentController';
import { authenticate } from '../middleware/auth';
import { requireInitiator } from '../middleware/roleGuard';
import { upload } from '../middleware/upload';

const router = Router();

router.use(authenticate);

const createUpload = upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'files', maxCount: 10 },
]);

router.get('/stats', getDocumentStats);
router.get('/', getDocuments);
router.get('/:id', getDocumentById);
router.post('/', requireInitiator, createUpload, createDocument);
router.post('/:id/file', upload.single('file'), uploadDocumentFile);
router.post('/:id/attachments', upload.single('file'), addDocumentAttachment);
router.post('/:id/attachments/:attachmentId/view', viewDocumentAttachment);
router.delete('/:id/attachments/:attachmentId', deleteDocumentAttachment);
router.patch('/:id', requireInitiator, createUpload, updateDocument);
router.patch('/:id/submit', requireInitiator, submitDocument);
router.patch('/:id/execute', requireInitiator, upload.single('executionFile'), executeDocument);
router.patch('/:id/resubmit', requireInitiator, resubmitDocument);
router.patch('/:id/close', closeDocument);
router.delete('/:id', requireInitiator, deleteDocument);

export default router;
