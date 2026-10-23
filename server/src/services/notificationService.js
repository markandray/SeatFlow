const Notification = require('../models/Notification');
const ApiError = require('../utils/ApiError');

async function getNotifications(userId) {
  const notifications = await Notification.find({ userId }).sort({ createdAt: -1 }).limit(100);
  return {
    notifications,
    unreadCount: notifications.filter((notification) => !notification.readAt).length,
    serverTime: new Date().toISOString(),
  };
}

async function markNotificationRead(notificationId, userId) {
  const notification = await Notification.findOneAndUpdate(
    { _id: notificationId, userId },
    { $set: { readAt: new Date() } },
    { new: true }
  );
  if (!notification) throw new ApiError(404, 'NOT_FOUND', 'Notification not found');
  return notification;
}

module.exports = { getNotifications, markNotificationRead };
