import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import {
  ArrowLeft,
  BarChart2,
  Camera,
  Check,
  CheckCheck,
  ChevronDown,
  Clock,
  Copy,
  Download,
  Edit3,
  FileText,
  Forward,
  Image as ImageIcon,
  Info,
  Lock,
  Mic,
  MoreVertical,
  Music,
  Paperclip,
  Phone,
  Plus,
  Reply,
  Search,
  Send,
  Smile,
  Square,
  Star,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { decryptMessageText } from '../lib/e2ee';
import {
  deleteMessageForAll,
  deleteMessageForMe,
  editMessageText,
  markConversationRead,
  sendMessage,
  setTypingStatus,
  toggleMessageReaction,
  toggleStarMessage,
  uploadMediaFile,
  voteOnPoll,
} from '../lib/chatService';
import type {
  Conversation,
  ConversationMember,
  Message,
  PollOption,
  UserProfile,
  UserSettings,
} from '../types/chat';
import { Avatar } from './PKLogo';
import { useToast } from './ToastProvider';

interface ChatRoomProps {
  conv: Conversation;
  allConversations: Conversation[];
  myProfile: UserProfile;
  peerProfile?: UserProfile | null;
  membersProfiles: Record<string, UserProfile>;
  myMemberState?: ConversationMember;
  settings: UserSettings;
  isBlocked: boolean;
  isPeerOnline: boolean;
  typingUsers: Record<string, string>;
  onBack: () => void;
  onToggleInfo: () => void;
  onStartCall: (type: 'audio' | 'video') => void;
}

const EMOJI_LIST = [
  '😀', '😂', '😍', '🥰', '😎', '🤔', '😅', '😭', '🙏', '👍',
  '👏', '🔥', '❤️', '💚', '✨', '🎉', '🚀', '☕', '🤝', '💯',
];

const STICKER_PACK = [
  { id: 'stk_halo', label: 'Halo!', emoji: '👋', bg: '#10B981' },
  { id: 'stk_oke', label: 'Oke Siap!', emoji: '👌', bg: '#059669' },
  { id: 'stk_mantap', label: 'Mantap!', emoji: '🔥', bg: '#D97706' },
  { id: 'stk_makasih', label: 'Makasih', emoji: '💚', bg: '#047857' },
  { id: 'stk_semangat', label: 'Semangat!', emoji: '🚀', bg: '#2563EB' },
  { id: 'stk_ngopi', label: 'Ngopi Yuk', emoji: '☕', bg: '#78350F' },
];

const GIF_CARDS = [
  { id: 'gif_party', title: 'Selamat & Perayaan', badge: '🎉✨🥳', color: 'from-emerald-500 to-teal-600' },
  { id: 'gif_laugh', title: 'Ngakak Banget', badge: '😂🤣💥', color: 'from-amber-500 to-orange-600' },
  { id: 'gif_love', title: 'Terima Kasih Banyak', badge: '💚🫶✨', color: 'from-rose-500 to-pink-600' },
  { id: 'gif_work', title: 'Gas Kerjakan!', badge: '⚡💻🚀', color: 'from-indigo-500 to-blue-600' },
];

export const ChatRoom: React.FC<ChatRoomProps> = ({
  conv,
  allConversations,
  myProfile,
  peerProfile,
  membersProfiles,
  settings,
  isBlocked,
  isPeerOnline,
  typingUsers,
  onBack,
  onToggleInfo,
  onStartCall,
}) => {
  const { showToast } = useToast();
  const [rawMessages, setRawMessages] = useState<Message[]>([]);
  const [decryptedMap, setDecryptedMap] = useState<Record<string, string>>({});
  const [loadingMsgs, setLoadingMsgs] = useState(true);

  const [inputText, setInputText] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingMsg, setEditingMsg] = useState<Message | null>(null);
  const [activeMsgMenu, setActiveMsgMenu] = useState<string | null>(null);

  // Multi-select
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Search inside chat
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Pickers & Modals
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showMediaTray, setShowMediaTray] = useState<'emoji' | 'sticker' | 'gif' | null>(null);
  const [showPollModal, setShowPollModal] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [pollMultiple, setPollMultiple] = useState(false);
  const [forwardMsgs, setForwardMsgs] = useState<Message[] | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Voice recording & scroll helpers
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const voiceCancelledRef = useRef(false);
  const typingTimeoutRef = useRef<number | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const isGroup = conv.type === 'group';
  const isAdmin = conv.adminUids?.includes(myProfile.uid);
  const cannotSendInGroup = isGroup && conv.onlyAdminsCanSend && !isAdmin;

  // Subscribe to messages
  useEffect(() => {
    setLoadingMsgs(true);
    const q = query(
      collection(db, 'conversations', conv.id, 'messages'),
      where('convId', '==', conv.id)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as Message)
          .sort((a, b) => (a.createdAt?.toMillis?.() ?? Date.now()) - (b.createdAt?.toMillis?.() ?? Date.now()));
        setRawMessages(list);
        setLoadingMsgs(false);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `conversations/${conv.id}/messages`)
    );
    return () => unsub();
  }, [conv.id]);

  // Decrypt E2EE messages for private chats
  useEffect(() => {
    if (isGroup || !peerProfile?.e2eePublicKey) return;
    let cancelled = false;
    (async () => {
      const updates: Record<string, string> = {};
      for (const m of rawMessages) {
        if (m.encryptedPayload && m.iv && !decryptedMap[m.id]) {
          const plain = await decryptMessageText(
            myProfile.uid,
            peerProfile.e2eePublicKey,
            m.encryptedPayload,
            m.iv
          );
          if (plain) updates[m.id] = plain;
        }
      }
      if (!cancelled && Object.keys(updates).length > 0) {
        setDecryptedMap((prev) => ({ ...prev, ...updates }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rawMessages, isGroup, peerProfile?.e2eePublicKey, myProfile.uid]);

  // Filter out expired disappearing messages & deletedForMe
  const visibleMessages = useMemo(() => {
    const now = Date.now();
    return rawMessages.filter((m) => {
      if (m.deletedForUids?.includes(myProfile.uid)) return false;
      if (m.expiresAt && m.expiresAt < now) return false;
      if (searchQuery.trim()) {
        const display = decryptedMap[m.id] || m.text || m.mediaName || m.pollQuestion || '';
        return display.toLowerCase().includes(searchQuery.trim().toLowerCase());
      }
      return true;
    });
  }, [rawMessages, myProfile.uid, searchQuery, decryptedMap]);

  // Mark messages delivered & read
  useEffect(() => {
    if (rawMessages.length > 0) {
      markConversationRead(conv.id, myProfile.uid, rawMessages, settings.readReceipts);
    }
  }, [conv.id, rawMessages.length, settings.readReceipts]);

  // Scroll to bottom on new message
  useEffect(() => {
    if (!searchQuery) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [visibleMessages.length, conv.id]);

  // Voice recording timer
  useEffect(() => {
    if (!recording) {
      setRecordSeconds(0);
      return;
    }
    const timer = window.setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [recording]);

  // @mention autocomplete in groups
  const mentionMatch = isGroup ? inputText.match(/@([a-z0-9_]*)$/i) : null;
  const mentionSuggestions = useMemo(() => {
    if (!mentionMatch) return [];
    const needle = mentionMatch[1].toLowerCase();
    return conv.memberUids
      .filter((u) => u !== myProfile.uid)
      .map((u) => membersProfiles[u])
      .filter(
        (p): p is UserProfile =>
          Boolean(p) &&
          (p.username.toLowerCase().includes(needle) || p.displayName.toLowerCase().includes(needle))
      )
      .slice(0, 5);
  }, [mentionMatch?.[1], conv.memberUids, membersProfiles]);

  const lastTypingEmitRef = useRef<number>(0);

  const emitTyping = (isTyping: boolean) => {
    const now = Date.now();
    if (isTyping && now - lastTypingEmitRef.current < 1800) {
      return;
    }
    lastTypingEmitRef.current = isTyping ? now : 0;
    setTypingStatus(conv.id, myProfile.uid, myProfile.displayName, isTyping);
  };

  const handleInputChange = (val: string) => {
    setInputText(val);
    emitTyping(val.length > 0);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = window.setTimeout(() => emitTyping(false), 2500);
  };

  const handleSendText = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed) return;
    if (isBlocked) {
      showToast('Anda memblokir pengguna ini. Buka blokir untuk mengirim pesan.', 'error');
      return;
    }

    emitTyping(false);
    setInputText('');

    if (editingMsg) {
      try {
        await editMessageText(conv.id, editingMsg.id, trimmed, conv, myProfile.uid, peerProfile);
        setEditingMsg(null);
        showToast('Pesan diperbarui', 'success');
      } catch {
        showToast('Gagal mengedit pesan', 'error');
      }
      return;
    }

    // Extract mentions in groups
    const mentionedUids: string[] = [];
    if (isGroup) {
      for (const uid of conv.memberUids) {
        const p = membersProfiles[uid];
        if (p && trimmed.includes(`@${p.username}`)) {
          mentionedUids.push(uid);
        }
      }
    }

    try {
      await sendMessage({
        conv,
        sender: myProfile,
        peerProfile,
        type: 'text',
        text: trimmed,
        replyTo,
        mentions: mentionedUids,
      });
      setReplyTo(null);
    } catch {
      showToast('Gagal mengirim pesan', 'error');
    }
  };

  const handleFileUploadAndSend = async (
    e: React.ChangeEvent<HTMLInputElement>,
    forceType?: 'image' | 'video' | 'document' | 'audio'
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setShowAttachMenu(false);

    try {
      showToast('Mengunggah media...', 'info');
      const uploaded = await uploadMediaFile(file);
      let msgType: 'image' | 'video' | 'document' | 'audio' = forceType || 'document';
      if (!forceType) {
        if (file.type.startsWith('image/')) msgType = 'image';
        else if (file.type.startsWith('video/')) msgType = 'video';
        else if (file.type.startsWith('audio/')) msgType = 'audio';
      }
      await sendMessage({
        conv,
        sender: myProfile,
        peerProfile,
        type: msgType,
        text: file.name,
        mediaUrl: uploaded.url,
        mediaName: uploaded.name,
        mediaSize: uploaded.size,
        mediaMime: uploaded.mimeType,
        replyTo,
      });
      setReplyTo(null);
    } catch (err: any) {
      showToast(err?.message || 'Gagal mengunggah file', 'error');
    }
  };

  const startVoiceRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      voiceCancelledRef.current = false;
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (voiceCancelledRef.current) {
          audioChunksRef.current = [];
          return;
        }
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        if (blob.size < 500) return;
        try {
          const uploaded = await uploadMediaFile(blob, `pesan_suara_${Date.now()}.webm`);
          await sendMessage({
            conv,
            sender: myProfile,
            peerProfile,
            type: 'voice',
            text: 'Pesan suara',
            mediaUrl: uploaded.url,
            mediaName: uploaded.name,
            mediaSize: uploaded.size,
            mediaMime: uploaded.mimeType,
            replyTo,
          });
          setReplyTo(null);
        } catch {
          showToast('Gagal mengirim pesan suara', 'error');
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      showToast('Izin mikrofon diperlukan untuk pesan suara', 'error');
    }
  };

  const stopVoiceRecording = () => {
    voiceCancelledRef.current = false;
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  const cancelVoiceRecording = () => {
    voiceCancelledRef.current = true;
    mediaRecorderRef.current?.stop();
    setRecording(false);
    showToast('Rekaman suara dibatalkan', 'info');
  };

  const handleSendSticker = async (stk: typeof STICKER_PACK[number]) => {
    setShowMediaTray(null);
    await sendMessage({
      conv,
      sender: myProfile,
      peerProfile,
      type: 'sticker',
      text: `${stk.emoji} ${stk.label}`,
      mediaName: stk.bg,
      replyTo,
    });
    setReplyTo(null);
  };

  const handleSendGif = async (gif: typeof GIF_CARDS[number]) => {
    setShowMediaTray(null);
    await sendMessage({
      conv,
      sender: myProfile,
      peerProfile,
      type: 'gif',
      text: `${gif.badge} ${gif.title}`,
      mediaName: gif.color,
      replyTo,
    });
    setReplyTo(null);
  };

  const handleCreatePoll = async (e: React.FormEvent) => {
    e.preventDefault();
    const validOpts: PollOption[] = pollOptions
      .map((t, idx) => ({ id: `opt_${idx}`, text: t.trim() }))
      .filter((o) => o.text.length > 0);
    if (!pollQuestion.trim() || validOpts.length < 2) {
      showToast('Pertanyaan dan minimal 2 opsi wajib diisi', 'error');
      return;
    }
    await sendMessage({
      conv,
      sender: myProfile,
      peerProfile,
      type: 'poll',
      text: pollQuestion.trim(),
      pollQuestion: pollQuestion.trim(),
      pollOptions: validOpts,
      pollAllowMultiple: pollMultiple,
    });
    setShowPollModal(false);
    setPollQuestion('');
    setPollOptions(['', '']);
  };

  const handleForwardToConv = async (targetConv: Conversation) => {
    if (!forwardMsgs) return;
    for (const m of forwardMsgs) {
      const textBody = decryptedMap[m.id] || m.text || '';
      await sendMessage({
        conv: targetConv,
        sender: myProfile,
        peerProfile: null,
        type: m.type === 'system' ? 'text' : m.type,
        text: textBody,
        mediaUrl: m.mediaUrl,
        mediaName: m.mediaName,
        mediaSize: m.mediaSize,
        mediaMime: m.mediaMime,
        forwardedFrom: m.senderName,
      });
    }
    setForwardMsgs(null);
    setSelectMode(false);
    setSelectedIds([]);
    showToast('Pesan diteruskan', 'success');
  };

  const formatTime = (ts: any) => {
    if (!ts) return '';
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  };

  const getDateKey = (ts: any) => {
    if (!ts) return '';
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  };

  const formatDateSeparator = (ts: any) => {
    if (!ts) return '';
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'Hari Ini';
    if (d.toDateString() === yesterday.toDateString()) return 'Kemarin';
    return d.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  const scrollToMessage = (msgId: string) => {
    const el = document.getElementById(`msg-${msgId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedMsgId(msgId);
      window.setTimeout(() => setHighlightedMsgId(null), 1600);
    }
  };

  const renderFormattedText = (content: string) => {
    const parts = content.split(/(https?:\/\/[^\s]+|@[a-z0-9_]+)/gi);
    return parts.map((part, idx) => {
      if (/^https?:\/\/[^\s]+$/i.test(part)) {
        return (
          <a
            key={idx}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="underline decoration-emerald-500/70 text-emerald-700 dark:text-emerald-300 hover:opacity-80 break-all"
          >
            {part}
          </a>
        );
      }
      if (/^@[a-z0-9_]+$/i.test(part)) {
        return (
          <span key={idx} className="font-semibold text-emerald-700 dark:text-emerald-300">
            {part}
          </span>
        );
      }
      return <React.Fragment key={idx}>{part}</React.Fragment>;
    });
  };

  const fontSizeClass =
    settings.fontSize === 'small'
      ? 'text-xs'
      : settings.fontSize === 'large'
      ? 'text-base'
      : 'text-sm';

  const typingNames = Object.values(typingUsers).filter(Boolean);
  const chatTitle = isGroup ? conv.title || 'Grup PK Chat' : peerProfile?.displayName || 'Pengguna';
  const chatAvatar = isGroup
    ? conv.photoURL
    : peerProfile?.showProfilePhoto
    ? peerProfile?.photoURL
    : undefined;

  return (
    <div className="flex-1 flex flex-col h-full min-w-0 bg-[#F4F7F5] dark:bg-[#0D1419]">
      {/* Chat Header */}
      <header className="h-14 px-3 sm:px-4 bg-white dark:bg-[#111820] border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={onBack}
            className="lg:hidden min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Kembali ke daftar chat"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <button onClick={onToggleInfo} className="flex items-center gap-3 min-w-0 text-left">
            <Avatar
              name={chatTitle}
              src={chatAvatar}
              size="sm"
              online={!isGroup && isPeerOnline && peerProfile?.showOnlineStatus}
              isGroup={isGroup}
            />
            <div className="min-w-0">
              <div className="font-display text-sm font-bold text-slate-900 dark:text-white truncate">
                {chatTitle}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {typingNames.length > 0 ? (
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                    {isGroup ? `${typingNames[0]} sedang mengetik...` : 'sedang mengetik...'}
                  </span>
                ) : isGroup ? (
                  `${conv.memberUids.length} anggota`
                ) : isPeerOnline && peerProfile?.showOnlineStatus ? (
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">Online</span>
                ) : peerProfile?.showLastSeen && peerProfile?.lastSeen ? (
                  `Terakhir dilihat ${formatTime(peerProfile.lastSeen)}`
                ) : (
                  `@${peerProfile?.username || ''}`
                )}
              </div>
            </div>
          </button>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {conv.disappearingSeconds > 0 && (
            <span
              title="Pesan sementara aktif"
              className="hidden sm:inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300"
            >
              <Clock className="w-3.5 h-3.5" />
              Sementara
            </span>
          )}
          <button
            onClick={() => setShowSearch(!showSearch)}
            className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Cari pesan"
          >
            <Search className="w-4 h-4" />
          </button>
          {!isGroup && (
            <>
              <button
                onClick={() => onStartCall('audio')}
                className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Panggilan suara"
              >
                <Phone className="w-4 h-4" />
              </button>
              <button
                onClick={() => onStartCall('video')}
                className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Panggilan video"
              >
                <Video className="w-4 h-4" />
              </button>
            </>
          )}
          <button
            onClick={onToggleInfo}
            className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Info percakapan"
          >
            <Info className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Search Bar */}
      {showSearch && (
        <div className="px-4 py-2 bg-white dark:bg-[#111820] border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
          <Search className="w-4 h-4 text-slate-400" />
          <input
            type="text"
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari isi pesan di percakapan ini..."
            className="flex-1 bg-transparent text-sm text-slate-900 dark:text-white focus:outline-none"
          />
          <button
            onClick={() => {
              setSearchQuery('');
              setShowSearch(false);
            }}
            className="p-1 text-slate-400 hover:text-slate-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Multi-select Toolbar */}
      {selectMode && (
        <div className="px-4 py-2.5 bg-emerald-600 text-white flex items-center justify-between gap-3">
          <span className="text-xs font-semibold">{selectedIds.length} pesan dipilih</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const chosen = visibleMessages.filter((m) => selectedIds.includes(m.id));
                if (chosen.length > 0) setForwardMsgs(chosen);
              }}
              className="px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25 text-xs font-medium flex items-center gap-1"
            >
              <Forward className="w-3.5 h-3.5" /> Teruskan
            </button>
            <button
              onClick={async () => {
                const chosen = visibleMessages.filter((m) => selectedIds.includes(m.id));
                for (const m of chosen) {
                  await deleteMessageForMe(conv.id, m.id, myProfile.uid);
                }
                setSelectMode(false);
                setSelectedIds([]);
              }}
              className="px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25 text-xs font-medium flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" /> Hapus
            </button>
            <button
              onClick={() => {
                setSelectMode(false);
                setSelectedIds([]);
              }}
              className="p-1 rounded-lg hover:bg-white/20"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Message Feed */}
      <div
        ref={feedRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
          setShowScrollBottom(distFromBottom > 240);
        }}
        className="relative flex-1 overflow-y-auto pk-chat-wallpaper px-3 sm:px-6 py-4 space-y-2.5"
      >
        {!isGroup && (
          <div className="mx-auto max-w-md rounded-2xl bg-white/85 dark:bg-[#111820]/85 border border-slate-200/80 dark:border-slate-800 px-4 py-2.5 text-center text-[11px] text-slate-600 dark:text-slate-400 flex items-center justify-center gap-2">
            <Lock className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span>Pesan pribadi dienkripsi end-to-end dengan ECDH &amp; AES-GCM.</span>
          </div>
        )}

        {loadingMsgs ? (
          <div className="space-y-3 py-4">
            <div className="h-12 w-48 rounded-2xl bg-slate-200/70 dark:bg-slate-800/70 animate-pulse" />
            <div className="h-12 w-56 ml-auto rounded-2xl bg-emerald-200/50 dark:bg-emerald-900/40 animate-pulse" />
            <div className="h-16 w-64 rounded-2xl bg-slate-200/70 dark:bg-slate-800/70 animate-pulse" />
          </div>
        ) : visibleMessages.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {searchQuery ? 'Tidak ada pesan yang cocok.' : 'Mulai percakapan dengan mengirim pesan pertama Anda.'}
            </p>
          </div>
        ) : (
          visibleMessages.map((m, idx) => {
            const prevMsg = idx > 0 ? visibleMessages[idx - 1] : null;
            const dateKey = getDateKey(m.createdAt);
            const prevDateKey = prevMsg ? getDateKey(prevMsg.createdAt) : '';
            const showDateSep = dateKey && dateKey !== prevDateKey;

            if (m.type === 'system') {
              return (
                <React.Fragment key={m.id}>
                  {showDateSep && (
                    <div className="flex justify-center my-3">
                      <span className="rounded-xl bg-white/90 dark:bg-slate-800/90 border border-slate-200/70 dark:border-slate-700/70 px-3 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 shadow-2xs">
                        {formatDateSeparator(m.createdAt)}
                      </span>
                    </div>
                  )}
                  <div className="text-center my-2">
                    <span className="inline-block rounded-xl bg-white/80 dark:bg-slate-800/80 px-3 py-1 text-[11px] text-slate-600 dark:text-slate-300">
                      {m.text}
                    </span>
                  </div>
                </React.Fragment>
              );
            }

            const isOwn = m.senderUid === myProfile.uid;
            const displayBody = m.deletedForAll
              ? 'Pesan ini telah dihapus'
              : decryptedMap[m.id] || m.text || '';
            const reactionEntries = Object.entries(m.reactions || {});
            const isStarred = m.starredByUids?.includes(myProfile.uid);
            const peerRead =
              conv.memberUids.some((u) => u !== myProfile.uid && m.readByUids?.includes(u));
            const peerDelivered =
              conv.memberUids.some((u) => u !== myProfile.uid && m.deliveredToUids?.includes(u));
            const isSelected = selectedIds.includes(m.id);

            return (
              <React.Fragment key={m.id}>
                {showDateSep && (
                  <div className="flex justify-center my-3">
                    <span className="rounded-xl bg-white/90 dark:bg-slate-800/90 border border-slate-200/70 dark:border-slate-700/70 px-3 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 shadow-2xs">
                      {formatDateSeparator(m.createdAt)}
                    </span>
                  </div>
                )}
                <div
                  id={`msg-${m.id}`}
                  onClick={() => {
                    if (selectMode) {
                      setSelectedIds((prev) =>
                        isSelected ? prev.filter((id) => id !== m.id) : [...prev, m.id]
                      );
                    }
                  }}
                  className={`group flex items-end gap-2 transition-all ${isOwn ? 'justify-end' : 'justify-start'} ${
                    isSelected ? 'bg-emerald-500/10 rounded-xl p-1 -m-1' : ''
                  } ${highlightedMsgId === m.id ? 'ring-2 ring-emerald-500 rounded-2xl p-1 -m-1 bg-emerald-500/10' : ''}`}
                >
                  {selectMode && (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {}}
                      className="mb-3 accent-emerald-600"
                    />
                  )}

                  <div className={`relative max-w-[82%] sm:max-w-[68%] flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}>
                    <div
                      className={`relative rounded-2xl px-3.5 py-2 shadow-xs ${
                        isOwn
                          ? 'bg-emerald-100/95 dark:bg-emerald-900/55 text-slate-900 dark:text-emerald-50 rounded-br-sm'
                          : 'bg-white dark:bg-[#1A242D] text-slate-900 dark:text-slate-100 border border-slate-200/70 dark:border-slate-800 rounded-bl-sm'
                      }`}
                    >
                      {/* Sender Name in Groups */}
                      {isGroup && !isOwn && (
                        <div className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 mb-0.5">
                          {m.senderName}
                        </div>
                      )}

                      {/* Forwarded label */}
                      {m.forwardedFrom && !m.deletedForAll && (
                        <div className="flex items-center gap-1 text-[10px] italic text-slate-500 dark:text-slate-400 mb-1">
                          <Forward className="w-3 h-3" /> Diteruskan dari {m.forwardedFrom}
                        </div>
                      )}

                      {/* Reply Quote */}
                      {m.replyToId && !m.deletedForAll && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            scrollToMessage(m.replyToId!);
                          }}
                          className="w-full text-left mb-1.5 rounded-xl bg-black/5 dark:bg-white/10 ring-1 ring-black/5 dark:ring-white/10 px-2.5 py-1.5 text-xs hover:bg-black/10 transition-colors"
                        >
                          <div className="font-semibold text-emerald-700 dark:text-emerald-300 text-[11px]">
                            {m.replyToSender}
                          </div>
                          <div className="text-slate-600 dark:text-slate-300 truncate max-w-[240px]">
                            {m.replyToPreview}
                          </div>
                        </button>
                      )}

                    {/* Content by Type */}
                    {m.deletedForAll ? (
                      <p className="text-xs italic text-slate-500 dark:text-slate-400">{displayBody}</p>
                    ) : m.type === 'image' && m.mediaUrl ? (
                      <div className="space-y-1">
                        <img
                          src={m.mediaUrl}
                          alt={m.mediaName || 'Foto'}
                          onClick={(e) => {
                            e.stopPropagation();
                            setLightboxUrl(m.mediaUrl!);
                          }}
                          className="rounded-xl max-h-64 object-cover cursor-pointer"
                        />
                      </div>
                    ) : m.type === 'video' && m.mediaUrl ? (
                      <video src={m.mediaUrl} controls className="rounded-xl max-h-64 max-w-full" />
                    ) : (m.type === 'audio' || m.type === 'voice') && m.mediaUrl ? (
                      <div className="flex flex-col gap-1 min-w-[210px]">
                        <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                          {m.type === 'voice' ? 'Pesan Suara' : m.mediaName || 'Audio'}
                        </span>
                        <audio src={m.mediaUrl} controls className="h-8 w-full max-w-[250px]" />
                      </div>
                    ) : m.type === 'document' && m.mediaUrl ? (
                      <a
                        href={m.mediaUrl}
                        download={m.mediaName}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2.5 p-2 rounded-xl bg-black/5 dark:bg-white/10 hover:bg-black/10 transition-colors"
                      >
                        <FileText className="w-5 h-5 text-emerald-600 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold truncate">{m.mediaName || 'Dokumen'}</div>
                          {m.mediaSize && (
                            <div className="text-[10px] text-slate-500 font-mono-num">
                              {(m.mediaSize / 1024).toFixed(1)} KB
                            </div>
                          )}
                        </div>
                        <Download className="w-4 h-4 shrink-0" />
                      </a>
                    ) : m.type === 'sticker' ? (
                      <div
                        className="rounded-2xl px-4 py-3 text-center text-white font-display font-bold shadow-xs"
                        style={{ backgroundColor: m.mediaName || '#059669' }}
                      >
                        <div className="text-3xl">{displayBody.split(' ')[0]}</div>
                        <div className="text-xs mt-1">{displayBody.split(' ').slice(1).join(' ')}</div>
                      </div>
                    ) : m.type === 'gif' ? (
                      <div
                        className={`rounded-2xl px-5 py-4 text-center text-white bg-gradient-to-br ${
                          m.mediaName || 'from-emerald-500 to-teal-600'
                        }`}
                      >
                        <div className="text-2xl tracking-widest animate-bounce">
                          {displayBody.split(' ')[0]}
                        </div>
                        <div className="text-xs font-bold mt-1">
                          {displayBody.split(' ').slice(1).join(' ')}
                        </div>
                      </div>
                    ) : m.type === 'poll' && m.pollOptions ? (
                      <div className="min-w-[230px] space-y-2">
                        <div className="text-xs font-bold">{m.pollQuestion}</div>
                        <div className="space-y-1.5">
                          {m.pollOptions.map((opt) => {
                            const voters = m.pollVotes?.[opt.id] || [];
                            const totalVotes = Object.values(m.pollVotes || {}).reduce(
                              (sum, arr) => sum + arr.length,
                              0
                            );
                            const pct = totalVotes > 0 ? Math.round((voters.length / totalVotes) * 100) : 0;
                            const voted = voters.includes(myProfile.uid);
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  voteOnPoll(conv.id, m, opt.id, myProfile.uid);
                                }}
                                className={`w-full text-left rounded-xl px-3 py-2 border text-xs relative overflow-hidden transition-colors ${
                                  voted
                                    ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/60'
                                    : 'border-slate-200 dark:border-slate-700'
                                }`}
                              >
                                <div
                                  className="absolute inset-y-0 left-0 bg-emerald-500/15"
                                  style={{ width: `${pct}%` }}
                                />
                                <div className="relative flex items-center justify-between gap-2">
                                  <span className="font-medium">{opt.text}</span>
                                  <span className="font-mono-num text-[11px] text-slate-500">
                                    {voters.length} ({pct}%)
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <p className={`${fontSizeClass} leading-relaxed whitespace-pre-wrap break-words`}>
                        {renderFormattedText(displayBody)}
                      </p>
                    )}

                    {/* Meta: Edited, Star, Time, Receipts */}
                    <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-slate-500 dark:text-slate-400">
                      {isStarred && <Star className="w-2.5 h-2.5 text-amber-500 fill-amber-500" />}
                      {m.editedAt && <span>diedit</span>}
                      <span className="font-mono-num">{formatTime(m.createdAt)}</span>
                      {isOwn && !m.deletedForAll && (
                        peerRead ? (
                          <CheckCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                        ) : peerDelivered ? (
                          <CheckCheck className="w-3.5 h-3.5 text-slate-400" />
                        ) : (
                          <Check className="w-3.5 h-3.5 text-slate-400" />
                        )
                      )}
                    </div>

                    {/* Menu trigger */}
                    {!m.deletedForAll && !selectMode && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveMsgMenu(activeMsgMenu === m.id ? null : m.id);
                        }}
                        className={`opacity-0 group-hover:opacity-100 focus:opacity-100 absolute top-1.5 ${
                          isOwn ? '-left-8' : '-right-8'
                        } p-1 rounded-lg bg-white/90 dark:bg-slate-800 shadow-xs text-slate-500 hover:text-slate-900 dark:hover:text-white transition-opacity`}
                        aria-label="Opsi pesan"
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Emoji Reactions Bar */}
                  {reactionEntries.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1 px-1">
                      {Array.from(new Set(reactionEntries.map(([, em]) => em))).map((em) => {
                        const count = reactionEntries.filter(([, e]) => e === em).length;
                        return (
                          <button
                            key={em}
                            onClick={() => toggleMessageReaction(conv.id, m, myProfile.uid, em)}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] shadow-2xs"
                          >
                            <span>{em}</span>
                            {count > 1 && <span className="font-mono-num text-[10px]">{count}</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Context Popover */}
                  {activeMsgMenu === m.id && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className={`mt-1 z-30 w-52 rounded-2xl bg-white dark:bg-[#1A242D] border border-slate-200 dark:border-slate-700 shadow-xl p-2 space-y-1 text-xs ${
                        isOwn ? 'self-end' : 'self-start'
                      }`}
                    >
                      <div className="flex items-center justify-between px-1 py-1 border-b border-slate-100 dark:border-slate-800">
                        {['👍', '❤️', '😂', '😮', '😢', '🙏'].map((em) => (
                          <button
                            key={em}
                            onClick={() => {
                              toggleMessageReaction(conv.id, m, myProfile.uid, em);
                              setActiveMsgMenu(null);
                            }}
                            className="p-1 hover:scale-125 transition-transform text-sm"
                          >
                            {em}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => {
                          setReplyTo(m);
                          setActiveMsgMenu(null);
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-left"
                      >
                        <Reply className="w-3.5 h-3.5" /> Balas
                      </button>
                      <button
                        onClick={() => {
                          setForwardMsgs([m]);
                          setActiveMsgMenu(null);
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-left"
                      >
                        <Forward className="w-3.5 h-3.5" /> Teruskan
                      </button>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(displayBody);
                          showToast('Pesan disalin', 'info');
                          setActiveMsgMenu(null);
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-left"
                      >
                        <Copy className="w-3.5 h-3.5" /> Salin
                      </button>
                      <button
                        onClick={() => {
                          toggleStarMessage(conv.id, m, myProfile.uid);
                          setActiveMsgMenu(null);
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-left"
                      >
                        <Star className="w-3.5 h-3.5" /> {isStarred ? 'Hapus Bintang' : 'Bintangi Pesan'}
                      </button>
                      <button
                        onClick={() => {
                          setSelectMode(true);
                          setSelectedIds([m.id]);
                          setActiveMsgMenu(null);
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-left"
                      >
                        <MoreVertical className="w-3.5 h-3.5" /> Pilih Beberapa
                      </button>
                      {isOwn && m.type === 'text' && (
                        <button
                          onClick={() => {
                            setEditingMsg(m);
                            setInputText(displayBody);
                            setActiveMsgMenu(null);
                          }}
                          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-left"
                        >
                          <Edit3 className="w-3.5 h-3.5" /> Edit Pesan
                        </button>
                      )}
                      <button
                        onClick={() => {
                          deleteMessageForMe(conv.id, m.id, myProfile.uid);
                          setActiveMsgMenu(null);
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 text-left"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Hapus untuk Saya
                      </button>
                      {isOwn && (
                        <button
                          onClick={() => {
                            deleteMessageForAll(conv.id, m.id);
                            setActiveMsgMenu(null);
                          }}
                          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 text-left"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Hapus untuk Semua
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
              </React.Fragment>
            );
          })
        )}
        <div ref={messagesEndRef} />

        {showScrollBottom && (
          <button
            type="button"
            onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
            className="sticky bottom-3 left-full ml-auto w-10 h-10 rounded-full bg-white dark:bg-[#1A242D] border border-slate-200 dark:border-slate-700 shadow-lg flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            aria-label="Gulir ke bawah"
          >
            <ChevronDown className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Composer Area */}
      <div className="bg-white dark:bg-[#111820] border-t border-slate-200 dark:border-slate-800 p-2.5 sm:p-3 pb-safe relative">
        {/* @mention suggestions */}
        {mentionSuggestions.length > 0 && (
          <div className="mb-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1A242D] shadow-lg divide-y divide-slate-100 dark:divide-slate-800 max-w-xs">
            {mentionSuggestions.map((u) => (
              <button
                key={u.uid}
                type="button"
                onClick={() => {
                  setInputText(inputText.replace(/@[a-z0-9_]*$/i, `@${u.username} `));
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-800 text-left"
              >
                <Avatar name={u.displayName} src={u.photoURL} size="xs" />
                <span className="font-semibold">{u.displayName}</span>
                <span className="text-slate-400">@{u.username}</span>
              </button>
            ))}
          </div>
        )}

        {/* Reply / Edit Banner */}
        {(replyTo || editingMsg) && (
          <div className="mb-2 flex items-center justify-between gap-3 rounded-xl bg-slate-100 dark:bg-slate-800/80 px-3 py-2 text-xs">
            <div className="min-w-0">
              <div className="font-semibold text-emerald-600 dark:text-emerald-400">
                {editingMsg ? 'Mengedit pesan' : `Membalas ${replyTo?.senderName}`}
              </div>
              <div className="text-slate-600 dark:text-slate-300 truncate">
                {editingMsg
                  ? decryptedMap[editingMsg.id] || editingMsg.text
                  : decryptedMap[replyTo!.id] || replyTo?.text || `[${replyTo?.type}]`}
              </div>
            </div>
            <button
              onClick={() => {
                setReplyTo(null);
                setEditingMsg(null);
                if (editingMsg) setInputText('');
              }}
              className="p-1 text-slate-400 hover:text-slate-700"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Emoji / Sticker / GIF Tray */}
        {showMediaTray && (
          <div className="mb-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex gap-1">
                {(['emoji', 'sticker', 'gif'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setShowMediaTray(t)}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold capitalize ${
                      showMediaTray === t
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {t === 'emoji' ? 'Emoji' : t === 'sticker' ? 'Stiker' : 'GIF'}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setShowMediaTray(null)}
                className="p-1 text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {showMediaTray === 'emoji' && (
              <div className="grid grid-cols-10 gap-1">
                {EMOJI_LIST.map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => setInputText((prev) => prev + em)}
                    className="h-9 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-lg"
                  >
                    {em}
                  </button>
                ))}
              </div>
            )}

            {showMediaTray === 'sticker' && (
              <div className="grid grid-cols-3 gap-2">
                {STICKER_PACK.map((stk) => (
                  <button
                    key={stk.id}
                    type="button"
                    onClick={() => handleSendSticker(stk)}
                    className="rounded-xl p-2.5 text-white text-center hover:opacity-90 transition-opacity"
                    style={{ backgroundColor: stk.bg }}
                  >
                    <div className="text-2xl">{stk.emoji}</div>
                    <div className="text-[11px] font-bold mt-0.5">{stk.label}</div>
                  </button>
                ))}
              </div>
            )}

            {showMediaTray === 'gif' && (
              <div className="grid grid-cols-2 gap-2">
                {GIF_CARDS.map((gif) => (
                  <button
                    key={gif.id}
                    type="button"
                    onClick={() => handleSendGif(gif)}
                    className={`rounded-xl p-3 text-white bg-gradient-to-br ${gif.color} text-center`}
                  >
                    <div className="text-xl">{gif.badge}</div>
                    <div className="text-[11px] font-bold mt-1">{gif.title}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Attachment Menu */}
        {showAttachMenu && (
          <div className="mb-2 grid grid-cols-3 sm:grid-cols-6 gap-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-3 text-xs">
            <label className="flex flex-col items-center gap-1 p-2 rounded-xl hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer">
              <ImageIcon className="w-5 h-5 text-emerald-600" />
              <span>Foto</span>
              <input type="file" accept="image/*" onChange={(e) => handleFileUploadAndSend(e, 'image')} className="hidden" />
            </label>
            <label className="flex flex-col items-center gap-1 p-2 rounded-xl hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer">
              <Camera className="w-5 h-5 text-teal-600" />
              <span>Kamera</span>
              <input type="file" accept="image/*" capture="environment" onChange={(e) => handleFileUploadAndSend(e, 'image')} className="hidden" />
            </label>
            <label className="flex flex-col items-center gap-1 p-2 rounded-xl hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer">
              <Video className="w-5 h-5 text-indigo-600" />
              <span>Video</span>
              <input type="file" accept="video/mp4,video/webm" onChange={(e) => handleFileUploadAndSend(e, 'video')} className="hidden" />
            </label>
            <label className="flex flex-col items-center gap-1 p-2 rounded-xl hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer">
              <FileText className="w-5 h-5 text-amber-600" />
              <span>Dokumen</span>
              <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.zip" onChange={(e) => handleFileUploadAndSend(e, 'document')} className="hidden" />
            </label>
            <label className="flex flex-col items-center gap-1 p-2 rounded-xl hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer">
              <Music className="w-5 h-5 text-rose-600" />
              <span>Audio</span>
              <input type="file" accept="audio/*" onChange={(e) => handleFileUploadAndSend(e, 'audio')} className="hidden" />
            </label>
            <button
              type="button"
              onClick={() => {
                setShowAttachMenu(false);
                setShowPollModal(true);
              }}
              className="flex flex-col items-center gap-1 p-2 rounded-xl hover:bg-slate-200/70 dark:hover:bg-slate-800"
            >
              <BarChart2 className="w-5 h-5 text-cyan-600" />
              <span>Polling</span>
            </button>
          </div>
        )}

        {cannotSendInGroup ? (
          <div className="py-2.5 text-center text-xs text-slate-500 dark:text-slate-400">
            Hanya admin grup yang dapat mengirim pesan di grup ini.
          </div>
        ) : isBlocked ? (
          <div className="py-2.5 text-center text-xs text-rose-600 dark:text-rose-400">
            Anda telah memblokir pengguna ini.
          </div>
        ) : recording ? (
          <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900">
            <div className="flex items-center gap-2 text-rose-600 text-sm font-semibold">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-600 animate-pulse" />
              <span>Merekam suara...</span>
              <span className="font-mono-num">{recordSeconds}d</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={cancelVoiceRecording}
                className="px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-semibold hover:bg-slate-100"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={stopVoiceRecording}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold"
              >
                <Square className="w-3.5 h-3.5" /> Kirim Suara
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSendText} className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => setShowMediaTray(showMediaTray ? null : 'emoji')}
              className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Emoji, Stiker, GIF"
            >
              <Smile className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => setShowAttachMenu(!showAttachMenu)}
              className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Lampirkan media"
            >
              <Paperclip className="w-5 h-5" />
            </button>

            <input
              type="text"
              value={inputText}
              onChange={(e) => handleInputChange(e.target.value)}
              placeholder={isGroup ? 'Tulis pesan (ketik @ untuk sebut anggota)...' : 'Ketik pesan...'}
              className="flex-1 px-4 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />

            {inputText.trim() ? (
              <button
                type="submit"
                className="min-w-[44px] min-h-[44px] rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center transition-colors shrink-0"
                aria-label="Kirim pesan"
              >
                <Send className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={startVoiceRecording}
                className="min-w-[44px] min-h-[44px] rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-emerald-600 hover:text-white text-slate-700 dark:text-slate-200 flex items-center justify-center transition-colors shrink-0"
                aria-label="Rekam pesan suara"
              >
                <Mic className="w-4 h-4" />
              </button>
            )}
          </form>
        )}
      </div>

      {/* Modal Buat Polling */}
      {showPollModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleCreatePoll}
            className="w-full max-w-md rounded-3xl bg-white dark:bg-[#111820] border border-slate-200 dark:border-slate-800 p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Buat Jajak Pendapat (Polling)
              </h3>
              <button type="button" onClick={() => setShowPollModal(false)} className="p-1 text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="text"
              required
              value={pollQuestion}
              onChange={(e) => setPollQuestion(e.target.value)}
              placeholder="Ajukan pertanyaan polling..."
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
            />
            <div className="space-y-2">
              {pollOptions.map((opt, idx) => (
                <input
                  key={idx}
                  type="text"
                  value={opt}
                  onChange={(e) => {
                    const copy = [...pollOptions];
                    copy[idx] = e.target.value;
                    setPollOptions(copy);
                  }}
                  placeholder={`Opsi ${idx + 1}`}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
                />
              ))}
              {pollOptions.length < 6 && (
                <button
                  type="button"
                  onClick={() => setPollOptions([...pollOptions, ''])}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600"
                >
                  <Plus className="w-3.5 h-3.5" /> Tambah Opsi
                </button>
              )}
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={pollMultiple}
                onChange={(e) => setPollMultiple(e.target.checked)}
              />
              Izinkan pilihan ganda
            </label>
            <button
              type="submit"
              className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
            >
              Kirim Polling
            </button>
          </form>
        </div>
      )}

      {/* Modal Teruskan Pesan */}
      {forwardMsgs && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-[#111820] border border-slate-200 dark:border-slate-800 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Teruskan ke Percakapan
              </h3>
              <button onClick={() => setForwardMsgs(null)} className="p-1 text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {allConversations.map((c) => {
                const otherUid = c.memberUids.find((u) => u !== myProfile.uid);
                const label =
                  c.type === 'group'
                    ? c.title || 'Grup'
                    : (otherUid && membersProfiles[otherUid]?.displayName) || 'Percakapan';
                return (
                  <button
                    key={c.id}
                    onClick={() => handleForwardToConv(c)}
                    className="w-full flex items-center justify-between py-3 px-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-sm font-medium text-left"
                  >
                    <span className="truncate">{label}</span>
                    <Forward className="w-4 h-4 text-emerald-600 shrink-0" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Image Lightbox */}
      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
        >
          <div className="absolute top-4 right-4 flex items-center gap-2">
            <a
              href={lightboxUrl}
              download
              onClick={(e) => e.stopPropagation()}
              className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white"
              aria-label="Unduh gambar"
            >
              <Download className="w-5 h-5" />
            </a>
            <button
              onClick={() => setLightboxUrl(null)}
              className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white"
              aria-label="Tutup pratinjau"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <img src={lightboxUrl} alt="Pratinjau" className="max-h-[90vh] max-w-full rounded-2xl object-contain" />
        </div>
      )}
    </div>
  );
};
