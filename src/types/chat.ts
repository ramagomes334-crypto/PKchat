export type NavTab = 'chats' | 'status' | 'communities' | 'calls' | 'settings';

export interface UserProfile {
  uid: string;
  username: string;
  displayName: string;
  bio?: string;
  photoURL?: string;
  isOnline: boolean;
  lastSeen?: any;
  showOnlineStatus: boolean;
  showLastSeen: boolean;
  showProfilePhoto: boolean;
  e2eePublicKey?: string;
  createdAt?: any;
  updatedAt?: any;
}

export interface UserPrivateInfo {
  uid: string;
  email?: string;
  phone?: string;
  phoneSearchable: boolean;
  otpVerified: boolean;
  passwordHash?: string;
  twoFactorEnabled: boolean;
  updatedAt?: any;
}

export interface UserSettings {
  uid: string;
  theme: 'light' | 'dark' | 'system';
  fontSize: 'small' | 'medium' | 'large';
  readReceipts: boolean;
  lastSeenVisibility?: 'everyone' | 'contacts' | 'nobody';
  profilePhotoVisibility?: 'everyone' | 'contacts' | 'nobody';
  onlineVisibility?: 'everyone' | 'nobody';
  notifyMessages: boolean;
  notifyGroups: boolean;
  notifyCalls: boolean;
  notifyStatuses: boolean;
  notificationSound: boolean;
  disappearingDefaultSeconds?: number;
  updatedAt?: any;
}

export interface Contact {
  ownerUid: string;
  contactUid: string;
  aliasName: string;
  username: string;
  displayName: string;
  photoURL?: string;
  addedAt?: any;
}

export interface BlockedUser {
  ownerUid: string;
  blockedUid: string;
  reason?: string;
  blockedAt?: any;
}

export interface DeviceSession {
  uid: string;
  deviceId: string;
  deviceName: string;
  platform: string;
  verified: boolean;
  lastActiveAt?: any;
  createdAt?: any;
}

export interface NotificationItem {
  id: string;
  uid: string;
  type: 'message' | 'group' | 'mention' | 'call' | 'status' | 'security';
  title: string;
  body: string;
  refId?: string;
  isRead: boolean;
  createdAt?: any;
}

export interface Conversation {
  id: string;
  type: 'private' | 'group';
  memberUids: string[];
  adminUids: string[];
  title?: string;
  description?: string;
  photoURL?: string;
  createdBy: string;
  disappearingSeconds: number;
  onlyAdminsCanSend: boolean;
  onlyAdminsCanEditInfo: boolean;
  isPublicGroup?: boolean;
  lastMessageText?: string;
  lastMessageType?: string;
  lastMessageSenderUid?: string;
  lastMessageAt?: any;
  createdAt?: any;
  updatedAt?: any;
}

export interface ConversationMember {
  convId: string;
  uid: string;
  role: 'admin' | 'member';
  pinned: boolean;
  archived: boolean;
  mutedUntil: number;
  unreadCount: number;
  lastReadAt?: any;
  joinedAt?: any;
}

export type MessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'document'
  | 'audio'
  | 'voice'
  | 'sticker'
  | 'gif'
  | 'poll'
  | 'system';

export interface PollOption {
  id: string;
  text: string;
}

export interface Message {
  id: string;
  convId: string;
  senderUid: string;
  senderName: string;
  type: MessageType;
  text?: string;
  encryptedPayload?: string;
  iv?: string;
  mediaUrl?: string;
  mediaName?: string;
  mediaSize?: number;
  mediaMime?: string;
  replyToId?: string;
  replyToPreview?: string;
  replyToSender?: string;
  forwardedFrom?: string;
  editedAt?: any;
  deletedForAll: boolean;
  deletedForUids: string[];
  starredByUids: string[];
  reactions: Record<string, string>;
  pollQuestion?: string;
  pollOptions?: PollOption[];
  pollAllowMultiple?: boolean;
  pollVotes?: Record<string, string[]>;
  mentions?: string[];
  expiresAt?: number;
  deliveredToUids: string[];
  readByUids: string[];
  createdAt?: any;
}

export interface StatusPost {
  id: string;
  authorUid: string;
  authorName: string;
  authorUsername?: string;
  authorPhoto?: string;
  type: 'text' | 'image' | 'video';
  mediaUrl?: string;
  caption?: string;
  bgColor?: string;
  emoji?: string;
  privacy: 'all' | 'contacts' | 'except';
  allowedUids: string[];
  hiddenFromUids: string[];
  viewerCount: number;
  expiresAt: number;
  createdAt?: any;
}

export interface StatusView {
  statusId: string;
  authorUid: string;
  viewerUid: string;
  viewerName: string;
  viewerPhoto?: string;
  viewedAt?: any;
}

export interface CallRecord {
  id: string;
  callerUid: string;
  callerName: string;
  callerPhoto?: string;
  calleeUid: string;
  calleeName: string;
  calleePhoto?: string;
  participantUids: string[];
  type: 'audio' | 'video';
  status: 'ringing' | 'active' | 'ended' | 'missed' | 'rejected';
  durationSeconds: number;
  startedAt?: any;
  endedAt?: any;
}
