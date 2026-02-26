// backend/src/routes/admin.js
const express = require('express');
const router = express.Router();

const { protect, adminOnly } = require('../middleware/auth');
const adminController = require('../controllers/adminController');

router.use(protect);
router.use(adminOnly);

// Users
router.get('/users', adminController.listUsers);
router.post('/users', adminController.createUser);
router.patch('/users/:id/active', adminController.setUserActive);
router.post('/users/:id/reset-password', adminController.resetPassword);

// ✅ Withdrawals (Admin wallet ops)
router.get('/withdrawals', adminController.listWithdrawals);
router.post('/withdrawals/:id/approve', adminController.approveWithdrawal);
router.post('/withdrawals/:id/reject', adminController.rejectWithdrawal);

module.exports = router;