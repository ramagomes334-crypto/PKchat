import React, { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  Archive,
  Bell,
  BellOff,
  Bookmark,
  Camera,
  CheckCheck,
  CircleDot,
  Lock,
  MessageCircle,
  MessageSquarePlus,
  MoreVertical,
  Phone,
  Pin,
  Search,
  Settings,
  Star,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType } from './lib/firebase';
import { decryptMessageText, ensureE2EEKeyPair } from './lib/e2ee';
import { wsClient } from './lib/wsClient';
import {
  addUserToContacts,
  clearAllNotifications,
  createCallDoc,
  findUserExactForAdd,
  getDeviceInfo,
  getOrCreatePrivateConversation,
  getOrCreateSavedMessagesConversation,
  markAllNotificationsRead,
  playNotificationChime,
  sendBrowserNotification,
  updateMemberConversationPref,
  uploadMediaFile,
  verifyPasswordClient,
} from './lib/chatService';
import type {
  BlockedUser,
  CallRecord,
  Contact,
  Conversation,
  ConversationMember,
  Message,
  NavTab,
  NotificationItem,
  StatusPost,
  UserProfile,
  UserSettings,
} from './types/chat';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider, useToast } from './components/ToastProvider';
import { Avatar, PKLogo } from './components/PKLogo';
import { OfflineIndicator } from './components/PWAInstallButton';
import { AuthView } from './components/AuthView';
import { ChatRoom } from './components/ChatRoom';
import { ChatInfoDrawer } from './components/ChatInfoDrawer';
import { StatusView } from './components/StatusView';
import { CommunitiesView } from './components/CommunitiesView';
import { CallsView } from './components/CallsView';
import { SettingsView } from './components/SettingsView';
import { ActiveCallSession, CallOverlay } from './components/CallOverlay';

const DEFAULT_SETTINGS: UserSettings = {
  uid: '',
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

function PKChatApp() {
  const { showToast } = useToast();

  // Auth & Profile state
  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [myProfile, setMyProfile] = useState<UserProfile | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  // Navigation & Layout
  const [activeTab, setActiveTab] = useState<NavTab>('chats');
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [showInfoDrawer, setShowInfoDrawer] = useState(false);
  const [chatFilter, setChatFilter] = useState<'all' | 'unread' | 'groups' | 'archived'>('all');
  const [chatSearch, setChatSearch] = useState('');
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [convMenuId, setConvMenuId] = useState<string | null>(null);
  const [pendingCameraMedia, setPendingCameraMedia] = useState<{ url: string; type: 'image' | 'video' } | null>(null);
  const [createGroupSignal, setCreateGroupSignal] = useState(0);

  // Global Starred Messages Modal
  const [showStarredModal, setShowStarredModal] = useState(false);
  const [loadingStarred, setLoadingStarred] = useState(false);
  const [globalStarred, setGlobalStarred] = useState<{ conv: Conversation; msg: Message; display: string }[]>([]);

  // New Chat Modal (Private Contact-First Discovery)
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [newChatQuery, setNewChatQuery] = useState('');
  const [addContactQuery, setAddContactQuery] = useState('');
  const [addContactResult, setAddContactResult] = useState<UserProfile | null>(null);
  const [addContactSearched, setAddContactSearched] = useState(false);
  const [addContactLoading, setAddContactLoading] = useState(false);

  // App Lock PIN
  const [appLockHash, setAppLockHash] = useState<string | null>(null);
  const [appLocked, setAppLocked] = useState(false);
  const [pinUnlockInput, setPinUnlockInput] = useState('');
  const [pinUnlockError, setPinUnlockError] = useState('');

  // Core Data Collections
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [memberStates, setMemberStates] = useState<Record<string, ConversationMember>>({});
  const [profilesCache, setProfilesCache] = useState<Record<string, UserProfile>>({});
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [statuses, setStatuses] = useState<StatusPost[]>([]);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [activeConvMessages, setActiveConvMessages] = useState<Message[]>([]);

  // Real-time presence, typing & call state
  const [typingMap, setTypingMap] = useState<Record<string, Record<string, string>>>({});
  const [activeCall, setActiveCall] = useState<ActiveCallSession | null>(null);
  const handledIncomingCallsRef = React.useRef<Set<string>>(new Set());

  const onlineUsers = useMemo(() => {
    const now = Date.now();
    const map: Record<string, boolean> = {};
    Object.values(profilesCache).forEach((p) => {
      const lastSeenMs = (p.lastSeen as any)?.toMillis?.() ?? 0;
      const fresh = lastSeenMs === 0 || now - lastSeenMs < 180000;
      if (p.isOnline && fresh) {
        map[p.uid] = true;
      }
    });
    return map;
  }, [profilesCache]);

  // Theme application
  const applyTheme = (mode: 'light' | 'dark' | 'system') => {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = mode === 'dark' || (mode === 'system' && prefersDark);
    document.documentElement.classList.toggle('dark', isDark);
  };

  useEffect(() => {
    applyTheme(settings.theme);
  }, [settings.theme]);

  useEffect(() => {
    const unreadMsgs = Object.values(memberStates)
      .filter((s) => !s.archived && s.unreadCount > 0)
      .reduce((sum, s) => sum + s.unreadCount, 0);
    document.title =
      unreadMsgs > 0
        ? `(${unreadMsgs}) PK Chat — Pesan Instan Modern`
        : 'PK Chat — Pesan Instan Modern & Terenkripsi';
  }, [memberStates]);

  // Listen to Firebase Auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (!user) {
        setMyProfile(null);
        setNeedsOnboarding(false);
        setAppLockHash(null);
        setAppLocked(false);
        setAuthReady(true);
        wsClient.disconnect();
        return;
      }

      try {
        const savedPin = localStorage.getItem(`pk_chat_pin_${user.uid}`);
        if (savedPin) {
          setAppLockHash(savedPin);
          setAppLocked(true);
        } else {
          setAppLockHash(null);
          setAppLocked(false);
        }
      } catch {
        setAppLockHash(null);
        setAppLocked(false);
      }

      const snap = await getDoc(doc(db, 'users', user.uid));
      if (!snap.exists()) {
        setMyProfile(null);
        setNeedsOnboarding(true);
        setAuthReady(true);
      } else {
        setNeedsOnboarding(false);
        setAuthReady(true);
        const pub = await ensureE2EEKeyPair(user.uid);
        if (pub && snap.data().e2eePublicKey !== pub) {
          updateDoc(doc(db, 'users', user.uid), {
            e2eePublicKey: pub,
            isOnline: true,
            lastSeen: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }).catch(() => {});
        } else {
          updateDoc(doc(db, 'users', user.uid), {
            isOnline: true,
            lastSeen: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }).catch(() => {});
        }
        // Update device activity
        const dev = getDeviceInfo();
        updateDoc(doc(db, 'users', user.uid, 'devices', dev.deviceId), {
          lastActiveAt: serverTimestamp(),
        }).catch(() => {});
      }
    });
    return () => unsub();
  }, []);

  // Presence heartbeat & optional external WebSocket sync
  useEffect(() => {
    if (!firebaseUser || needsOnboarding) return;
    let active = true;
    firebaseUser.getIdToken().then((token) => {
      if (active) wsClient.connect(token);
    });

    const markPresence = (online: boolean) => {
      if (!auth.currentUser) return;
      updateDoc(doc(db, 'users', auth.currentUser.uid), {
        isOnline: online,
        lastSeen: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }).catch(() => {});
    };

    markPresence(true);
    const heartbeat = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        markPresence(true);
      }
    }, 45000);

    const handleVisibility = () => {
      markPresence(document.visibilityState === 'visible');
    };
    const handleBeforeUnload = () => {
      markPresence(false);
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handleBeforeUnload);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      active = false;
      clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handleBeforeUnload);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [firebaseUser?.uid, needsOnboarding]);

  // Real-time Firestore Listeners
  useEffect(() => {
    if (!firebaseUser || needsOnboarding) return;
    const uid = firebaseUser.uid;

    const unsubProfile = onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as UserProfile;
          setMyProfile(data);
          setProfilesCache((prev) => ({ ...prev, [uid]: data }));
        }
      },
      (err) => handleFirestoreError(err, OperationType.GET, `users/${uid}`)
    );

    const unsubSettings = onSnapshot(
      doc(db, 'users', uid, 'settings', 'preferences'),
      (snap) => {
        if (snap.exists()) {
          setSettings(snap.data() as UserSettings);
        }
      },
      (err) => handleFirestoreError(err, OperationType.GET, `users/${uid}/settings/preferences`)
    );

    const unsubContacts = onSnapshot(
      query(collection(db, 'users', uid, 'contacts'), where('ownerUid', '==', uid)),
      (snap) => {
        setContacts(snap.docs.map((d) => d.data() as Contact));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `users/${uid}/contacts`)
    );

    const unsubBlocked = onSnapshot(
      query(collection(db, 'users', uid, 'blocked'), where('ownerUid', '==', uid)),
      (snap) => {
        setBlockedUsers(snap.docs.map((d) => d.data() as BlockedUser));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `users/${uid}/blocked`)
    );

    const unsubNotifs = onSnapshot(
      query(collection(db, 'users', uid, 'notifications'), where('uid', '==', uid)),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as NotificationItem))
          .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
        setNotifications(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `users/${uid}/notifications`)
    );

    const unsubConvs = onSnapshot(
      query(collection(db, 'conversations'), where('memberUids', 'array-contains', uid)),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as Conversation);
        setConversations(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'conversations')
    );

    const unsubCalls = onSnapshot(
      query(collection(db, 'calls'), where('participantUids', 'array-contains', uid)),
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as CallRecord)
          .sort((a, b) => (b.startedAt?.toMillis?.() ?? 0) - (a.startedAt?.toMillis?.() ?? 0));
        setCalls(list);

        const now = Date.now();
        const incoming = list.find((c) => {
          if (c.status !== 'ringing' || c.calleeUid !== uid) return false;
          if (handledIncomingCallsRef.current.has(c.id)) return false;
          const startedMs = (c.startedAt as any)?.toMillis?.() ?? now;
          return now - startedMs < 60000;
        });

        if (incoming) {
          handledIncomingCallsRef.current.add(incoming.id);
          if (settings.notifyCalls) {
            sendBrowserNotification(
              'Panggilan Masuk · PK Chat',
              `${incoming.callerName || 'Seseorang'} mengundang Anda ke panggilan ${incoming.type === 'video' ? 'video' : 'suara'}`,
              incoming.id
            );
          }
          setActiveCall((curr) =>
            curr
              ? curr
              : {
                  callId: incoming.id,
                  direction: 'incoming',
                  callType: incoming.type,
                  peerUid: incoming.callerUid,
                  peerName: incoming.callerName || 'Panggilan Masuk',
                  peerPhoto: incoming.callerPhoto,
                  status: 'ringing',
                }
          );
        }
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'calls')
    );

    // Statuses: public + contacts + mine
    let statusAll: StatusPost[] = [];
    let statusAllowed: StatusPost[] = [];
    let statusMine: StatusPost[] = [];
    const mergeStatuses = () => {
      const map = new Map<string, StatusPost>();
      [...statusAll, ...statusAllowed, ...statusMine].forEach((s) => map.set(s.id, s));
      const merged = Array.from(map.values()).sort((a, b) => b.expiresAt - a.expiresAt);
      setStatuses(merged);
    };

    const unsubStatusAll = onSnapshot(
      query(collection(db, 'statuses'), where('privacy', '==', 'all')),
      (snap) => {
        statusAll = snap.docs.map((d) => d.data() as StatusPost);
        mergeStatuses();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'statuses')
    );
    const unsubStatusAllowed = onSnapshot(
      query(collection(db, 'statuses'), where('allowedUids', 'array-contains', uid)),
      (snap) => {
        statusAllowed = snap.docs.map((d) => d.data() as StatusPost);
        mergeStatuses();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'statuses')
    );
    const unsubStatusMine = onSnapshot(
      query(collection(db, 'statuses'), where('authorUid', '==', uid)),
      (snap) => {
        statusMine = snap.docs.map((d) => d.data() as StatusPost);
        mergeStatuses();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'statuses')
    );

    return () => {
      unsubProfile();
      unsubSettings();
      unsubContacts();
      unsubBlocked();
      unsubNotifs();
      unsubConvs();
      unsubCalls();
      unsubStatusAll();
      unsubStatusAllowed();
      unsubStatusMine();
    };
  }, [firebaseUser?.uid, needsOnboarding]);

  // Listen to per-conversation member state & fetch peer profiles
  useEffect(() => {
    if (!firebaseUser || conversations.length === 0) return;
    const uid = firebaseUser.uid;
    const unsubs: (() => void)[] = [];
    const missingUids = new Set<string>();

    for (const c of conversations) {
      unsubs.push(
        onSnapshot(
          doc(db, 'conversations', c.id, 'members', uid),
          (snap) => {
            if (snap.exists()) {
              setMemberStates((prev) => ({
                ...prev,
                [c.id]: snap.data() as ConversationMember,
              }));
            }
          },
          (err) => handleFirestoreError(err, OperationType.GET, `conversations/${c.id}/members/${uid}`)
        )
      );
      for (const mUid of c.memberUids) {
        if (!profilesCache[mUid]) missingUids.add(mUid);
      }
    }

    missingUids.forEach((mUid) => {
      getDoc(doc(db, 'users', mUid)).then((snap) => {
        if (snap.exists()) {
          setProfilesCache((prev) => ({ ...prev, [mUid]: snap.data() as UserProfile }));
        }
      }).catch(() => {});
    });

    return () => unsubs.forEach((u) => u());
  }, [conversations, firebaseUser?.uid]);

  // Listen to active conversation messages, typing indicators & peer online profile
  useEffect(() => {
    const activeConvObj = conversations.find((c) => c.id === activeConvId);
    if (!activeConvId || !activeConvObj || !firebaseUser) {
      setActiveConvMessages([]);
      return;
    }

    const unsubMsgs = onSnapshot(
      query(collection(db, 'conversations', activeConvId, 'messages'), where('convId', '==', activeConvId)),
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as Message)
          .sort((a, b) => (b.createdAt?.toMillis?.() ?? Date.now()) - (a.createdAt?.toMillis?.() ?? Date.now()));
        setActiveConvMessages(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `conversations/${activeConvId}/messages`)
    );

    const unsubTyping = onSnapshot(
      query(collection(db, 'conversations', activeConvId, 'typing'), where('convId', '==', activeConvId)),
      (snap) => {
        const now = Date.now();
        const convTyping: Record<string, string> = {};
        snap.docs.forEach((d) => {
          const t = d.data() as {
            uid: string;
            displayName: string;
            isTyping: boolean;
            updatedAt?: { toMillis?: () => number };
          };
          const updatedMs = t.updatedAt?.toMillis?.() ?? now;
          if (t.isTyping && t.uid !== firebaseUser.uid && now - updatedMs < 10000) {
            convTyping[t.uid] = t.displayName || 'Seseorang';
          }
        });
        setTypingMap((prev) => ({ ...prev, [activeConvId]: convTyping }));
      },
      () => {}
    );

    let unsubPeer: (() => void) | undefined;
    if (activeConvObj.type === 'private') {
      const peerUid = activeConvObj.memberUids.find((u) => u !== firebaseUser.uid);
      if (peerUid) {
        unsubPeer = onSnapshot(
          doc(db, 'users', peerUid),
          (snap) => {
            if (snap.exists()) {
              setProfilesCache((prev) => ({ ...prev, [peerUid]: snap.data() as UserProfile }));
            }
          },
          () => {}
        );
      }
    }

    return () => {
      unsubMsgs();
      unsubTyping();
      if (unsubPeer) unsubPeer();
    };
  }, [activeConvId, conversations, firebaseUser?.uid]);

  // Deep linking support (`/?chat=...` or `/?u=...`)
  useEffect(() => {
    if (!myProfile) return;
    const params = new URLSearchParams(window.location.search);
    const chatParam = params.get('chat');
    const userParam = params.get('u');
    if (chatParam) {
      setActiveConvId(chatParam);
      setActiveTab('chats');
    } else if (userParam && userParam !== myProfile.username) {
      getDoc(doc(db, 'usernames', userParam)).then(async (snap) => {
        if (snap.exists()) {
          const peerSnap = await getDoc(doc(db, 'users', snap.data().uid));
          if (peerSnap.exists()) {
            const convId = await getOrCreatePrivateConversation(
              myProfile,
              peerSnap.data() as UserProfile,
              settings.disappearingDefaultSeconds || 0
            );
            setActiveConvId(convId);
            setActiveTab('chats');
          }
        }
      });
    }
  }, [myProfile?.uid]);

  // Sound & Browser notification on incoming unread notification
  useEffect(() => {
    if (notifications.length > 0 && !notifications[0].isRead) {
      const latest = notifications[0];
      const shouldNotify =
        (latest.type === 'message' && settings.notifyMessages) ||
        ((latest.type === 'group' || latest.type === 'mention') && settings.notifyGroups);
      if (shouldNotify) {
        if (settings.notificationSound) {
          playNotificationChime('message');
        }
        sendBrowserNotification(latest.title, latest.body, latest.id);
      }
    }
  }, [notifications[0]?.id]);

  const contactsByUid = useMemo(() => {
    const map: Record<string, Contact> = {};
    contacts.forEach((c) => {
      map[c.contactUid] = c;
    });
    return map;
  }, [contacts]);

  const activeConv = useMemo(
    () => conversations.find((c) => c.id === activeConvId) || null,
    [conversations, activeConvId]
  );

  const activePeerProfile = useMemo(() => {
    if (!activeConv || activeConv.type !== 'private' || !myProfile) return null;
    const peerUid = activeConv.memberUids.find((u) => u !== myProfile.uid);
    if (!peerUid) return null;
    const peer = profilesCache[peerUid];
    if (!peer) return null;
    const contact = contactsByUid[peerUid];
    return contact?.aliasName ? { ...peer, displayName: contact.aliasName } : peer;
  }, [activeConv, myProfile?.uid, profilesCache, contactsByUid]);

  const sortedConversations = useMemo(() => {
    const filtered = conversations.filter((c) => {
      const state = memberStates[c.id];
      if (chatFilter === 'archived') return Boolean(state?.archived);
      if (state?.archived) return false;
      if (chatFilter === 'unread') return (state?.unreadCount || 0) > 0;
      if (chatFilter === 'groups') return c.type === 'group';
      return true;
    });

    const searched = chatSearch.trim()
      ? filtered.filter((c) => {
          const isSelf = c.id.startsWith('self_') || (c.type === 'private' && c.memberUids.length === 1);
          const otherUid = c.memberUids.find((u) => u !== myProfile?.uid);
          const title = isSelf
            ? 'Catatan Tersimpan'
            : c.type === 'group'
            ? c.title || ''
            : (otherUid && (contactsByUid[otherUid]?.aliasName || profilesCache[otherUid]?.displayName)) || '';
          return (
            title.toLowerCase().includes(chatSearch.toLowerCase()) ||
            (c.lastMessageText || '').toLowerCase().includes(chatSearch.toLowerCase())
          );
        })
      : filtered;

    return searched.sort((a, b) => {
      const pinA = memberStates[a.id]?.pinned ? 1 : 0;
      const pinB = memberStates[b.id]?.pinned ? 1 : 0;
      if (pinA !== pinB) return pinB - pinA;
      const timeA = a.lastMessageAt?.toMillis?.() || a.updatedAt?.toMillis?.() || 0;
      const timeB = b.lastMessageAt?.toMillis?.() || b.updatedAt?.toMillis?.() || 0;
      return timeB - timeA;
    });
  }, [conversations, memberStates, chatFilter, chatSearch, profilesCache, contactsByUid, myProfile?.uid]);

  const handleStartCall = async (
    peerUid: string,
    peerName: string,
    peerPhoto: string | undefined,
    type: 'audio' | 'video'
  ) => {
    if (!myProfile) return;
    try {
      const callId = await createCallDoc({
        caller: myProfile,
        callee: {
          uid: peerUid,
          username: 'pengguna',
          displayName: peerName,
          photoURL: peerPhoto,
          isOnline: false,
          showOnlineStatus: true,
          showLastSeen: true,
          showProfilePhoto: true,
        },
        type,
      });
      setActiveCall({
        callId,
        direction: 'outgoing',
        callType: type,
        peerUid,
        peerName,
        peerPhoto,
        status: 'ringing',
      });
    } catch {
      showToast('Gagal memulai panggilan', 'error');
    }
  };

  const handleExactLookupForAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!myProfile || !addContactQuery.trim()) return;
    setAddContactLoading(true);
    setAddContactSearched(false);
    try {
      const found = await findUserExactForAdd(addContactQuery, myProfile.uid);
      setAddContactResult(found);
      setAddContactSearched(true);
    } catch {
      showToast('Gagal mencari pengguna', 'error');
    } finally {
      setAddContactLoading(false);
    }
  };

  const handleOpenChatWithUser = async (peer: UserProfile) => {
    if (!myProfile) return;
    try {
      const convId = await getOrCreatePrivateConversation(
        myProfile,
        peer,
        settings.disappearingDefaultSeconds || 0
      );
      setProfilesCache((prev) => ({ ...prev, [peer.uid]: peer }));
      setShowNewChatModal(false);
      setNewChatQuery('');
      setAddContactQuery('');
      setAddContactResult(null);
      setAddContactSearched(false);
      setActiveConvId(convId);
      setActiveTab('chats');
    } catch {
      showToast('Gagal membuka percakapan dengan pengguna ini', 'error');
    }
  };

  const handleAddAndOpenChat = async (peer: UserProfile) => {
    if (!myProfile) return;
    try {
      await addUserToContacts(myProfile.uid, peer);
      showToast(`${peer.displayName} ditambahkan ke kontak`, 'success');
      await handleOpenChatWithUser(peer);
    } catch {
      showToast('Gagal menambahkan kontak', 'error');
    }
  };

  const handleOpenSavedMessages = async () => {
    if (!myProfile) return;
    try {
      const convId = await getOrCreateSavedMessagesConversation(myProfile);
      setShowNewChatModal(false);
      setActiveConvId(convId);
      setActiveTab('chats');
    } catch {
      showToast('Gagal membuka Catatan Tersimpan', 'error');
    }
  };

  const handleSaveAppLock = (pinHash: string | null) => {
    if (!firebaseUser) return;
    try {
      if (pinHash) {
        localStorage.setItem(`pk_chat_pin_${firebaseUser.uid}`, pinHash);
        setAppLockHash(pinHash);
      } else {
        localStorage.removeItem(`pk_chat_pin_${firebaseUser.uid}`);
        setAppLockHash(null);
        setAppLocked(false);
      }
    } catch {
      showToast('Gagal menyimpan pengaturan kunci PIN di perangkat', 'error');
    }
  };

  const handleUnlockApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appLockHash || !pinUnlockInput.trim()) return;
    const valid = await verifyPasswordClient(pinUnlockInput.trim(), appLockHash);
    if (valid) {
      setAppLocked(false);
      setPinUnlockInput('');
      setPinUnlockError('');
    } else {
      setPinUnlockError('PIN salah. Periksa kembali PIN Anda.');
    }
  };

  const handleQuickCameraStatus = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !myProfile) return;
    try {
      showToast('Mengunggah media kamera...', 'info');
      const up = await uploadMediaFile(file);
      setPendingCameraMedia({
        url: up.url,
        type: file.type.startsWith('video/') ? 'video' : 'image',
      });
      setActiveTab('status');
    } catch {
      showToast('Gagal membuka media kamera', 'error');
    }
  };

  const handleOpenGlobalStarred = async () => {
    if (!myProfile) return;
    setShowStarredModal(true);
    setLoadingStarred(true);
    try {
      const items: { conv: Conversation; msg: Message; display: string }[] = [];
      for (const c of conversations) {
        const snap = await getDocs(
          query(
            collection(db, 'conversations', c.id, 'messages'),
            where('convId', '==', c.id)
          )
        );
        for (const d of snap.docs) {
          const m = d.data() as Message;
          if (!m.starredByUids?.includes(myProfile.uid)) continue;
          let display = m.text || `[${m.type}]`;
          if (c.type === 'private' && m.encryptedPayload && m.iv) {
            const peerUid = c.memberUids.find((u) => u !== myProfile.uid);
            const peerPub = peerUid ? profilesCache[peerUid]?.e2eePublicKey : undefined;
            if (peerPub) {
              const plain = await decryptMessageText(myProfile.uid, peerPub, m.encryptedPayload, m.iv);
              if (plain) display = plain;
            }
          }
          items.push({ conv: c, msg: m, display });
        }
      }
      setGlobalStarred(items);
    } catch {
      showToast('Gagal memuat pesan berbintang', 'error');
    } finally {
      setLoadingStarred(false);
    }
  };

  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-[#0B1014]">
        <div className="flex flex-col items-center gap-3">
          <PKLogo size={46} />
          <p className="text-xs text-slate-500 dark:text-slate-400">Memuat PK Chat...</p>
        </div>
      </div>
    );
  }

  if (!firebaseUser || needsOnboarding) {
    return (
      <AuthView
        firebaseUser={firebaseUser}
        needsOnboarding={needsOnboarding}
        onOnboardingComplete={() => setNeedsOnboarding(false)}
      />
    );
  }

  if (!myProfile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-[#0B1014]">
        <div className="flex flex-col items-center gap-3">
          <PKLogo size={46} />
          <p className="text-xs text-slate-500 dark:text-slate-400">Menyiapkan ruang obrolan PK Chat...</p>
        </div>
      </div>
    );
  }

  const totalUnreadChats = Object.values(memberStates).filter(
    (s) => !s.archived && s.unreadCount > 0
  ).length;
  const unreadNotifs = notifications.filter((n) => !n.isRead).length;
  const blockedSet = new Set(blockedUsers.map((b) => b.blockedUid));

  const formatListTime = (ts: any) => {
    if (!ts) return '';
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit' });
  };

  const navItems: { id: NavTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    {
      id: 'chats',
      label: 'Chat',
      icon: <MessageCircle className="w-5 h-5" />,
      badge: totalUnreadChats,
    },
    { id: 'status', label: 'Status', icon: <CircleDot className="w-5 h-5" /> },
    { id: 'communities', label: 'Komunitas', icon: <Users className="w-5 h-5" /> },
    { id: 'calls', label: 'Panggilan', icon: <Phone className="w-5 h-5" /> },
    { id: 'settings', label: 'Pengaturan', icon: <Settings className="w-5 h-5" /> },
  ];

  const isMobileChatOpen = Boolean(activeConvId && activeTab === 'chats');

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col lg:flex-row bg-white dark:bg-[#0B1014] text-slate-900 dark:text-slate-100">
      <OfflineIndicator />

      {/* Desktop Navigation Rail */}
      <nav className="hidden lg:flex w-[72px] shrink-0 flex-col items-center justify-between py-4 border-r border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0E151B]">
        <div className="flex flex-col items-center gap-4">
          <button onClick={() => setActiveTab('chats')} title="PK Chat">
            <PKLogo size={36} showWordmark={false} />
          </button>

          <div className="mt-4 flex flex-col items-center gap-2">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  if (item.id !== 'chats') setShowInfoDrawer(false);
                }}
                title={item.label}
                className={`relative w-12 h-12 rounded-2xl flex items-center justify-center transition-colors ${
                  activeTab === item.id
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800'
                }`}
              >
                {item.icon}
                {item.badge ? (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center font-mono-num">
                    {item.badge}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col items-center gap-3">
          {appLockHash && (
            <button
              onClick={() => setAppLocked(true)}
              className="w-11 h-11 rounded-2xl flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800"
              title="Kunci Layar Aplikasi"
            >
              <Lock className="w-5 h-5" />
            </button>
          )}
          <button
            onClick={handleOpenSavedMessages}
            className="w-11 h-11 rounded-2xl flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800"
            title="Catatan Tersimpan"
          >
            <Bookmark className="w-5 h-5" />
          </button>
          <button
            onClick={handleOpenGlobalStarred}
            className="w-11 h-11 rounded-2xl flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800"
            title="Pesan Berbintang"
          >
            <Star className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowNotificationsModal(true)}
            className="relative w-11 h-11 rounded-2xl flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800"
            title="Notifikasi"
          >
            <Bell className="w-5 h-5" />
            {unreadNotifs > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-emerald-500" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            title={myProfile.displayName}
          >
            <Avatar name={myProfile.displayName} src={myProfile.photoURL} size="sm" />
          </button>
        </div>
      </nav>

      {/* Mobile Top Header (Hidden when inside a chat room) */}
      {!isMobileChatOpen && (
        <header className="lg:hidden h-14 px-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111820] flex items-center justify-between gap-3 shrink-0 pt-safe">
          <PKLogo size={30} />
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setActiveTab('chats');
                setShowMobileSearch(!showMobileSearch);
              }}
              className="min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center text-slate-600 dark:text-slate-300"
              aria-label="Pencarian"
            >
              <Search className="w-5 h-5" />
            </button>
            <label
              className="min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center text-slate-600 dark:text-slate-300 cursor-pointer"
              aria-label="Kamera"
            >
              <Camera className="w-5 h-5" />
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleQuickCameraStatus}
                className="hidden"
              />
            </label>
            <button
              onClick={() => setShowNewChatModal(true)}
              className="min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center text-emerald-600"
              aria-label="Pesan baru"
            >
              <MessageSquarePlus className="w-5 h-5" />
            </button>
            <div className="relative">
              <button
                onClick={() => setShowHeaderMenu(!showHeaderMenu)}
                className="min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center text-slate-600 dark:text-slate-300"
                aria-label="Menu tambahan"
              >
                <MoreVertical className="w-5 h-5" />
              </button>
              {showHeaderMenu && (
                <div className="absolute right-0 top-12 z-50 w-48 rounded-2xl bg-white dark:bg-[#1A242D] border border-slate-200 dark:border-slate-700 shadow-xl p-1.5 text-xs">
                  <button
                    onClick={() => {
                      handleOpenSavedMessages();
                      setShowHeaderMenu(false);
                    }}
                    className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    Catatan Tersimpan
                  </button>
                  <button
                    onClick={() => {
                      setShowNotificationsModal(true);
                      setShowHeaderMenu(false);
                    }}
                    className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    Notifikasi ({unreadNotifs})
                  </button>
                  <button
                    onClick={() => {
                      handleOpenGlobalStarred();
                      setShowHeaderMenu(false);
                    }}
                    className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    Pesan Berbintang
                  </button>
                  <button
                    onClick={() => {
                      setActiveTab('chats');
                      setChatFilter(chatFilter === 'archived' ? 'all' : 'archived');
                      setShowHeaderMenu(false);
                    }}
                    className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    {chatFilter === 'archived' ? 'Semua Chat' : 'Arsip Chat'}
                  </button>
                  <button
                    onClick={() => {
                      setActiveTab('settings');
                      setShowHeaderMenu(false);
                    }}
                    className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    Pengaturan Akun
                  </button>
                  {appLockHash && (
                    <button
                      onClick={() => {
                        setAppLocked(true);
                        setShowHeaderMenu(false);
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      Kunci Layar
                    </button>
                  )}
                  <button
                    onClick={() => signOut(auth)}
                    className="w-full text-left px-3 py-2 rounded-xl text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                  >
                    Keluar
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Chat List Sidebar (Visible on Desktop always when on chats, or on Mobile when no active chat room is open) */}
        {(activeTab === 'chats') && (
          <aside
            className={`${
              isMobileChatOpen ? 'hidden lg:flex' : 'flex'
            } w-full lg:w-[360px] shrink-0 flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111820] h-full`}
          >
            {/* Desktop Sidebar Header */}
            <div className="hidden lg:flex h-14 px-4 border-b border-slate-200 dark:border-slate-800 items-center justify-between shrink-0">
              <h1 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                Percakapan
              </h1>
              <div className="flex items-center gap-1">
                <label
                  className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
                  title="Kamera"
                >
                  <Camera className="w-4 h-4" />
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleQuickCameraStatus}
                    className="hidden"
                  />
                </label>
                <button
                  onClick={() => setShowNewChatModal(true)}
                  className="p-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
                  title="Pesan Baru"
                >
                  <MessageSquarePlus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Search & Filter Tabs */}
            <div className={`p-3 space-y-2.5 border-b border-slate-100 dark:border-slate-800 ${showMobileSearch ? 'block' : 'hidden lg:block'}`}>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={chatSearch}
                  onChange={(e) => setChatSearch(e.target.value)}
                  placeholder="Cari percakapan atau pesan..."
                  className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            <div className="px-3 py-2 flex items-center gap-1 overflow-x-auto bg-slate-50 dark:bg-[#0E151B] border-b border-slate-100 dark:border-slate-800">
              {[
                { id: 'all', label: 'Semua' },
                { id: 'unread', label: 'Belum Dibaca' },
                { id: 'groups', label: 'Grup' },
                { id: 'archived', label: 'Diarsipkan' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setChatFilter(tab.id as any)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                    chatFilter === tab.id
                      ? 'bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 shadow-2xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Conversation List */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/70 pb-20 lg:pb-0">
              {sortedConversations.length === 0 ? (
                <div className="p-8 text-center">
                  <div className="mx-auto w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center mb-3">
                    <MessageCircle className="w-6 h-6" />
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    {chatFilter === 'archived'
                      ? 'Arsip Kosong'
                      : chatFilter === 'unread'
                      ? 'Semua Pesan Sudah Dibaca'
                      : 'Belum Ada Percakapan'}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Mulai obrolan pribadi atau buat grup baru lewat tombol pesan baru.
                  </p>
                  <button
                    onClick={() => setShowNewChatModal(true)}
                    className="mt-4 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
                  >
                    Mulai Chat Baru
                  </button>
                </div>
              ) : (
                sortedConversations.map((c) => {
                  const isGroup = c.type === 'group';
                  const isSelfChat = c.id.startsWith('self_') || (!isGroup && c.memberUids.length === 1);
                  const peerUid = !isGroup && !isSelfChat ? c.memberUids.find((u) => u !== myProfile.uid) : undefined;
                  const peer = peerUid ? profilesCache[peerUid] : undefined;
                  const contactAlias = peerUid ? contactsByUid[peerUid]?.aliasName : undefined;
                  const state = memberStates[c.id];
                  const title = isSelfChat
                    ? 'Catatan Tersimpan'
                    : isGroup
                    ? c.title || 'Grup'
                    : contactAlias || peer?.displayName || 'Pengguna';
                  const avatar = isSelfChat
                    ? myProfile.photoURL
                    : isGroup
                    ? c.photoURL
                    : peer?.showProfilePhoto
                    ? peer?.photoURL
                    : undefined;
                  const isOnline = !isGroup && !isSelfChat && Boolean(peerUid && onlineUsers[peerUid] && peer?.showOnlineStatus);
                  const convTyping = Object.values(typingMap[c.id] || {});
                  const unread = state?.unreadCount || 0;
                  const isMuted = (state?.mutedUntil || 0) > Date.now();
                  const isActive = activeConvId === c.id;

                  return (
                    <div
                      key={c.id}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setConvMenuId(convMenuId === c.id ? null : c.id);
                      }}
                      className={`group relative flex items-center transition-colors ${
                        isActive
                          ? 'bg-emerald-50/80 dark:bg-emerald-950/30'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <button
                        onClick={() => {
                          setActiveConvId(c.id);
                          setShowInfoDrawer(false);
                          setConvMenuId(null);
                        }}
                        className="flex-1 min-w-0 flex items-center gap-3 px-4 py-3 text-left"
                      >
                        <Avatar name={title} src={avatar} size="md" online={isOnline} isGroup={isGroup} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                              {title}
                            </span>
                            <span className="text-[11px] text-slate-400 font-mono-num shrink-0">
                              {formatListTime(c.lastMessageAt || c.updatedAt)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2 mt-0.5">
                            <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
                              {convTyping.length > 0 ? (
                                <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                                  sedang mengetik...
                                </span>
                              ) : (
                                c.lastMessageText || 'Belum ada pesan'
                              )}
                            </span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {state?.pinned && <Pin className="w-3 h-3 text-slate-400" />}
                              {isMuted && <BellOff className="w-3 h-3 text-slate-400" />}
                              {state?.archived && <Archive className="w-3 h-3 text-slate-400" />}
                              {unread > 0 && (
                                <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-emerald-600 text-white text-[11px] font-bold flex items-center justify-center font-mono-num">
                                  {unread}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConvMenuId(convMenuId === c.id ? null : c.id);
                        }}
                        className="mr-2 p-1.5 rounded-lg opacity-60 lg:opacity-0 lg:group-hover:opacity-100 hover:bg-slate-200/70 dark:hover:bg-slate-700 text-slate-500"
                        aria-label="Aksi cepat chat"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>

                      {convMenuId === c.id && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="absolute right-3 top-12 z-40 w-44 rounded-2xl bg-white dark:bg-[#1A242D] border border-slate-200 dark:border-slate-700 shadow-xl p-1.5 text-xs space-y-0.5"
                        >
                          <button
                            onClick={async () => {
                              await updateMemberConversationPref(c.id, myProfile.uid, {
                                pinned: !state?.pinned,
                              });
                              setConvMenuId(null);
                            }}
                            className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
                          >
                            <Pin className="w-3.5 h-3.5" />
                            {state?.pinned ? 'Lepas Sematan' : 'Sematkan Chat'}
                          </button>
                          <button
                            onClick={async () => {
                              await updateMemberConversationPref(c.id, myProfile.uid, {
                                mutedUntil: isMuted ? 0 : Date.now() + 7 * 24 * 3600 * 1000,
                              });
                              setConvMenuId(null);
                            }}
                            className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
                          >
                            <BellOff className="w-3.5 h-3.5" />
                            {isMuted ? 'Bunyikan Chat' : 'Bisukan 7 Hari'}
                          </button>
                          <button
                            onClick={async () => {
                              await updateMemberConversationPref(c.id, myProfile.uid, {
                                archived: !state?.archived,
                              });
                              setConvMenuId(null);
                            }}
                            className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
                          >
                            <Archive className="w-3.5 h-3.5" />
                            {state?.archived ? 'Keluarkan Arsip' : 'Arsipkan Chat'}
                          </button>
                          {unread > 0 && (
                            <button
                              onClick={async () => {
                                await updateMemberConversationPref(c.id, myProfile.uid, {
                                  unreadCount: 0,
                                });
                                setConvMenuId(null);
                              }}
                              className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
                            >
                              <CheckCheck className="w-3.5 h-3.5 text-emerald-600" />
                              Tandai Dibaca
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </aside>
        )}

        {/* Primary Right / Main Panel */}
        {activeTab === 'chats' ? (
          activeConv ? (
            <div className={`${isMobileChatOpen ? 'flex' : 'hidden lg:flex'} flex-1 min-w-0 h-full`}>
              <ChatRoom
                conv={activeConv}
                allConversations={conversations}
                myProfile={myProfile}
                peerProfile={activePeerProfile}
                membersProfiles={profilesCache}
                myMemberState={memberStates[activeConv.id]}
                settings={settings}
                isBlocked={Boolean(activePeerProfile && blockedSet.has(activePeerProfile.uid))}
                isPeerOnline={Boolean(activePeerProfile && onlineUsers[activePeerProfile.uid])}
                typingUsers={typingMap[activeConv.id] || {}}
                onBack={() => setActiveConvId(null)}
                onToggleInfo={() => setShowInfoDrawer(!showInfoDrawer)}
                onStartCall={(type) => {
                  if (activePeerProfile) {
                    handleStartCall(
                      activePeerProfile.uid,
                      activePeerProfile.displayName,
                      activePeerProfile.photoURL,
                      type
                    );
                  }
                }}
              />
              {showInfoDrawer && (
                <div className="fixed inset-0 z-40 lg:static lg:z-auto flex justify-end bg-black/40 lg:bg-transparent">
                  <ChatInfoDrawer
                    conv={activeConv}
                    myProfile={myProfile}
                    peerProfile={activePeerProfile}
                    myMemberState={memberStates[activeConv.id]}
                    membersProfiles={profilesCache}
                    messages={activeConvMessages}
                    contacts={contacts}
                    isBlocked={Boolean(activePeerProfile && blockedSet.has(activePeerProfile.uid))}
                    onClose={() => setShowInfoDrawer(false)}
                    onLeaveOrDelete={() => {
                      setShowInfoDrawer(false);
                      setActiveConvId(null);
                    }}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="hidden lg:flex flex-1 flex-col items-center justify-center p-10 text-center pk-chat-wallpaper">
              <div className="max-w-md rounded-3xl bg-white/90 dark:bg-[#111820]/90 border border-slate-200 dark:border-slate-800 p-8 shadow-sm">
                <div className="mx-auto w-fit mb-4">
                  <PKLogo size={48} showWordmark={false} />
                </div>
                <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
                  Selamat Datang di PK Chat
                </h2>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  Pilih percakapan di sebelah kiri atau tambahkan kontak teman Anda menggunakan @username atau nomor HP persis.
                </p>
                <div className="mt-5 flex items-center justify-center gap-2 text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                  <Lock className="w-3.5 h-3.5" />
                  <span>Pesan pribadi terenkripsi end-to-end</span>
                </div>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                  <button
                    onClick={() => setShowNewChatModal(true)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors"
                  >
                    <MessageSquarePlus className="w-4 h-4" />
                    Mulai Percakapan Baru
                  </button>
                  <button
                    onClick={handleOpenSavedMessages}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold transition-colors"
                  >
                    <Bookmark className="w-4 h-4 text-emerald-600" />
                    Catatan Tersimpan
                  </button>
                </div>
              </div>
            </div>
          )
        ) : activeTab === 'status' ? (
          <StatusView
            myProfile={myProfile}
            statuses={statuses}
            contacts={contacts}
            pendingCameraMedia={pendingCameraMedia}
            onConsumePendingMedia={() => setPendingCameraMedia(null)}
            onOpenChat={(convId) => {
              setActiveConvId(convId);
              setActiveTab('chats');
            }}
          />
        ) : activeTab === 'communities' ? (
          <CommunitiesView
            myProfile={myProfile}
            contacts={contacts}
            openCreateGroupSignal={createGroupSignal}
            onOpenChat={(convId) => {
              setActiveConvId(convId);
              setActiveTab('chats');
            }}
          />
        ) : activeTab === 'calls' ? (
          <CallsView
            calls={calls}
            contacts={contacts}
            myUid={myProfile.uid}
            onStartCall={(peerUid, peerName, peerPhoto, type) =>
              handleStartCall(peerUid, peerName, peerPhoto, type)
            }
          />
        ) : (
          <SettingsView
            myProfile={myProfile}
            settings={settings}
            blockedUsers={blockedUsers}
            hasAppLock={Boolean(appLockHash)}
            onSaveAppLock={handleSaveAppLock}
            onLockNow={() => setAppLocked(true)}
            onApplyTheme={(t) => applyTheme(t)}
            onApplyFontSize={(sz) => setSettings((prev) => ({ ...prev, fontSize: sz }))}
          />
        )}
      </div>

      {/* Mobile Bottom Navigation Bar (Hidden when inside active chat room) */}
      {!isMobileChatOpen && (
        <nav className="lg:hidden h-16 pb-safe border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-[#111820]/95 backdrop-blur-md grid grid-cols-5 items-center shrink-0">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`relative min-h-[44px] flex flex-col items-center justify-center gap-0.5 transition-colors ${
                  active
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <div className="relative">
                  {item.icon}
                  {item.badge ? (
                    <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-emerald-600 text-white text-[10px] font-bold flex items-center justify-center font-mono-num">
                      {item.badge}
                    </span>
                  ) : null}
                </div>
                <span className="text-[10px] font-semibold tracking-tight">{item.label}</span>
              </button>
            );
          })}
        </nav>
      )}

      {/* New Chat Modal (Private Contact-First Discovery) */}
      {showNewChatModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-[#111820] border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Mulai Percakapan Baru
              </h3>
              <button onClick={() => setShowNewChatModal(false)} className="p-1 text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowNewChatModal(false);
                  setActiveTab('communities');
                  setCreateGroupSignal((s) => s + 1);
                }}
                className="flex items-center gap-2.5 p-2.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100/70 dark:hover:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 text-xs font-semibold transition-colors"
              >
                <div className="w-7 h-7 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0">
                  <Users className="w-3.5 h-3.5" />
                </div>
                <span className="truncate">Buat Grup Baru</span>
              </button>

              <button
                type="button"
                onClick={handleOpenSavedMessages}
                className="flex items-center gap-2.5 p-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200/70 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-semibold transition-colors"
              >
                <div className="w-7 h-7 rounded-full bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                  <Bookmark className="w-3.5 h-3.5" />
                </div>
                <span className="truncate">Catatan Tersimpan</span>
              </button>
            </div>

            {/* Private Add Contact Form (Exact Lookup Only) */}
            <form
              onSubmit={handleExactLookupForAdd}
              className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-3 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Tambah Kontak Baru
                </span>
                <span className="text-[10px] text-slate-400">Privasi Ketat · Add Dulu</span>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={addContactQuery}
                  onChange={(e) => {
                    setAddContactQuery(e.target.value);
                    setAddContactSearched(false);
                    setAddContactResult(null);
                  }}
                  placeholder="@username persis atau no. HP..."
                  className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                />
                <button
                  type="submit"
                  disabled={addContactLoading || addContactQuery.trim().length < 3}
                  className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-50"
                >
                  {addContactLoading ? '...' : 'Cari'}
                </button>
              </div>

              {addContactSearched && !addContactResult && (
                <p className="text-[11px] text-slate-500">
                  Pengguna tidak ditemukan. Pastikan penulisan @username atau nomor HP sudah persis.
                </p>
              )}

              {addContactResult && (
                <div className="flex items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar name={addContactResult.displayName} src={addContactResult.photoURL} size="sm" />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate">{addContactResult.displayName}</div>
                      <div className="text-[11px] text-slate-500 truncate">@{addContactResult.username}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleAddAndOpenChat(addContactResult)}
                    className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold flex items-center gap-1 shrink-0"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    {contactsByUid[addContactResult.uid] ? 'Chat' : 'Add & Chat'}
                  </button>
                </div>
              )}
            </form>

            {/* Filter saved contacts ONLY */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={newChatQuery}
                onChange={(e) => setNewChatQuery(e.target.value)}
                placeholder="Filter kontak yang sudah Anda tambahkan..."
                className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"
              />
            </div>

            <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {(() => {
                const needle = newChatQuery.trim().toLowerCase();
                const filteredContacts = contacts.filter(
                  (c) =>
                    !needle ||
                    c.aliasName.toLowerCase().includes(needle) ||
                    c.displayName.toLowerCase().includes(needle) ||
                    c.username.toLowerCase().includes(needle)
                );

                if (filteredContacts.length === 0) {
                  return (
                    <div className="py-5 text-center text-xs text-slate-500">
                      {contacts.length === 0
                        ? 'Daftar kontak masih kosong. Tambahkan teman lewat @username atau nomor HP persis di atas.'
                        : 'Tidak ada kontak yang cocok dengan filter Anda.'}
                    </div>
                  );
                }

                return filteredContacts.map((c) => (
                  <button
                    key={c.contactUid}
                    onClick={() =>
                      handleOpenChatWithUser({
                        uid: c.contactUid,
                        username: c.username,
                        displayName: c.displayName,
                        photoURL: c.photoURL,
                        isOnline: false,
                        showOnlineStatus: true,
                        showLastSeen: true,
                        showProfilePhoto: true,
                      })
                    }
                    className="w-full flex items-center gap-3 py-2.5 px-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-left rounded-xl"
                  >
                    <Avatar name={c.aliasName} src={c.photoURL} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold truncate">{c.aliasName}</div>
                      <div className="text-xs text-slate-500">@{c.username}</div>
                    </div>
                  </button>
                ));
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Notifications Drawer Modal */}
      {showNotificationsModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-[#111820] border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-base font-bold">Pusat Notifikasi</h3>
              <div className="flex items-center gap-1.5">
                {unreadNotifs > 0 && (
                  <button
                    onClick={() => markAllNotificationsRead(myProfile.uid, notifications)}
                    className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-[11px] font-semibold"
                  >
                    Tandai Dibaca
                  </button>
                )}
                {notifications.length > 0 && (
                  <button
                    onClick={() => clearAllNotifications(myProfile.uid, notifications)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600"
                    title="Bersihkan semua"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <button onClick={() => setShowNotificationsModal(false)} className="p-1 text-slate-400">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {notifications.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-500">Belum ada notifikasi baru.</p>
              ) : (
                notifications.map((n) => (
                  <button
                    key={n.id}
                    onClick={async () => {
                      await updateDoc(doc(db, 'users', myProfile.uid, 'notifications', n.id), {
                        isRead: true,
                      });
                      if (n.refId) {
                        setActiveConvId(n.refId);
                        setActiveTab('chats');
                        setShowNotificationsModal(false);
                      }
                    }}
                    className={`w-full text-left py-3 px-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/40 ${
                      !n.isRead ? 'bg-emerald-50/50 dark:bg-emerald-950/20' : ''
                    }`}
                  >
                    <div className="text-xs font-bold text-slate-900 dark:text-white">{n.title}</div>
                    <div className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">{n.body}</div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Global Starred Messages Modal */}
      {showStarredModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-[#111820] border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                <h3 className="font-display text-base font-bold">Semua Pesan Berbintang</h3>
              </div>
              <button onClick={() => setShowStarredModal(false)} className="p-1 text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {loadingStarred ? (
                <p className="py-8 text-center text-xs text-slate-500">Memuat pesan berbintang...</p>
              ) : globalStarred.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-500">
                  Belum ada pesan yang Anda bintangi.
                </p>
              ) : (
                globalStarred.map(({ conv, msg, display }) => {
                  const isSelf = conv.id.startsWith('self_') || (conv.type === 'private' && conv.memberUids.length === 1);
                  const otherUid = conv.memberUids.find((u) => u !== myProfile.uid);
                  const convName = isSelf
                    ? 'Catatan Tersimpan'
                    : conv.type === 'group'
                    ? conv.title || 'Grup'
                    : (otherUid && (contactsByUid[otherUid]?.aliasName || profilesCache[otherUid]?.displayName)) || 'Percakapan';
                  return (
                    <button
                      key={msg.id}
                      onClick={() => {
                        setActiveConvId(conv.id);
                        setActiveTab('chats');
                        setShowStarredModal(false);
                      }}
                      className="w-full text-left py-3 px-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/40"
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
                        <span className="truncate">{msg.senderName} · {convName}</span>
                        <span className="text-slate-400 font-mono-num shrink-0">
                          {formatListTime(msg.createdAt)}
                        </span>
                      </div>
                      <div className="text-xs text-slate-800 dark:text-slate-200 mt-1 line-clamp-2">
                        {display}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Active WebRTC Call Overlay */}
      <CallOverlay
        session={activeCall}
        myUid={myProfile.uid}
        myName={myProfile.displayName}
        myPhoto={myProfile.photoURL}
        onUpdateStatus={(status) =>
          setActiveCall((prev) => (prev ? { ...prev, status } : null))
        }
        onClose={() => setActiveCall(null)}
      />

      {/* App Lock PIN Overlay */}
      {appLockHash && appLocked && (
        <div className="fixed inset-0 z-[100] bg-slate-950/95 backdrop-blur-md flex items-center justify-center p-4">
          <form
            onSubmit={handleUnlockApp}
            className="w-full max-w-sm rounded-3xl bg-white dark:bg-[#111820] border border-slate-200 dark:border-slate-800 p-7 space-y-5 text-center shadow-2xl"
          >
            <div className="mx-auto w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center">
              <Lock className="w-7 h-7" />
            </div>
            <div>
              <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                PK Chat Terkunci
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Masukkan PIN perangkat Anda untuk membuka ruang obrolan @{myProfile.username}.
              </p>
            </div>
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              maxLength={12}
              value={pinUnlockInput}
              onChange={(e) => {
                setPinUnlockInput(e.target.value);
                if (pinUnlockError) setPinUnlockError('');
              }}
              placeholder="Masukkan PIN..."
              className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-center text-base tracking-[0.35em] font-semibold"
            />
            {pinUnlockError && (
              <p className="text-xs text-rose-500 font-medium">{pinUnlockError}</p>
            )}
            <button
              type="submit"
              disabled={!pinUnlockInput.trim()}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50"
            >
              Buka Kunci
            </button>
            <button
              type="button"
              onClick={() => signOut(auth)}
              className="text-xs text-slate-500 hover:text-rose-500 underline"
            >
              Keluar dari Akun
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <PKChatApp />
      </ToastProvider>
    </ErrorBoundary>
  );
}
