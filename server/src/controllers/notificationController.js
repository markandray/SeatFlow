const asyncHandler = require('../utils/asyncHandler');
const notificationService = require('../services/notificationService');

const getMine = asyncHandler(async (req, res) => {
  res.status(200).json(await notificationService.getNotifications(req.user._id));
});

const markRead = asyncHandler(async (req, res) => {
  const notification = await notificationService.markNotificationRead(req.params.id, req.user._id);
  res.status(200).json({ notification });
});

module.exports = { getMine, markRead };
