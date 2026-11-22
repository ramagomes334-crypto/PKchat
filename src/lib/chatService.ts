import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  arrayUnion,
  arrayRemove,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import { encryptMessageText } from './e2ee';
import type {
  CallRecord,
  Conversation,
  ConversationMember,
  Message,
  MessageType,
  NotificationItem,
  PollOption,
  StatusPost,
  UserProfile,
  UserSettings,
} from '../types/chat';

export function normalizePhoneKey(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.startsWith('0')) return '62' + digits.slice(1);
  return digits;
}

export function sanitizeUsername(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 30);
}

export function getDeviceId(): string {
  let id = localStorage.getItem('pk_chat_device_id');
  if (!id) {
    id = 'dev_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    localStorage.setItem('pk_chat_device_id', id);
  }
  return id;
}

export function getDeviceInfo(): { deviceId: string; deviceName: string; platform: string } {
  const ua = navigator.userAgent;
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isMobile = isAndroid || isIOS;
  let browser = 'Browser';
  if (/Chrome/i.test(ua) && !/Edg/i.test(ua)) browser = 'Chrome';
  else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';
  else if (/Firefox/i.test(ua)) browser = 'Firefox';
  else if (/Edg/i.test(ua)) browser = 'Edge';

  const platform = isAndroid ? 'Android' : isIOS ? 'iOS' : 'Web Desktop';
  const deviceName = `${platform} · ${browser}${isMobile ? ' Mobile' : ''}`;
  return { deviceId: getDeviceId(), deviceName, platform };
}

const CLOUDINARY_STORAGE_KEY = 'pk_chat_cloudinary_cfg';

export function getCloudinaryConfig(): { cloudName: string; uploadPreset: string; fromEnv: boolean } {
  const envCloud = ((import.meta as any).env?.VITE_CLOUDINARY_CLOUD_NAME || '').trim();
  const envPreset = ((import.meta as any).env?.VITE_CLOUDINARY_UPLOAD_PRESET || '').trim();
  if (envCloud && envPreset) {
    return { cloudName: envCloud, uploadPreset: envPreset, fromEnv: true };
  }
  try {
    const raw = localStorage.getItem(CLOUDINARY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.cloudName && parsed?.uploadPreset) {
        return {
          cloudName: String(parsed.cloudName).trim(),
          uploadPreset: String(parsed.uploadPreset).trim(),
          fromEnv: false,
        };
      }
    }
  } catch {
    // Ignore storage read errors
  }
  return { cloudName: '', uploadPreset: '', fromEnv: false };
}

export function saveCloudinaryConfig(cloudName: string, uploadPreset: string) {
  const c = cloudName.trim();
  const p = uploadPreset.trim();
  if (!c || !p) {
    localStorage.removeItem(CLOUDINARY_STORAGE_KEY);
    return;
  }
  localStorage.setItem(CLOUDINARY_STORAGE_KEY, JSON.stringify({ cloudName: c, uploadPreset: p }));
}

export async function hashPasswordClient(password: string): Promise<string> {
  const enc = new TextEncoder();
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(saltBytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const hashHex = Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2:${saltHex}:${hashHex}`;
}

export async function uploadMediaFile(
  file: File | Blob,
  customName?: string
): Promise<{ url: string; name: string; mimeType: string; size: number }> {
  const user = auth.currentUser;
  if (!user) throw new Error('Anda harus masuk untuk mengunggah media');

  const filename = customName || (file instanceof File ? file.name : 'media.webm');
  const mimeType = file.type || 'application/octet-stream';

  if (file.size > 18 * 1024 * 1024) {
    throw new Error('Ukuran file maksimal 18 MB');
  }

  // 1. Direct browser upload to free Cloudinary unsigned preset (works 100% on Netlify Free)
  const cloudCfg = getCloudinaryConfig();
  if (cloudCfg.cloudName && cloudCfg.uploadPreset) {
    const form = new FormData();
    form.append('file', file, filename);
    form.append('upload_preset', cloudCfg.uploadPreset);
    const cloudRes = await fetch(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudCfg.cloudName)}/auto/upload`,
      { method: 'POST', body: form }
    );
    const cloudData = await cloudRes.json();
    if (!cloudRes.ok || !cloudData.secure_url) {
      throw new Error(cloudData?.error?.message || 'Gagal mengunggah media ke Cloudinary');
    }
    return {
      url: cloudData.secure_url,
      name: filename,
      mimeType,
      size: file.size,
    };
  }

  // 2. Fallback to Express upload endpoint if running on Node/AI Studio or VITE_UPLOAD_API_URL
  const token = await user.getIdToken();
  const baseUrl = (((import.meta as any).env?.VITE_UPLOAD_API_URL as string) || '').replace(/\/$/, '');
  const dataBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Gagal membaca file'));
    reader.readAsDataURL(file);
  });

  const res = await fetch(`${baseUrl}/api/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ filename, mimeType, dataBase64 }),
  });

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(
      'Upload file di Netlify butuh Cloudinary gratis. Isi Cloud Name & Upload Preset di Pengaturan → Penyimpanan Media.'
    );
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Gagal mengunggah media');
  }
  return data;
}

export async function checkUsernameAvailable(username: string): Promise<boolean> {
  const clean = sanitizeUsername(username);
  if (clean.length < 3) return false;
  const path = `usernames/${clean}`;
  try {
    const snap = await getDoc(doc(db, 'usernames', clean));
    return !snap.exists();
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

export async function searchUsersByQuery(rawQuery: string, myUid: string): Promise<UserProfile[]> {
  const clean = rawQuery.trim().toLowerCase().replace(/^@/, '');
  if (!clean) return [];

  // Phone search if mostly digits
  const digitsOnly = clean.replace(/[^0-9]/g, '');
  if (digitsOnly.length >= 6 && /^[0-9+\-\s]+$/.test(rawQuery.trim())) {
    const key = normalizePhoneKey(rawQuery);
    try {
      const phoneSnap = await getDoc(doc(db, 'phoneDirectory', key));
      if (phoneSnap.exists()) {
        const uid = phoneSnap.data().uid;
        if (uid !== myUid) {
          const userSnap = await getDoc(doc(db, 'users', uid));
          if (userSnap.exists()) return [userSnap.data() as UserProfile];
        }
      }
    } catch {
      // Ignore if not found
    }
  }

  try {
    const q = query(collection(db, 'users'), where('uid', '>=', ''), where('uid', '<=', '\uf8ff'), limit(40));
    const snaps = await getDocs(q);
    const results: UserProfile[] = [];
    snaps.forEach((d) => {
      const u = d.data() as UserProfile;
      if (
        u.uid !== myUid &&
        (u.username.toLowerCase().includes(clean) ||
          u.displayName.toLowerCase().includes(clean))
      ) {
        results.push(u);
      }
    });
    return results;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'users');
  }
}

export async function listDiscoverableUsers(myUid: string): Promise<UserProfile[]> {
  try {
    const q = query(collection(db, 'users'), where('uid', '>=', ''), where('uid', '<=', '\uf8ff'), limit(30));
    const snaps = await getDocs(q);
    const results: UserProfile[] = [];
    snaps.forEach((d) => {
      const u = d.data() as UserProfile;
      if (u.uid !== myUid) results.push(u);
    });
    return results;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'users');
  }
}

export async function saveUserOnboarding(params: {
  uid: string;
  email: string;
  username: string;
  displayName: string;
  bio: string;
  phone: string;
  phoneSearchable: boolean;
  photoURL: string;
  e2eePublicKey?: string;
  passwordHash?: string;
  otpVerified: boolean;
}) {
  const cleanUsername = sanitizeUsername(params.username);
  if (cleanUsername.length < 3) {
    throw new Error('Username minimal 3 karakter huruf kecil, angka, atau garis bawah.');
  }

  // Claim username
  const usernameRef = doc(db, 'usernames', cleanUsername);
  const existingUsername = await getDoc(usernameRef);
  if (existingUsername.exists() && existingUsername.data().uid !== params.uid) {
    throw new Error('Username sudah digunakan oleh pengguna lain.');
  }

  try {
    await setDoc(usernameRef, {
      uid: params.uid,
      username: cleanUsername,
      displayName: params.displayName.trim(),
      photoURL: params.photoURL || '',
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `usernames/${cleanUsername}`);
  }

  try {
    await setDoc(doc(db, 'users', params.uid), {
      uid: params.uid,
      username: cleanUsername,
      displayName: params.displayName.trim(),
      bio: params.bio.trim(),
      photoURL: params.photoURL || '',
      isOnline: true,
      lastSeen: serverTimestamp(),
      showOnlineStatus: true,
      showLastSeen: true,
      showProfilePhoto: true,
      e2eePublicKey: params.e2eePublicKey || '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `users/${params.uid}`);
  }

  try {
    await setDoc(doc(db, 'users', params.uid, 'private', 'info'), {
      uid: params.uid,
      email: params.email || '',
      phone: params.phone.trim(),
      phoneSearchable: params.phoneSearchable,
      otpVerified: params.otpVerified,
      ...(params.passwordHash ? { passwordHash: params.passwordHash } : {}),
      twoFactorEnabled: false,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `users/${params.uid}/private/info`);
  }

  if (params.phoneSearchable && params.phone.trim().length >= 6) {
    const phoneKey = normalizePhoneKey(params.phone);
    try {
      await setDoc(doc(db, 'phoneDirectory', phoneKey), {
        uid: params.uid,
        phoneKey,
        username: cleanUsername,
        displayName: params.displayName.trim(),
        photoURL: params.photoURL || '',
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `phoneDirectory/${phoneKey}`);
    }
  }

  const defaultSettings: UserSettings = {
    uid: params.uid,
    theme: 'system',
    fontSize: 'medium',
    readReceipts: true,
    lastSeenVisibility: 'everyone',
    profilePhotoVisibility: 'everyone',
    onlineVisibility: 'everyone',
    notifyMessages: true,
    notifyGroups: true,
    notifyCalls: true,
    notifyStatuses: true,
    notificationSound: true,
    disappearingDefaultSeconds: 0,
  };

  try {
    await setDoc(doc(db, 'users', params.uid, 'settings', 'preferences'), {
      ...defaultSettings,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `users/${params.uid}/settings/preferences`);
  }

  const dev = getDeviceInfo();
  try {
    await setDoc(doc(db, 'users', params.uid, 'devices', dev.deviceId), {
      uid: params.uid,
      deviceId: dev.deviceId,
      deviceName: dev.deviceName,
      platform: dev.platform,
      verified: params.otpVerified,
      lastActiveAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `users/${params.uid}/devices/${dev.deviceId}`);
  }
}

export async function getOrCreatePrivateConversation(
  myProfile: UserProfile,
  peerProfile: UserProfile,
  defaultDisappearingSeconds = 0
): Promise<string> {
  const sorted = [myProfile.uid, peerProfile.uid].sort();
  const convId = `priv_${sorted[0]}_${sorted[1]}`;
  const convRef = doc(db, 'conversations', convId);

  try {
    const snap = await getDoc(convRef);
    if (!snap.exists()) {
      await setDoc(convRef, {
        id: convId,
        type: 'private',
        memberUids: sorted,
        adminUids: sorted,
        createdBy: myProfile.uid,
        disappearingSeconds: defaultDisappearingSeconds,
        onlyAdminsCanSend: false,
        onlyAdminsCanEditInfo: false,
        lastMessageText: '',
        lastMessageType: 'text',
        lastMessageSenderUid: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await setDoc(doc(db, 'conversations', convId, 'members', myProfile.uid), {
        convId,
        uid: myProfile.uid,
        role: 'admin',
        pinned: false,
        archived: false,
        mutedUntil: 0,
        unreadCount: 0,
        joinedAt: serverTimestamp(),
      });

      await setDoc(doc(db, 'conversations', convId, 'members', peerProfile.uid), {
        convId,
        uid: peerProfile.uid,
        role: 'admin',
        pinned: false,
        archived: false,
        mutedUntil: 0,
        unreadCount: 0,
        joinedAt: serverTimestamp(),
      });
    }
    return convId;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `conversations/${convId}`);
  }
}

export async function createGroupConversation(params: {
  myProfile: UserProfile;
  title: string;
  description: string;
  memberUids: string[];
  photoURL?: string;
  isPublicGroup?: boolean;
}): Promise<string> {
  const convId = `grp_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
  const uniqueMembers = Array.from(new Set([params.myProfile.uid, ...params.memberUids])).slice(0, 50);
  const convRef = doc(db, 'conversations', convId);

  try {
    await setDoc(convRef, {
      id: convId,
      type: 'group',
      memberUids: uniqueMembers,
      adminUids: [params.myProfile.uid],
      title: params.title.trim().slice(0, 100),
      description: params.description.trim().slice(0, 400),
      photoURL: params.photoURL || '',
      createdBy: params.myProfile.uid,
      disappearingSeconds: 0,
      onlyAdminsCanSend: false,
      onlyAdminsCanEditInfo: true,
      isPublicGroup: Boolean(params.isPublicGroup),
      lastMessageText: `${params.myProfile.displayName} membuat grup ini`,
      lastMessageType: 'system',
      lastMessageSenderUid: params.myProfile.uid,
      lastMessageAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    for (const memberUid of uniqueMembers) {
      await setDoc(doc(db, 'conversations', convId, 'members', memberUid), {
        convId,
        uid: memberUid,
        role: memberUid === params.myProfile.uid ? 'admin' : 'member',
        pinned: false,
        archived: false,
        mutedUntil: 0,
        unreadCount: memberUid === params.myProfile.uid ? 0 : 1,
        joinedAt: serverTimestamp(),
      });
    }

    const sysMsgId = `msg_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
    await setDoc(doc(db, 'conversations', convId, 'messages', sysMsgId), {
      id: sysMsgId,
      convId,
      senderUid: params.myProfile.uid,
      senderName: params.myProfile.displayName,
      type: 'system',
      text: `${params.myProfile.displayName} membuat grup "${params.title.trim()}"`,
      deletedForAll: false,
      deletedForUids: [],
      starredByUids: [],
      reactions: {},
      deliveredToUids: [params.myProfile.uid],
      readByUids: [params.myProfile.uid],
      createdAt: serverTimestamp(),
    });

    return convId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `conversations/${convId}`);
  }
}

export async function sendMessage(params: {
  conv: Conversation;
  sender: UserProfile;
  peerProfile?: UserProfile | null;
  type: MessageType;
  text?: string;
  mediaUrl?: string;
  mediaName?: string;
  mediaSize?: number;
  mediaMime?: string;
  replyTo?: Message | null;
  forwardedFrom?: string;
  pollQuestion?: string;
  pollOptions?: PollOption[];
  pollAllowMultiple?: boolean;
  mentions?: string[];
}) {
  const msgId = `msg_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const msgPath = `conversations/${params.conv.id}/messages/${msgId}`;

  let plainText = params.text || '';
  let encryptedPayload: string | undefined;
  let iv: string | undefined;

  if (
    params.conv.type === 'private' &&
    params.type === 'text' &&
    plainText &&
    params.peerProfile?.e2eePublicKey
  ) {
    const enc = await encryptMessageText(
      params.sender.uid,
      params.peerProfile.e2eePublicKey,
      plainText
    );
    if (enc.encryptedPayload && enc.iv) {
      encryptedPayload = enc.encryptedPayload;
      iv = enc.iv;
    }
  }

  const expiresAt =
    params.conv.disappearingSeconds > 0
      ? Date.now() + params.conv.disappearingSeconds * 1000
      : undefined;

  const payload: Record<string, any> = {
    id: msgId,
    convId: params.conv.id,
    senderUid: params.sender.uid,
    senderName: params.sender.displayName,
    type: params.type,
    text: encryptedPayload ? '[Terenkripsi End-to-End]' : plainText.slice(0, 4000),
    deletedForAll: false,
    deletedForUids: [],
    starredByUids: [],
    reactions: {},
    deliveredToUids: [params.sender.uid],
    readByUids: [params.sender.uid],
    createdAt: serverTimestamp(),
  };

  if (encryptedPayload && iv) {
    payload.encryptedPayload = encryptedPayload;
    payload.iv = iv;
  }
  if (params.mediaUrl) payload.mediaUrl = params.mediaUrl;
  if (params.mediaName) payload.mediaName = params.mediaName;
  if (typeof params.mediaSize === 'number') payload.mediaSize = params.mediaSize;
  if (params.mediaMime) payload.mediaMime = params.mediaMime;
  if (params.replyTo) {
    payload.replyToId = params.replyTo.id;
    payload.replyToSender = params.replyTo.senderName;
    payload.replyToPreview = (params.replyTo.text || `[${params.replyTo.type}]`).slice(0, 180);
  }
  if (params.forwardedFrom) payload.forwardedFrom = params.forwardedFrom;
  if (params.pollQuestion && params.pollOptions) {
    payload.pollQuestion = params.pollQuestion;
    payload.pollOptions = params.pollOptions;
    payload.pollAllowMultiple = Boolean(params.pollAllowMultiple);
    payload.pollVotes = {};
  }
  if (params.mentions && params.mentions.length > 0) {
    payload.mentions = params.mentions.slice(0, 20);
  }
  if (expiresAt) payload.expiresAt = expiresAt;

  try {
    await setDoc(doc(db, 'conversations', params.conv.id, 'messages', msgId), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, msgPath);
  }

  const previewMap: Record<MessageType, string> = {
    text: encryptedPayload ? 'Pesan terenkripsi' : plainText.slice(0, 100),
    image: 'Foto',
    video: 'Video',
    document: `Dokumen: ${params.mediaName || 'File'}`,
    audio: `Audio: ${params.mediaName || 'Audio'}`,
    voice: 'Pesan suara',
    sticker: 'Stiker',
    gif: 'GIF',
    poll: `Polling: ${params.pollQuestion || ''}`,
    system: plainText.slice(0, 100),
  };

  try {
    await updateDoc(doc(db, 'conversations', params.conv.id), {
      lastMessageText: (previewMap[params.type] || 'Pesan baru').slice(0, 280),
      lastMessageType: params.type,
      lastMessageSenderUid: params.sender.uid,
      lastMessageAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `conversations/${params.conv.id}`);
  }

  // Increment unreadCount for other members & create mention/message notifications
  for (const memberUid of params.conv.memberUids) {
    if (memberUid === params.sender.uid) continue;
    try {
      await updateDoc(doc(db, 'conversations', params.conv.id, 'members', memberUid), {
        unreadCount: increment(1),
      });
    } catch {
      // Member doc may not exist if user removed
    }

    const isMentioned = params.mentions?.includes(memberUid);
    if (isMentioned || params.conv.type === 'private') {
      const notifId = `ntf_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
      try {
        await setDoc(doc(db, 'users', memberUid, 'notifications', notifId), {
          uid: memberUid,
          type: isMentioned ? 'mention' : params.conv.type === 'group' ? 'group' : 'message',
          title: (isMentioned
            ? `${params.sender.displayName} menyebut Anda`
            : params.conv.type === 'group'
            ? `${params.conv.title || 'Grup'}`
            : params.sender.displayName
          ).slice(0, 120),
          body: (previewMap[params.type] || 'Pesan baru').slice(0, 280),
          refId: params.conv.id,
          isRead: false,
          createdAt: serverTimestamp(),
        });
      } catch {
        // Non-blocking notification
      }
    }
  }

  return msgId;
}

export async function toggleMessageReaction(
  convId: string,
  msg: Message,
  myUid: string,
  emoji: string
) {
  const nextReactions = { ...(msg.reactions || {}) };
  if (nextReactions[myUid] === emoji) {
    delete nextReactions[myUid];
  } else {
    nextReactions[myUid] = emoji;
  }
  try {
    await updateDoc(doc(db, 'conversations', convId, 'messages', msg.id), {
      reactions: nextReactions,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `conversations/${convId}/messages/${msg.id}`);
  }
}

export async function toggleStarMessage(convId: string, msg: Message, myUid: string) {
  const isStarred = msg.starredByUids?.includes(myUid);
  try {
    await updateDoc(doc(db, 'conversations', convId, 'messages', msg.id), {
      starredByUids: isStarred ? arrayRemove(myUid) : arrayUnion(myUid),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `conversations/${convId}/messages/${msg.id}`);
  }
}

export async function editMessageText(
  convId: string,
  msgId: string,
  newText: string,
  conv: Conversation,
  myUid: string,
  peerProfile?: UserProfile | null
) {
  let encryptedPayload: string | undefined;
  let iv: string | undefined;
  if (conv.type === 'private' && peerProfile?.e2eePublicKey) {
    const enc = await encryptMessageText(myUid, peerProfile.e2eePublicKey, newText);
    encryptedPayload = enc.encryptedPayload;
    iv = enc.iv;
  }
  try {
    await updateDoc(doc(db, 'conversations', convId, 'messages', msgId), {
      text: encryptedPayload ? '[Terenkripsi End-to-End]' : newText.slice(0, 4000),
      ...(encryptedPayload && iv ? { encryptedPayload, iv } : {}),
      editedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `conversations/${convId}/messages/${msgId}`);
  }
}

export async function deleteMessageForAll(convId: string, msgId: string) {
  try {
    await updateDoc(doc(db, 'conversations', convId, 'messages', msgId), {
      deletedForAll: true,
      text: 'Pesan ini telah dihapus',
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `conversations/${convId}/messages/${msgId}`);
  }
}

export async function deleteMessageForMe(convId: string, msgId: string, myUid: string) {
  try {
    await updateDoc(doc(db, 'conversations', convId, 'messages', msgId), {
      deletedForUids: arrayUnion(myUid),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `conversations/${convId}/messages/${msgId}`);
  }
}

export async function voteOnPoll(
  convId: string,
  msg: Message,
  optionId: string,
  myUid: string
) {
  const votes: Record<string, string[]> = { ...(msg.pollVotes || {}) };
  if (!msg.pollAllowMultiple) {
    for (const key of Object.keys(votes)) {
      votes[key] = (votes[key] || []).filter((u) => u !== myUid);
    }
  }
  const current = votes[optionId] || [];
  if (current.includes(myUid)) {
    votes[optionId] = current.filter((u) => u !== myUid);
  } else {
    votes[optionId] = [...current, myUid];
  }
  try {
    await updateDoc(doc(db, 'conversations', convId, 'messages', msg.id), {
      pollVotes: votes,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `conversations/${convId}/messages/${msg.id}`);
  }
}

export async function markConversationRead(
  convId: string,
  myUid: string,
  messages: Message[],
  sendReadReceipts: boolean
) {
  try {
    await updateDoc(doc(db, 'conversations', convId, 'members', myUid), {
      unreadCount: 0,
      lastReadAt: serverTimestamp(),
    });
  } catch {
    // Ignore if member doc missing
  }

  for (const m of messages) {
    const needsDelivered = !m.deliveredToUids?.includes(myUid);
    const needsRead = sendReadReceipts && !m.readByUids?.includes(myUid);
    if (m.senderUid !== myUid && (needsDelivered || needsRead)) {
      try {
        await updateDoc(doc(db, 'conversations', convId, 'messages', m.id), {
          ...(needsDelivered ? { deliveredToUids: arrayUnion(myUid) } : {}),
          ...(needsRead ? { readByUids: arrayUnion(myUid) } : {}),
        });
      } catch {
        // Ignore individual receipt failures
      }
    }
  }
}

export async function createStatusPost(params: {
  author: UserProfile;
  type: 'text' | 'image' | 'video';
  caption: string;
  mediaUrl?: string;
  bgColor?: string;
  emoji?: string;
  privacy: 'all' | 'contacts' | 'except';
  contactUids: string[];
  hiddenFromUids: string[];
}) {
  const statusId = `sts_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
  const hidden = params.privacy === 'except' ? params.hiddenFromUids.slice(0, 50) : [];
  let allowedUids: string[] = [];
  if (params.privacy === 'contacts') {
    allowedUids = Array.from(new Set([params.author.uid, ...params.contactUids])).slice(0, 50);
  } else if (params.privacy === 'except') {
    allowedUids = Array.from(
      new Set([params.author.uid, ...params.contactUids.filter((u) => !hidden.includes(u))])
    ).slice(0, 50);
  }

  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  try {
    await setDoc(doc(db, 'statuses', statusId), {
      id: statusId,
      authorUid: params.author.uid,
      authorName: params.author.displayName,
      authorUsername: params.author.username,
      authorPhoto: params.author.photoURL || '',
      type: params.type,
      mediaUrl: params.mediaUrl || '',
      caption: params.caption.slice(0, 500),
      bgColor: params.bgColor || '#059669',
      emoji: params.emoji || '',
      privacy: params.privacy,
      allowedUids,
      hiddenFromUids: hidden,
      viewerCount: 0,
      expiresAt,
      createdAt: serverTimestamp(),
    });
    return statusId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `statuses/${statusId}`);
  }
}

export async function recordStatusView(status: StatusPost, viewer: UserProfile) {
  if (status.authorUid === viewer.uid) return;
  const viewRef = doc(db, 'statuses', status.id, 'views', viewer.uid);
  try {
    const existing = await getDoc(viewRef);
    if (!existing.exists()) {
      await setDoc(viewRef, {
        statusId: status.id,
        authorUid: status.authorUid,
        viewerUid: viewer.uid,
        viewerName: viewer.displayName,
        viewerPhoto: viewer.photoURL || '',
        viewedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'statuses', status.id), {
        viewerCount: increment(1),
      });
    }
  } catch {
    // Non-blocking view receipt
  }
}

export async function createCallDoc(params: {
  caller: UserProfile;
  callee: UserProfile;
  type: 'audio' | 'video';
}): Promise<string> {
  const callId = `call_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
  try {
    await setDoc(doc(db, 'calls', callId), {
      id: callId,
      callerUid: params.caller.uid,
      callerName: params.caller.displayName,
      callerPhoto: params.caller.photoURL || '',
      calleeUid: params.callee.uid,
      calleeName: params.callee.displayName,
      calleePhoto: params.callee.photoURL || '',
      participantUids: [params.caller.uid, params.callee.uid],
      type: params.type,
      status: 'ringing',
      durationSeconds: 0,
      startedAt: serverTimestamp(),
    });
    return callId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `calls/${callId}`);
  }
}

export async function updateCallDoc(
  callId: string,
  status: CallRecord['status'],
  durationSeconds = 0
) {
  try {
    await updateDoc(doc(db, 'calls', callId), {
      status,
      durationSeconds,
      ...(status === 'ended' || status === 'missed' || status === 'rejected'
        ? { endedAt: serverTimestamp() }
        : {}),
    });
  } catch {
    // Call doc might already be in terminal state
  }
}

export async function sendCallSignal(params: {
  callId: string;
  senderUid: string;
  targetUid: string;
  type: 'offer' | 'answer' | 'ice-candidate';
  payload: unknown;
}) {
  const signalId = `sig_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  try {
    const serialized = JSON.stringify(params.payload);
    if (serialized.length > 15900) return;
    await setDoc(doc(db, 'calls', params.callId, 'signals', signalId), {
      id: signalId,
      callId: params.callId,
      senderUid: params.senderUid,
      targetUid: params.targetUid,
      type: params.type,
      payload: serialized,
      createdAt: serverTimestamp(),
    });
  } catch {
    // Non-blocking signaling packet
  }
}

export async function setTypingStatus(
  convId: string,
  uid: string,
  displayName: string,
  isTyping: boolean
) {
  try {
    await setDoc(doc(db, 'conversations', convId, 'typing', uid), {
      convId,
      uid,
      displayName: (displayName || 'Pengguna').slice(0, 80),
      isTyping,
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Non-blocking typing indicator
  }
}

export function playNotificationChime(type: 'message' | 'call' = 'message') {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (type === 'call') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.14);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
      osc.start();
      osc.stop(ctx.currentTime + 0.46);
    } else {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);
      osc.start();
      osc.stop(ctx.currentTime + 0.17);
    }
  } catch {
    // Ignore autoplay restriction before user interaction
  }
}

export async function updateMemberConversationPref(
  convId: string,
  uid: string,
  patch: Partial<Pick<ConversationMember, 'pinned' | 'archived' | 'mutedUntil' | 'unreadCount'>>
) {
  try {
    await updateDoc(doc(db, 'conversations', convId, 'members', uid), patch);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `conversations/${convId}/members/${uid}`);
  }
}

export async function markAllNotificationsRead(uid: string, items: NotificationItem[]) {
  const unread = items.filter((n) => !n.isRead);
  await Promise.all(
    unread.map((n) =>
      updateDoc(doc(db, 'users', uid, 'notifications', n.id), { isRead: true }).catch(() => {})
    )
  );
}

export async function clearAllNotifications(uid: string, items: NotificationItem[]) {
  await Promise.all(
    items.map((n) =>
      deleteDoc(doc(db, 'users', uid, 'notifications', n.id)).catch(() => {})
    )
  );
}

export function sendBrowserNotification(title: string, body: string, tag?: string) {
  try {
    if (
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'granted' &&
      document.hidden
    ) {
      new Notification(title, {
        body,
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        tag,
      });
    }
  } catch {
    // Ignore browser notification errors in restricted contexts
  }
}

export async function deleteAccountData(uid: string, username?: string) {
  if (username) {
    try {
      await deleteDoc(doc(db, 'usernames', username));
    } catch {
      // ignore
    }
  }
  try {
    await deleteDoc(doc(db, 'users', uid, 'private', 'info'));
  } catch {
    // ignore
  }
  try {
    await deleteDoc(doc(db, 'users', uid, 'settings', 'preferences'));
  } catch {
    // ignore
  }
  try {
    await deleteDoc(doc(db, 'users', uid));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `users/${uid}`);
  }
}
