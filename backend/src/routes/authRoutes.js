import express from 'express';
import {
  login,
  getMe,
  logout,
  changePassword,
  updateProfile,
  getAllUsers,
  createUser,
  updateUser,
  deleteUser,
} from '../controllers/authController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/login', login);
router.get('/me', protect, getMe);
router.post('/logout', logout);
router.put('/change-password', changePassword);
router.put('/profile', updateProfile);

// System Users Management Routes
router.get('/users', getAllUsers);
router.post('/users', createUser);
router.put('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);

export default router;

