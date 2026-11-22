import React, { useEffect, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  Image as ImageIcon,
  Plus,
  Send,
  Shield,
  Trash2,
  Type,
  Video,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  createStatusPost,
  getOrCreatePrivateConversation,
  recordStatusView,
  sendMessage,
  uploadMediaFile,
} from '../lib/chatService';
import type { Contact, StatusPost, StatusView as StatusViewDoc, UserProfile } from '../types/chat';
import { Avatar } from './PKLogo';
import { useToast } from './ToastProvider';

interface StatusViewProps {
  myProfile: UserProfile;
  statuses: StatusPost[];
  contacts: Contact[];
  pendingCameraMedia?: { url: string; type: 'image' | 'video' } | null;
  onConsumePendingMedia?: () => void;
  onOpenChat: (convId: string) => void;
}

const BG_COLORS = ['#059669', '#0F766E', '#1E293B', '#B45309', '#BE123C', '#4338CA'];
const QUICK_EMOJIS = ['😊', '🔥', '✨', '🎉', '💚', '☕', '🚀', '🌙'];

export const StatusView: React.FC<StatusViewProps> = ({
  myProfile,
  statuses,
  contacts,
  pendingCameraMedia,
  onConsumePendingMedia,
  onOpenChat,
}) => {
  const { showToast } = useToast();
  const [showCreator, setShowCreator] = useState(false);
  const [creatorType, setCreatorType] = useState<'text' | 'image' | 'video'>('text');
  const [caption, setCaption] = useState('');
  const [bgColor, setBgColor] = useState(BG_COLORS[0]);
  const [emoji, setEmoji] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [privacy, setPrivacy] = useState<'all' | 'contacts' | 'except'>('all');
  const [hiddenUids, setHiddenUids] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const [playlist, setPlaylist] = useState<StatusPost[]>([]);
  const [playlistIndex, setPlaylistIndex] = useState(0);
  const [viewers, setViewers] = useState<StatusViewDoc[]>([]);
  const [showViewersList, setShowViewersList] = useState(false);
  const [replyText, setReplyText] = useState('');

  const viewingStatus = playlist[playlistIndex] || null;

  useEffect(() => {
    if (pendingCameraMedia) {
      setCreatorType(pendingCameraMedia.type);
      setMediaUrl(pendingCameraMedia.url);
      setShowCreator(true);
      onConsumePendingMedia?.();
    }
  }, [pendingCameraMedia]);

  const now = Date.now();
  const activeStatuses = statuses.filter((s) => s.expiresAt > now);
  const myStatuses = activeStatuses.filter((s) => s.authorUid === myProfile.uid);
  const otherStatuses = activeStatuses.filter((s) => s.authorUid !== myProfile.uid);

  // Group other statuses by author
  const groupedOthers = otherStatuses.reduce<Record<string, StatusPost[]>>((acc, s) => {
    acc[s.authorUid] = acc[s.authorUid] || [];
    acc[s.authorUid].push(s);
    return acc;
  }, {});

  useEffect(() => {
    if (!viewingStatus) {
      setViewers([]);
      setShowViewersList(false);
      return;
    }
    recordStatusView(viewingStatus, myProfile);

    if (viewingStatus.authorUid === myProfile.uid) {
      const q = query(
        collection(db, 'statuses', viewingStatus.id, 'views'),
        where('authorUid', '==', myProfile.uid)
      );
      const unsub = onSnapshot(
        q,
        (snap) => {
          const list = snap.docs
            .map((d) => d.data() as StatusViewDoc)
            .sort((a, b) => (b.viewedAt?.toMillis?.() ?? 0) - (a.viewedAt?.toMillis?.() ?? 0));
          setViewers(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, `statuses/${viewingStatus.id}/views`)
      );
      return () => unsub();
    }
  }, [viewingStatus?.id]);

  const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSubmitting(true);
    try {
      const res = await uploadMediaFile(file);
      setMediaUrl(res.url);
      setCreatorType(file.type.startsWith('video/') ? 'video' : 'image');
      showToast('Media status siap dipublikasikan', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Gagal mengunggah media status', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creatorType === 'text' && !caption.trim()) {
      showToast('Tulis teks status terlebih dahulu', 'error');
      return;
    }
    if ((creatorType === 'image' || creatorType === 'video') && !mediaUrl) {
      showToast('Unggah foto atau video terlebih dahulu', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await createStatusPost({
        author: myProfile,
        type: creatorType,
        caption: caption.trim(),
        mediaUrl,
        bgColor,
        emoji,
        privacy,
        contactUids: contacts.map((c) => c.contactUid),
        hiddenFromUids: hiddenUids,
      });
      showToast('Status dipublikasikan (berlaku 24 jam)', 'success');
      setShowCreator(false);
      setCaption('');
      setMediaUrl('');
      setEmoji('');
    } catch (err: any) {
      showToast(err?.message || 'Gagal membuat status', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteStatus = async (statusId: string) => {
    try {
      await deleteDoc(doc(db, 'statuses', statusId));
      const remaining = playlist.filter((p) => p.id !== statusId);
      setPlaylist(remaining);
      setPlaylistIndex(0);
      showToast('Status dihapus', 'info');
    } catch {
      showToast('Gagal menghapus status', 'error');
    }
  };

  const handleReplyStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!viewingStatus || !replyText.trim()) return;
    try {
      const peerProfile: UserProfile = {
        uid: viewingStatus.authorUid,
        username: viewingStatus.authorUsername || 'pengguna',
        displayName: viewingStatus.authorName,
        photoURL: viewingStatus.authorPhoto,
        isOnline: false,
        showOnlineStatus: true,
        showLastSeen: true,
        showProfilePhoto: true,
      };
      const convId = await getOrCreatePrivateConversation(myProfile, peerProfile);
      await sendMessage({
        conv: {
          id: convId,
          type: 'private',
          memberUids: [myProfile.uid, peerProfile.uid],
          adminUids: [myProfile.uid, peerProfile.uid],
          createdBy: myProfile.uid,
          disappearingSeconds: 0,
          onlyAdminsCanSend: false,
          onlyAdminsCanEditInfo: false,
        },
        sender: myProfile,
        peerProfile,
        type: 'text',
        text: `Membalas status "${viewingStatus.caption || viewingStatus.type}": ${replyText.trim()}`,
      });
      setReplyText('');
      setPlaylist([]);
      onOpenChat(convId);
      showToast('Balasan status terkirim ke chat pribadi', 'success');
    } catch {
      showToast('Gagal mengirim balasan status', 'error');
    }
  };

  const formatRemaining = (expiresAt: number) => {
    const diffMs = Math.max(0, expiresAt - Date.now());
    const mins = Math.ceil(diffMs / 60000);
    if (mins < 60) return `Tersisa ${mins} mnt`;
    const hrs = Math.ceil(diffMs / 3600000);
    return `Tersisa ${hrs} jam`;
  };

  const openPlaylist = (items: StatusPost[], startIdx = 0) => {
    setPlaylist(items);
    setPlaylistIndex(startIdx);
    setShowViewersList(false);
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-white dark:bg-[#111820]">
      <div className="p-4 sm:p-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
            Status &amp; Update
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Bagikan foto, video, atau teks yang otomatis hilang setelah 24 jam.
          </p>
        </div>
        <button
          onClick={() => setShowCreator(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          Buat Status
        </button>
      </div>

      <div className="p-4 sm:p-6 space-y-6">
        {/* Status Saya */}
        <div>
          <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-3">
            Status Saya
          </h3>
          {myStatuses.length === 0 ? (
            <button
              onClick={() => setShowCreator(true)}
              className="w-full flex items-center gap-3.5 p-3.5 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 hover:border-emerald-500 transition-colors text-left"
            >
              <div className="relative">
                <Avatar name={myProfile.displayName} src={myProfile.photoURL} size="md" />
                <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center ring-2 ring-white dark:ring-[#111820]">
                  <Plus className="w-3 h-3" />
                </span>
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-white">
                  Tambahkan Status Baru
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Ketuk untuk unggah foto, video, atau status teks 24 jam
                </div>
              </div>
            </button>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {myStatuses.map((s, idx) => (
                <button
                  key={s.id}
                  onClick={() => openPlaylist(myStatuses, idx)}
                  className="flex items-center gap-3 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors text-left"
                >
                  <div className="p-0.5 rounded-full ring-2 ring-emerald-500">
                    <Avatar name={s.authorName} src={s.authorPhoto} size="md" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                      {s.caption || (s.type === 'image' ? 'Status Foto' : 'Status Video')}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      <span className="inline-flex items-center gap-1">
                        <Eye className="w-3 h-3" /> {s.viewerCount}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{formatRemaining(s.expiresAt)}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Pembaruan Terbaru */}
        <div>
          <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-3">
            Pembaruan Terbaru
          </h3>
          {Object.keys(groupedOthers).length === 0 ? (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-center">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Belum ada status aktif dari pengguna lain saat ini.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {Object.entries(groupedOthers).map(([uid, items]) => {
                const latest = items[0];
                return (
                  <button
                    key={uid}
                    onClick={() => openPlaylist(items, 0)}
                    className="flex items-center gap-3 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors text-left"
                  >
                    <div className="p-0.5 rounded-full ring-2 ring-emerald-500">
                      <Avatar name={latest.authorName} src={latest.authorPhoto} size="md" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        {latest.authorName}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {items.length} pembaruan · {formatRemaining(latest.expiresAt)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Modal Buat Status */}
      {showCreator && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handlePublish}
            className="w-full max-w-md rounded-3xl bg-white dark:bg-[#111820] border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-xl max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Buat Status Baru
              </h3>
              <button
                type="button"
                onClick={() => setShowCreator(false)}
                className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setCreatorType('text')}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 ${
                  creatorType === 'text'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <Type className="w-3.5 h-3.5" /> Teks
              </button>
              <label className="flex-1 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-900 cursor-pointer">
                <ImageIcon className="w-3.5 h-3.5" /> Foto
                <input type="file" accept="image/*" onChange={handleMediaUpload} className="hidden" />
              </label>
              <label className="flex-1 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-900 cursor-pointer">
                <Video className="w-3.5 h-3.5" /> Video
                <input type="file" accept="video/mp4,video/webm" onChange={handleMediaUpload} className="hidden" />
              </label>
            </div>

            {creatorType === 'text' ? (
              <div
                className="rounded-2xl p-6 min-h-[180px] flex flex-col items-center justify-center text-center text-white transition-colors"
                style={{ backgroundColor: bgColor }}
              >
                {emoji && <div className="text-3xl mb-2">{emoji}</div>}
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Ketik pemikiran Anda..."
                  maxLength={500}
                  rows={3}
                  className="w-full bg-transparent text-center text-lg font-display font-semibold placeholder:text-white/60 focus:outline-none resize-none"
                />
              </div>
            ) : (
              <div className="space-y-3">
                {mediaUrl ? (
                  <div className="rounded-2xl overflow-hidden bg-slate-900 max-h-60 flex items-center justify-center">
                    {creatorType === 'image' ? (
                      <img src={mediaUrl} alt="Preview status" className="max-h-60 object-contain" />
                    ) : (
                      <video src={mediaUrl} controls className="max-h-60 w-full" />
                    )}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center text-xs text-slate-500">
                    Pilih foto atau video dari perangkat Anda
                  </div>
                )}
                <input
                  type="text"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Tambahkan keterangan (caption)..."
                  maxLength={500}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            )}

            {creatorType === 'text' && (
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  {BG_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setBgColor(c)}
                      className={`w-6 h-6 rounded-full transition-transform ${
                        bgColor === c ? 'scale-110 ring-2 ring-offset-2 ring-emerald-500' : ''
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  {QUICK_EMOJIS.slice(0, 5).map((em) => (
                    <button
                      key={em}
                      type="button"
                      onClick={() => setEmoji(emoji === em ? '' : em)}
                      className={`w-7 h-7 rounded-lg text-sm flex items-center justify-center ${
                        emoji === em ? 'bg-emerald-100 dark:bg-emerald-900' : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      {em}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-1">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                <Shield className="w-3.5 h-3.5 text-emerald-600" />
                Privasi Status
              </label>
              <select
                value={privacy}
                onChange={(e) => setPrivacy(e.target.value as any)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
              >
                <option value="all">Semua Pengguna PK Chat</option>
                <option value="contacts">Hanya Kontak Saya</option>
                <option value="except">Kontak Saya Kecuali...</option>
              </select>
              {privacy === 'except' && contacts.length > 0 && (
                <div className="mt-2 max-h-28 overflow-y-auto space-y-1 rounded-xl border border-slate-200 dark:border-slate-800 p-2">
                  {contacts.map((c) => (
                    <label key={c.contactUid} className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={hiddenUids.includes(c.contactUid)}
                        onChange={(e) => {
                          if (e.target.checked) setHiddenUids([...hiddenUids, c.contactUid]);
                          else setHiddenUids(hiddenUids.filter((u) => u !== c.contactUid));
                        }}
                      />
                      Sembunyikan dari {c.aliasName} (@{c.username})
                    </label>
                  ))}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
            >
              {submitting ? 'Mempublikasikan...' : 'Bagikan Status Sekarang'}
            </button>
          </form>
        </div>
      )}

      {/* Viewer Modal */}
      {viewingStatus && (
        <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col items-center justify-between p-4 text-white">
          <div className="w-full max-w-lg space-y-2.5 pt-1">
            {/* Segmented Progress Bars */}
            {playlist.length > 1 && (
              <div className="flex gap-1.5">
                {playlist.map((item, i) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setPlaylistIndex(i)}
                    className="flex-1 h-1 rounded-full overflow-hidden bg-white/25"
                    aria-label={`Status ${i + 1}`}
                  >
                    <div
                      className={`h-full transition-all ${
                        i < playlistIndex
                          ? 'w-full bg-emerald-400'
                          : i === playlistIndex
                          ? 'w-full bg-white'
                          : 'w-0'
                      }`}
                    />
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Avatar name={viewingStatus.authorName} src={viewingStatus.authorPhoto} size="sm" />
                <div>
                  <div className="text-sm font-semibold">{viewingStatus.authorName}</div>
                  <div className="text-xs text-slate-400">{formatRemaining(viewingStatus.expiresAt)}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {viewingStatus.authorUid === myProfile.uid && (
                  <button
                    onClick={() => handleDeleteStatus(viewingStatus.id)}
                    className="p-2 rounded-xl bg-white/10 hover:bg-rose-600 transition-colors"
                    aria-label="Hapus status"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => setPlaylist([])}
                  className="p-2 rounded-xl bg-white/10 hover:bg-white/20 transition-colors"
                  aria-label="Tutup status"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          <div
            className="w-full max-w-lg flex-1 my-4 rounded-3xl overflow-hidden flex flex-col items-center justify-center p-6 text-center relative"
            style={{ backgroundColor: viewingStatus.type === 'text' ? viewingStatus.bgColor || '#059669' : '#0f172a' }}
          >
            {playlistIndex > 0 && (
              <button
                type="button"
                onClick={() => setPlaylistIndex((i) => Math.max(0, i - 1))}
                className="absolute left-3 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/40 hover:bg-black/60 text-white"
                aria-label="Status sebelumnya"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            {playlistIndex < playlist.length - 1 && (
              <button
                type="button"
                onClick={() => setPlaylistIndex((i) => Math.min(playlist.length - 1, i + 1))}
                className="absolute right-3 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/40 hover:bg-black/60 text-white"
                aria-label="Status berikutnya"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            )}

            {viewingStatus.type === 'text' ? (
              <>
                {viewingStatus.emoji && <div className="text-4xl mb-3">{viewingStatus.emoji}</div>}
                <p className="font-display text-2xl font-bold leading-snug break-words max-w-md">
                  {viewingStatus.caption}
                </p>
              </>
            ) : viewingStatus.type === 'image' ? (
              <img src={viewingStatus.mediaUrl} alt="Status" className="max-h-full max-w-full object-contain rounded-2xl" />
            ) : (
              <video src={viewingStatus.mediaUrl} controls autoPlay className="max-h-full max-w-full rounded-2xl" />
            )}

            {viewingStatus.type !== 'text' && viewingStatus.caption && (
              <div className="absolute bottom-4 inset-x-4 rounded-xl bg-black/70 backdrop-blur-sm px-4 py-2.5 text-sm">
                {viewingStatus.caption}
              </div>
            )}
          </div>

          <div className="w-full max-w-lg pb-2">
            {viewingStatus.authorUid === myProfile.uid ? (
              <div>
                <button
                  onClick={() => setShowViewersList(!showViewersList)}
                  className="w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/15 flex items-center justify-center gap-2 text-sm font-medium"
                >
                  <Eye className="w-4 h-4" />
                  Dilihat oleh {viewers.length || viewingStatus.viewerCount} orang
                </button>
                {showViewersList && (
                  <div className="mt-2 max-h-40 overflow-y-auto rounded-2xl bg-slate-900 border border-slate-800 divide-y divide-slate-800">
                    {viewers.length === 0 ? (
                      <div className="p-3 text-xs text-slate-400 text-center">Belum ada penonton</div>
                    ) : (
                      viewers.map((v) => (
                        <div key={v.viewerUid} className="flex items-center gap-2.5 p-2.5">
                          <Avatar name={v.viewerName} src={v.viewerPhoto} size="xs" />
                          <span className="text-xs font-medium">{v.viewerName}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ) : (
              <form onSubmit={handleReplyStatus} className="flex items-center gap-2">
                <input
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder={`Balas status ${viewingStatus.authorName}...`}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-white/10 border border-white/15 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <button
                  type="submit"
                  className="p-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white"
                  aria-label="Kirim balasan"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
