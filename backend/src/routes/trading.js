// backend/src/routes/trading.js
const express = require('express');
const router = express.Router();
const tradingController = require('../controllers/tradingController');
const { protect } = require('../middleware/auth');

// All routes require authentication
router.use(protect);

// ============ POSITIONS ============
// Get open positions
router.get('/positions/:accountId', tradingController.getPositions);

// Place order (market or pending)
router.post('/order', tradingController.placeOrder);

// Close all positions (must be before /close/:tradeId)
router.post('/close-all', tradingController.closeAllPositions);

// Close position
router.post('/close/:tradeId', tradingController.closePosition);

// Partial close position
router.post('/partial-close/:tradeId', tradingController.partialClose);

// Modify position (SL/TP)
router.put('/modify/:tradeId', tradingController.modifyPosition);

// ============ PENDING ORDERS ============
// Cancel all pending orders (must be before /:orderId routes)
router.delete('/pending-orders/all', tradingController.cancelAllPendingOrders);

// Get pending orders
router.get('/pending-orders/:accountId', tradingController.getPendingOrders);

// Modify pending order
router.put('/pending-order/:orderId', tradingController.modifyPendingOrder);

// Cancel pending order
router.delete('/pending-order/:orderId', tradingController.cancelPendingOrder);

// ============ HISTORY ============
// Get trade history
router.get('/history', tradingController.getTradeHistory);

// Get trade statistics
router.get('/stats', tradingController.getTradeStats);

module.exports = router;