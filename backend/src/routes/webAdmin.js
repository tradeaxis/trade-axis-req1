const express = require('express');
const router = express.Router();
const webAdminController = require('../controllers/webAdminController');
const adminController = require('../controllers/adminController');
const { protect, adminOnly, adminOrSubBroker } = require('../middleware/auth');

const webAdminAuth = [protect, adminOrSubBroker];

router.get('/summary', webAdminAuth, webAdminController.summary);
router.get('/users', webAdminAuth, webAdminController.listUsers);
router.post('/users', webAdminAuth, webAdminController.createUser);
router.post('/assign-broker', protect, adminOnly, webAdminController.assignBroker);

router.get('/transactions', webAdminAuth, webAdminController.listTransactions);
router.post('/transactions/:id/action', webAdminAuth, webAdminController.updateTransaction);

router.get('/open-positions', webAdminAuth, webAdminController.openPositions);
router.get('/positions', webAdminAuth, webAdminController.positions);
router.get('/orders', webAdminAuth, webAdminController.orders);
router.post('/trade-on-behalf', webAdminAuth, webAdminController.tradeOnBehalf);

router.get('/market-holiday', webAdminAuth, adminController.getMarketHoliday);
router.post('/market-holiday', webAdminAuth, adminController.setMarketHoliday);
router.post('/close-position', webAdminAuth, webAdminController.closePosition, adminController.adminClosePosition);
router.post('/users/close-all-positions', webAdminAuth, webAdminController.closeAllUserPositions, adminController.adminCloseAllUserPositions);
router.post('/positions/:tradeId/reopen', webAdminAuth, webAdminController.reopenPosition);
router.patch('/positions/:tradeId', webAdminAuth, webAdminController.positionWriteAccess, adminController.adminUpdatePosition);
router.delete('/positions/:tradeId', webAdminAuth, webAdminController.positionWriteAccess, adminController.adminDeletePosition);
router.post('/symbol-ban', webAdminAuth, adminController.toggleSymbolBan);

router.get('/qr-settings', webAdminAuth, adminController.getQrSettings);
router.post('/qr-settings', webAdminAuth, adminController.saveQrSettings);

router.get('/kite/status', webAdminAuth, adminController.kiteStatus);
router.get('/kite/login-url', webAdminAuth, adminController.getKiteLoginUrl);
router.post('/kite/create-session', webAdminAuth, adminController.createKiteSession);
router.post('/kite/sync-symbols', webAdminAuth, adminController.syncKiteSymbols);
router.post('/kite/start-stream', webAdminAuth, adminController.startKiteStream);
router.post('/kite/stop-stream', webAdminAuth, adminController.stopKiteStream);

module.exports = router;
