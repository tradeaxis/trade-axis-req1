const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { getAllowedLeverageOptions, isAllowedLeverage } = require('../config/leverageOptions');

const {
  getAccounts,
  getAccount,
  createAccount,
  updateAccount,
  resetDemoAccount,
  getAccountSummary
} = require('../controllers/accountController');

// All routes are protected
router.use(protect);

// @route   GET /api/accounts
router.get('/', getAccounts);

// @route   GET /api/accounts/:id
router.get('/:id', getAccount);

// @route   GET /api/accounts/:id/summary
router.get('/:id/summary', getAccountSummary);

// @route   POST /api/accounts
router.post('/', [
  body('accountType')
    .optional()
    .isIn(['demo', 'standard', 'premium'])
    .withMessage('Invalid account type'),
  body('leverage')
    .optional()
    .custom((value) => isAllowedLeverage(value))
    .withMessage(() => `Invalid leverage. Allowed: ${getAllowedLeverageOptions().join(', ')}`),
  body('isDemo')
    .optional()
    .isBoolean()
    .withMessage('isDemo must be boolean')
], validate, createAccount);

// @route   PUT /api/accounts/:id
router.put('/:id', [
  body('leverage')
    .optional()
    .custom((value) => isAllowedLeverage(value))
    .withMessage(() => `Invalid leverage. Allowed: ${getAllowedLeverageOptions().join(', ')}`)
], validate, updateAccount);

// @route   POST /api/accounts/:id/reset
router.post('/:id/reset', resetDemoAccount);

module.exports = router;
