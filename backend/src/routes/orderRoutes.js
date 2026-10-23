import { Router } from 'express';
import {
  createOrder,
  getAllOrders,
  getOrderById,
  seedOrders,
  updateKitchenStatus,
  getNextInvoiceNumberHandler,
  repairDuplicateInvoicesHandler,
  settleOrderBalance,
  deleteOrder,
} from '../controllers/orderController.js';
import {
  createOrderSchema,
  validate,
} from '../validators/orderValidator.js';

const router = Router();

// Collection routes
router.get('/', getAllOrders);
router.post('/', validate(createOrderSchema), createOrder);

// Next invoice sequence endpoint (must be before /:id)
router.get('/next-invoice-number', getNextInvoiceNumberHandler);
router.post('/repair-invoices', repairDuplicateInvoicesHandler);

// Seed sample orders
router.post('/seed', seedOrders);

// Single order routes
router.get('/:id', getOrderById);
router.patch('/:id/kitchen-status', updateKitchenStatus);
router.patch('/:id/settle-balance', settleOrderBalance);
router.delete('/:id', deleteOrder);

export default router;
