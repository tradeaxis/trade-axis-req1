const express = require('express');
const router = express.Router();
const webAdminController = require('../controllers/webAdminController');
const adminController = require('../controllers/adminController');
const messageController = require('../controllers/messageController');
const { protect, adminOnly, adminOrSubBroker } = require('../middleware/auth');

const webAdminAuth = [protect, adminOrSubBroker];

router.get('/summary', webAdminAuth, webAdminController.summary);
router.get('/symbols', webAdminAuth, webAdminController.listSymbols);
router.get('/action-ledger', webAdminAuth, webAdminController.actionLedger);
router.get('/users', webAdminAuth, webAdminController.listUsers);
router.post('/users', webAdminAuth, webAdminController.createUser);
router.patch('/users/:id/active', webAdminAuth, webAdminController.userWriteAccess, adminController.setUserActive);
router.post('/users/:id/reset-password', webAdminAuth, webAdminController.userWriteAccess, adminController.resetPassword);
router.patch('/users/:id/leverage', webAdminAuth, webAdminController.userWriteAccess, adminController.updateUserLeverage);
router.patch('/users/:id/brokerage', webAdminAuth, webAdminController.userWriteAccess, adminController.updateBrokerageRate);
router.patch('/users/:id/max-saved-accounts', webAdminAuth, webAdminController.userWriteAccess, adminController.updateMaxSavedAccounts);
router.patch('/users/:id/closing-mode', webAdminAuth, webAdminController.userWriteAccess, adminController.toggleClosingMode);
router.patch('/users/:id/liquidation-mode', webAdminAuth, webAdminController.userWriteAccess, adminController.updateLiquidationMode);
router.post('/users/:id/add-balance', webAdminAuth, webAdminController.userWriteAccess, adminController.addBalanceToAccount);
router.delete('/users/:id', webAdminAuth, webAdminController.userWriteAccess, adminController.deleteUser);
router.post('/assign-broker', protect, adminOnly, webAdminController.assignBroker);
router.delete('/accounts/:accountId/demo', webAdminAuth, webAdminController.deleteDemoAccount);
router.get('/auto-close-settings', webAdminAuth, webAdminController.getAutoCloseSettings);
router.post('/auto-close-settings', webAdminAuth, webAdminController.saveAutoCloseSettings);
router.get('/sub-broker-permissions', webAdminAuth, webAdminController.getSubBrokerFeaturePermissions);
router.post('/sub-broker-permissions', protect, adminOnly, webAdminController.saveSubBrokerFeaturePermissions);
router.post('/settlement-balance', protect, adminOnly, webAdminController.updateSettlementBalance);
router.get('/users/:id/segment-settings', webAdminAuth, webAdminController.userWriteAccess, webAdminController.getUserSegmentSettings);
router.post('/users/:id/segment-settings', webAdminAuth, webAdminController.userWriteAccess, webAdminController.saveUserSegmentSettings);
router.get('/users/:id/script-settings', webAdminAuth, webAdminController.userWriteAccess, webAdminController.getUserScriptSettings);
router.post('/users/:id/script-settings', webAdminAuth, webAdminController.userWriteAccess, webAdminController.saveUserScriptSettings);
router.post('/users/:id/copy-settings', webAdminAuth, webAdminController.userWriteAccess, webAdminController.copyUserSettings);
router.get('/leverage-margin-settings', webAdminAuth, webAdminController.getGlobalLeverageMarginSettings);
router.post('/leverage-margin-settings', webAdminAuth, webAdminController.saveGlobalLeverageMarginSettings);

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
router.get('/kite/settings', webAdminAuth, adminController.getKiteAuthSettings);
router.post('/kite/settings', webAdminAuth, adminController.updateKiteAuthSettings);

router.get('/support-messages', webAdminAuth, messageController.listSupportMessages);
router.post('/support-messages', webAdminAuth, messageController.sendSupportReply);
router.post('/support-messages/broadcast', webAdminAuth, messageController.sendSupportBroadcast);
router.patch('/support-messages/read', webAdminAuth, messageController.markSupportRead);

module.exports = router;
