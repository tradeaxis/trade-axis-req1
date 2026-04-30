const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { protect, adminOnly } = require('../middleware/auth');

// ✅ Combined admin middleware
const adminAuth = [protect, adminOnly];

// ================= USER ROUTES =================
router.get('/users', adminAuth, adminController.listUsers);
router.get('/leverage-options', adminAuth, adminController.getLeverageOptions);
router.post('/users', adminAuth, adminController.createUser);
router.patch('/users/:id/active', adminAuth, adminController.setUserActive);
router.post('/users/:id/reset-password', adminAuth, adminController.resetPassword);
router.patch('/users/:id/leverage', adminAuth, adminController.updateUserLeverage);
router.patch('/users/:id/equity', adminAuth, adminController.updateAccountEquity);
router.patch('/users/:id/brokerage', adminAuth, adminController.updateBrokerageRate);
router.patch('/users/:id/max-saved-accounts', adminAuth, adminController.updateMaxSavedAccounts);
router.patch('/users/:id/closing-mode', adminAuth, adminController.toggleClosingMode);
router.post('/users/:id/add-balance', adminAuth, adminController.addBalanceToAccount);
router.delete('/users/:id', adminAuth, adminController.deleteUser);

// ✅ Open positions for admin manual close
// ✅ Open positions for admin manual close
router.get('/open-positions', adminAuth, adminController.getAllOpenPositions);
router.get('/users/:userId/open-positions', adminAuth, adminController.getUserOpenPositions);
router.post('/users/close-all-positions', adminAuth, adminController.adminCloseAllUserPositions);
router.patch('/positions/:tradeId', adminAuth, adminController.adminUpdatePosition);
router.delete('/positions/:tradeId', adminAuth, adminController.adminDeletePosition);

// ================= WITHDRAWAL ROUTES =================
router.get('/withdrawals', adminAuth, adminController.listWithdrawals);
router.post('/withdrawals/:id/approve', adminAuth, adminController.approveWithdrawal);
router.post('/withdrawals/:id/reject', adminAuth, adminController.rejectWithdrawal);
router.get('/qr-deposits', adminAuth, adminController.listQrDeposits);
router.get('/qr/deposits', adminAuth, adminController.listQrDeposits);
router.post('/qr-deposits/:id/approve', adminAuth, adminController.approveQrDeposit);
router.post('/qr-deposits/:id/reject', adminAuth, adminController.rejectQrDeposit);
router.post('/qr/deposits/:id/approve', adminAuth, adminController.approveQrDeposit);
router.post('/qr/deposits/:id/reject', adminAuth, adminController.rejectQrDeposit);
router.get('/qr-settings', adminAuth, adminController.getQrSettings);
router.get('/qr/settings', adminAuth, adminController.getQrSettings);
router.post('/qr-settings', adminAuth, adminController.saveQrSettings);
router.post('/qr/settings', adminAuth, adminController.saveQrSettings);
router.put('/qr-settings', adminAuth, adminController.saveQrSettings);
router.put('/qr/settings', adminAuth, adminController.saveQrSettings);
router.patch('/qr-settings', adminAuth, adminController.saveQrSettings);
router.patch('/qr/settings', adminAuth, adminController.saveQrSettings);

// ================= MARKET / KITE ROUTES =================
router.get('/kite/login-url', adminAuth, adminController.getKiteLoginUrl);
router.post('/kite/create-session', adminAuth, adminController.createKiteSession);
router.post('/kite/sync-symbols', adminAuth, adminController.syncKiteSymbols);
router.post('/kite/start-stream', adminAuth, adminController.startKiteStream);
router.post('/kite/stop-stream', adminAuth, adminController.stopKiteStream);
router.get('/kite/status', adminAuth, adminController.kiteStatus);
// Add these with the other admin routes
router.post('/cleanup-data', adminAuth, adminController.cleanupOldData);
router.post('/kite/delete-token', adminAuth, adminController.deleteExpiredToken);

// ================= HOLIDAY / MANUAL CLOSE =================
router.get('/market-holiday', adminAuth, adminController.getMarketHoliday);
router.post('/market-holiday', adminAuth, adminController.setMarketHoliday);
router.post('/close-position', adminAuth, adminController.adminClosePosition);
router.post('/symbol-ban', adminAuth, adminController.toggleSymbolBan);

module.exports = router;
