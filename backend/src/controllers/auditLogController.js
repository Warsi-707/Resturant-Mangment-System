import { AuditLog } from '../models/AuditLog.js';
import { isDbConnected } from '../config/db.js';

export async function getAllAuditLogs(req, res, next) {
  try {
    if (!isDbConnected()) {
      return res.status(200).json({
        success: true,
        count: 0,
        data: [],
        offline: true,
      });
    }

    const logs = await AuditLog.find({}).sort({ createdAt: -1 });
    return res.status(200).json({
      success: true,
      count: logs.length,
      data: logs,
    });
  } catch (error) {
    next(error);
  }
}

export async function createAuditLog(req, res, next) {
  try {
    const {
      id,
      type = 'invoice_delete',
      title = '',
      deletedAt = new Date().toISOString(),
      reason = '',
      totalInvoicesDeleted = 1,
      totalAmount = 0,
      invoices = [],
    } = req.body;

    const auditId = id || `del-inv-${Date.now()}`;

    const created = await AuditLog.findOneAndUpdate(
      { id: auditId },
      {
        id: auditId,
        type,
        title,
        deletedAt,
        reason,
        totalInvoicesDeleted,
        totalAmount,
        invoices,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.status(201).json({
      success: true,
      data: created,
    });
  } catch (error) {
    next(error);
  }
}

export async function clearAuditLogs(req, res, next) {
  try {
    await AuditLog.deleteMany({});
    return res.status(200).json({
      success: true,
      message: 'Audit history cleared successfully',
    });
  } catch (error) {
    next(error);
  }
}
