// backend/src/routes/transactions.js
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');

const validate = require('../middleware/validate');
const { protect } = require('../middleware/auth');

const {
  getRazorpayKey,
  createDeposit,
  verifyDeposit,
  getQrSettings,
  createQrDepositRequest,
  withdraw,
  getTransactions,
  getTransaction,
  getDeals, // ✅ NEW
} = require('../controllers/transactionController');

// PUBLIC
router.get('/razorpay-key', getRazorpayKey);

// PROTECTED
router.use(protect);

// ✅ NEW: Deals endpoint (must be before /:id)
router.get('/deals', getDeals);
router.get('/qr-settings', getQrSettings);

router.post(
  '/deposit/create',
  [
    body('accountId').notEmpty().withMessage('accountId is required'),
    body('amount').isFloat({ min: 100, max: 1000000 }).withMessage('amount must be ₹100 - ₹10,00,000'),
  ],
  validate,
  createDeposit
);

router.post(
  '/deposit/verify',
  [
    body('orderId').notEmpty(),
    body('paymentId').notEmpty(),
    body('signature').notEmpty(),
  ],
  validate,
  verifyDeposit
);

router.post(
  '/qr-deposit-request',
  [
    body('accountId').notEmpty().withMessage('accountId is required'),
    body('amount').isFloat({ min: 100, max: 1000000 }).withMessage('amount must be between 100 and 1000000'),
    body('paymentReference').trim().notEmpty().withMessage('paymentReference is required'),
    body('note').optional().isString(),
  ],
  validate,
  createQrDepositRequest
);

router.post(
  '/withdraw',
  [
    body('accountId').notEmpty(),
    body('amount').isFloat({ min: 100 }).withMessage('Minimum withdrawal is ₹100'),
    body('bankName').notEmpty(),
    body('accountNumber').notEmpty(),
    body('ifscCode').matches(/^[A-Z]{4}0[A-Z0-9]{6}$/).withMessage('Invalid IFSC'),
    body('accountHolderName').notEmpty(),
  ],
  validate,
  withdraw
);

router.get('/', getTransactions);
router.get('/:id', getTransaction);

module.exports = router;
