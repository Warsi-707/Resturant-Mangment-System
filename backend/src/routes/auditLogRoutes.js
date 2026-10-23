import { Router } from 'express';
import {
  getAllAuditLogs,
  createAuditLog,
  clearAuditLogs,
} from '../controllers/auditLogController.js';

const router = Router();

router.get('/', getAllAuditLogs);
router.post('/', createAuditLog);
router.delete('/', clearAuditLogs);

export default router;
