const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');
const { protect } = require('../middleware/auth');

router.get('/', protect, messageController.listUserMessages);
router.post('/', protect, messageController.createUserMessage);
router.patch('/read', protect, messageController.markUserMessagesRead);

module.exports = router;
