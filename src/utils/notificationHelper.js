import Notification from "../models/Notification.js";
import UserFollow from "../models/UserFollow.js";
import socketService from "../socket.js";
import User from "../models/userModel.js";

/**
 * Create a single notification and dispatch it in real-time.
 */
export const createNotification = async ({
  userId,
  senderId,
  type,
  postId = null,
  postModel = "SwapTemplate",
  commentId = null,
}) => {
  try {
    // 1. Prevent self-notifications
    if (String(userId) === String(senderId)) {
      return null;
    }

    // For likes, comments, and follows: prevent duplicate unread notifications of the same type/post/sender
    if (["like", "follow"].includes(type)) {
      const matchCriteria = {
        userId,
        senderId,
        type,
        isRead: false,
      };
      if (type === "like") matchCriteria.postId = postId;

      const existingUnread = await Notification.findOne(matchCriteria);
      if (existingUnread) {
        return existingUnread;
      }
    }

    // 2. Create the notification
    const notif = await Notification.create({
      userId,
      senderId,
      type,
      postId,
      postModel,
      commentId,
    });

    // 3. Populate sender, post details, and comments for UI rendering
    const populated = await Notification.findById(notif._id)
      .populate("senderId", "name username profileImage avatar isVerified")
      .populate({
        path: "postId",
        select: "title videoUrl thumbnailUrl description",
      })
      .lean();

    // 4. Emit socket event
    socketService.emitToUser(userId, "notification:new", populated);

    return populated;
  } catch (error) {
    console.error("Error creating notification:", error);
    return null;
  }
};

/**
 * Notify all followers when a user uploads a new post.
 */
export const notifyNewPost = async ({ ownerId, postId, postModel = "SwapTemplate", title, videoUrl }) => {
  try {
    // 1. Find all active followers
    const activeMatch = { $or: [{ isActive: true }, { isActive: { $exists: false } }] };
    const followers = await UserFollow.find({
      followingId: ownerId,
      ...activeMatch,
    }).select("followerId").lean();

    if (!followers.length) return;

    // 2. Create notifications in bulk
    const notificationsData = followers.map((f) => ({
      userId: f.followerId,
      senderId: ownerId,
      type: "new_post",
      postId,
      postModel,
    }));

    const createdNotifications = await Notification.insertMany(notificationsData);

    // 3. Fetch sender information (the poster)
    const sender = await User.findById(ownerId).select("name username profileImage avatar isVerified").lean();

    // 4. Emit to all online followers
    createdNotifications.forEach((notif) => {
      const payload = {
        _id: notif._id,
        userId: notif.userId,
        senderId: sender,
        type: "new_post",
        postId: {
          _id: postId,
          title,
          videoUrl,
        },
        postModel,
        isRead: false,
        createdAt: notif.createdAt,
      };
      socketService.emitToUser(notif.userId, "notification:new", payload);
    });
  } catch (error) {
    console.error("Error creating new post notifications:", error);
  }
};

/**
 * Delete all notifications related to a post (when deleted or unpublished).
 */
export const deletePostNotifications = async (postId) => {
  try {
    // 1. Find all notifications to be deleted to know which users to emit socket events to
    const notifications = await Notification.find({ postId }).select("_id userId").lean();
    if (!notifications.length) return;

    // 2. Delete from database
    await Notification.deleteMany({ postId });

    // 3. Emit notification:removed to each affected user in real-time
    notifications.forEach((notif) => {
      socketService.emitToUser(notif.userId, "notification:removed", { notificationId: notif._id });
    });
  } catch (error) {
    console.error("Error deleting post notifications:", error);
  }
};
