import React, { useEffect, useState } from 'react';
import {
  arrayRemove,
  arrayUnion,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  Archive,
  BellOff,
  Camera,
  Check,
  Clock,
  Download,
  FileText,
  Flag,
  Lock,
  LogOut,
  Pin,
  ShieldAlert,
  Star,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { db } from '../lib/firebase';
import { computeSafetyCode, decryptMessageText } from '../lib/e2ee';
import { uploadMediaFile } from '../lib/chatService';
import type {
  Contact,
  Conversation,
  ConversationMember,
  Message,
  UserProfile,
} from '../types/chat';
import { Avatar } from './PKLogo';
import { useToast } from './ToastProvider';

interface ChatInfoDrawerProps {
  conv: Conversation;
  myProfile: UserProfile;
  peerProfile?: UserProfile | null;
  myMemberState?: ConversationMember;
  membersProfiles: Record<string, UserProfile>;
  messages: Message[];
  contacts: Contact[];
  isBlocked: boolean;
  onClose: () => void;
  onLeaveOrDelete: () => void;
}

export const ChatInfoDrawer: React.FC<ChatInfoDrawerProps> = ({
  conv,
  myProfile,
  peerProfile,
  myMemberState,
  membersProfiles,
  messages,
  contacts,
  isBlocked,
  onClose,
  onLeaveOrDelete,
}) => {
  const { showToast } = useToast();
  const [safetyCode, setSafetyCode] = useState('');
  const [editingGroup, setEditingGroup] = useState(false);
  const [groupTitle, setGroupTitle] = useState(conv.title || '');
  const [groupDesc, setGroupDesc] = useState(conv.description || '');
  const [showAddMember, setShowAddMember] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState('Spam atau Penipuan');
  const [reportDetails, setReportDetails] = useState('');
  const [decryptedStarred, setDecryptedStarred] = useState<Record<string, string>>({});

  const isGroup = conv.type === 'group';
  const isAdmin = conv.adminUids?.includes(myProfile.uid);
  const canEditGroupInfo = isGroup && (isAdmin || !conv.onlyAdminsCanEditInfo);

  useEffect(() => {
    setGroupTitle(conv.title || '');
    setGroupDesc(conv.description || '');
  }, [conv.id, conv.title, conv.description]);

  useEffect(() => {
    if (!isGroup && peerProfile) {
      computeSafetyCode(myProfile.e2eePublicKey, peerProfile.e2eePublicKey).then(setSafetyCode);
    }
  }, [isGroup, myProfile.e2eePublicKey, peerProfile?.e2eePublicKey]);

  const starredMessages = messages.filter((m) => m.starredByUids?.includes(myProfile.uid));
  const mediaMessages = messages.filter((m) => m.type === 'image' || m.type === 'video');
  const docAudioMessages = messages.filter((m) => m.type === 'document' || m.type === 'audio' || m.type === 'voice');

  useEffect(() => {
    if (isGroup || !peerProfile?.e2eePublicKey) return;
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      for (const m of starredMessages) {
        if (m.encryptedPayload && m.iv && !decryptedStarred[m.id]) {
          const plain = await decryptMessageText(myProfile.uid, peerProfile.e2eePublicKey, m.encryptedPayload, m.iv);
          if (plain) next[m.id] = plain;
        }
      }
      if (!cancelled && Object.keys(next).length > 0) {
        setDecryptedStarred((prev) => ({ ...prev, ...next }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [starredMessages.length, isGroup, peerProfile?.e2eePublicKey, myProfile.uid]);

  const handleToggleMemberPref = async (field: 'pinned' | 'archived' | 'muted') => {
    const ref = doc(db, 'conversations', conv.id, 'members', myProfile.uid);
    try {
      if (field === 'pinned') {
        await updateDoc(ref, { pinned: !myMemberState?.pinned });
        showToast(myMemberState?.pinned ? 'Sematkan dilepas' : 'Chat disematkan', 'info');
      } else if (field === 'archived') {
        await updateDoc(ref, { archived: !myMemberState?.archived });
        showToast(myMemberState?.archived ? 'Chat dikeluarkan dari arsip' : 'Chat diarsipkan', 'info');
      } else {
        const isMuted = (myMemberState?.mutedUntil || 0) > Date.now();
        await updateDoc(ref, { mutedUntil: isMuted ? 0 : Date.now() + 7 * 24 * 3600 * 1000 });
        showToast(isMuted ? 'Notifikasi diaktifkan' : 'Chat dibisukan 7 hari', 'info');
      }
    } catch {
      showToast('Gagal mengubah preferensi chat', 'error');
    }
  };

  const handleDisappearingChange = async (seconds: number) => {
    try {
      await updateDoc(doc(db, 'conversations', conv.id), {
        disappearingSeconds: seconds,
        updatedAt: serverTimestamp(),
      });
      showToast(
        seconds === 0
          ? 'Pesan sementara dimatikan'
          : `Pesan sementara diatur ke ${seconds === 86400 ? '24 Jam' : seconds === 604800 ? '7 Hari' : '90 Hari'}`,
        'success'
      );
    } catch {
      showToast('Hanya admin yang dapat mengubah pengaturan ini', 'error');
    }
  };

  const handleSaveGroupInfo = async () => {
    try {
      await updateDoc(doc(db, 'conversations', conv.id), {
        title: groupTitle.trim().slice(0, 100),
        description: groupDesc.trim().slice(0, 400),
        updatedAt: serverTimestamp(),
      });
      setEditingGroup(false);
      showToast('Info grup diperbarui', 'success');
    } catch {
      showToast('Gagal memperbarui info grup', 'error');
    }
  };

  const handleGroupPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const up = await uploadMediaFile(file);
      await updateDoc(doc(db, 'conversations', conv.id), {
        photoURL: up.url,
        updatedAt: serverTimestamp(),
      });
      showToast('Foto grup diperbarui', 'success');
    } catch {
      showToast('Gagal mengunggah foto grup', 'error');
    }
  };

  const handleToggleGroupSetting = async (field: 'onlyAdminsCanSend' | 'onlyAdminsCanEditInfo') => {
    try {
      await updateDoc(doc(db, 'conversations', conv.id), {
        [field]: !conv[field],
        updatedAt: serverTimestamp(),
      });
      showToast('Hak akses grup diperbarui', 'success');
    } catch {
      showToast('Gagal memperbarui hak akses grup', 'error');
    }
  };

  const handleAddMember = async (uid: string) => {
    if (conv.memberUids.includes(uid)) return;
    try {
      await updateDoc(doc(db, 'conversations', conv.id), {
        memberUids: arrayUnion(uid),
        updatedAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'conversations', conv.id, 'members', uid), {
        convId: conv.id,
        uid,
        role: 'member',
        pinned: false,
        archived: false,
        mutedUntil: 0,
        unreadCount: 0,
        joinedAt: serverTimestamp(),
      });
      showToast('Anggota ditambahkan ke grup', 'success');
      setShowAddMember(false);
    } catch {
      showToast('Gagal menambahkan anggota', 'error');
    }
  };

  const handlePromoteToggle = async (targetUid: string) => {
    const targetIsAdmin = conv.adminUids.includes(targetUid);
    if (targetIsAdmin && conv.adminUids.length <= 1) {
      showToast('Grup harus memiliki minimal 1 admin', 'error');
      return;
    }
    try {
      await updateDoc(doc(db, 'conversations', conv.id), {
        adminUids: targetIsAdmin ? arrayRemove(targetUid) : arrayUnion(targetUid),
        updatedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'conversations', conv.id, 'members', targetUid), {
        role: targetIsAdmin ? 'member' : 'admin',
      });
      showToast(targetIsAdmin ? 'Hak admin dicabut' : 'Dijadikan admin grup', 'success');
    } catch {
      showToast('Gagal mengubah peran anggota', 'error');
    }
  };

  const handleKickMember = async (targetUid: string) => {
    try {
      await updateDoc(doc(db, 'conversations', conv.id), {
        memberUids: arrayRemove(targetUid),
        adminUids: arrayRemove(targetUid),
        updatedAt: serverTimestamp(),
      });
      await deleteDoc(doc(db, 'conversations', conv.id, 'members', targetUid));
      showToast('Anggota dikeluarkan dari grup', 'info');
    } catch {
      showToast('Gagal mengeluarkan anggota', 'error');
    }
  };

  const handleLeaveGroup = async () => {
    try {
      const remainingMembers = conv.memberUids.filter((u) => u !== myProfile.uid);
      if (remainingMembers.length === 0) {
        await deleteDoc(doc(db, 'conversations', conv.id));
        showToast('Grup dihapus karena tidak ada anggota tersisa', 'info');
        onLeaveOrDelete();
        return;
      }
      const remainingAdmins = conv.adminUids.filter((u) => u !== myProfile.uid);
      const nextAdmins = remainingAdmins.length > 0 ? remainingAdmins : [remainingMembers[0]];
      await updateDoc(doc(db, 'conversations', conv.id), {
        memberUids: remainingMembers,
        adminUids: nextAdmins,
        updatedAt: serverTimestamp(),
      });
      await deleteDoc(doc(db, 'conversations', conv.id, 'members', myProfile.uid));
      showToast('Anda keluar dari grup', 'info');
      onLeaveOrDelete();
    } catch {
      showToast('Gagal keluar dari grup', 'error');
    }
  };

  const handleDeleteGroup = async () => {
    try {
      await deleteDoc(doc(db, 'conversations', conv.id));
      showToast('Grup dihapus permanen', 'info');
      onLeaveOrDelete();
    } catch {
      showToast('Hanya admin yang dapat menghapus grup', 'error');
    }
  };

  const handleBlockToggle = async () => {
    if (!peerProfile) return;
    try {
      if (isBlocked) {
        await deleteDoc(doc(db, 'users', myProfile.uid, 'blocked', peerProfile.uid));
        showToast(`${peerProfile.displayName} dibuka blokirnya`, 'info');
      } else {
        await setDoc(doc(db, 'users', myProfile.uid, 'blocked', peerProfile.uid), {
          ownerUid: myProfile.uid,
          blockedUid: peerProfile.uid,
          reason: 'Diblokir oleh pengguna',
          blockedAt: serverTimestamp(),
        });
        showToast(`${peerProfile.displayName} diblokir`, 'info');
      }
    } catch {
      showToast('Gagal mengubah status blokir', 'error');
    }
  };

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!peerProfile) return;
    const reportId = `rep_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    try {
      await setDoc(doc(db, 'reports', reportId), {
        id: reportId,
        reporterUid: myProfile.uid,
        reportedUid: peerProfile.uid,
        reason: reportReason,
        details: reportDetails.trim().slice(0, 500),
        createdAt: serverTimestamp(),
      });
      setShowReportModal(false);
      setReportDetails('');
      showToast('Laporan dikirim ke tim moderasi PK Chat', 'success');
    } catch {
      showToast('Gagal mengirim laporan', 'error');
    }
  };

  const isMuted = (myMemberState?.mutedUntil || 0) > Date.now();
  const availableContactsToAdd = contacts.filter((c) => !conv.memberUids.includes(c.contactUid));

  return (
    <aside className="w-full lg:w-[340px] shrink-0 border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111820] flex flex-col h-full overflow-y-auto">
      <div className="h-14 px-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
        <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
          {isGroup ? 'Info Grup' : 'Info Kontak'}
        </h3>
        <button
          onClick={onClose}
          className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
          aria-label="Tutup panel info"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-5 space-y-6">
        {/* Header Profile */}
        <div className="flex flex-col items-center text-center">
          <div className="relative">
            <Avatar
              name={isGroup ? conv.title || 'Grup' : peerProfile?.displayName || 'Pengguna'}
              src={isGroup ? conv.photoURL : peerProfile?.showProfilePhoto ? peerProfile?.photoURL : undefined}
              size="xl"
              isGroup={isGroup}
            />
            {canEditGroupInfo && (
              <label className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-emerald-600 text-white flex items-center justify-center cursor-pointer shadow">
                <Camera className="w-3.5 h-3.5" />
                <input type="file" accept="image/*" onChange={handleGroupPhotoUpload} className="hidden" />
              </label>
            )}
          </div>

          {!editingGroup ? (
            <>
              <h4 className="mt-3 font-display text-lg font-bold text-slate-900 dark:text-white">
                {isGroup ? conv.title : peerProfile?.displayName}
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isGroup ? `${conv.memberUids.length} anggota` : `@${peerProfile?.username || ''}`}
              </p>
              <p className="mt-2 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {isGroup ? conv.description || 'Belum ada deskripsi grup.' : peerProfile?.bio || 'Tersedia di PK Chat'}
              </p>
              {canEditGroupInfo && (
                <button
                  onClick={() => setEditingGroup(true)}
                  className="mt-2 text-xs font-semibold text-emerald-600 hover:underline"
                >
                  Edit Info Grup
                </button>
              )}
            </>
          ) : (
            <div className="w-full mt-3 space-y-2.5 text-left">
              <input
                type="text"
                value={groupTitle}
                onChange={(e) => setGroupTitle(e.target.value)}
                placeholder="Nama grup"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
              />
              <textarea
                rows={2}
                value={groupDesc}
                onChange={(e) => setGroupDesc(e.target.value)}
                placeholder="Deskripsi grup"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSaveGroupInfo}
                  className="flex-1 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold flex items-center justify-center gap-1"
                >
                  <Check className="w-3.5 h-3.5" /> Simpan
                </button>
                <button
                  onClick={() => setEditingGroup(false)}
                  className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold"
                >
                  Batal
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Quick Actions: Pin, Mute, Archive */}
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => handleToggleMemberPref('pinned')}
            className={`py-2.5 px-2 rounded-xl border text-xs font-medium flex flex-col items-center gap-1 transition-colors ${
              myMemberState?.pinned
                ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
                : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            <Pin className="w-4 h-4" />
            <span>{myMemberState?.pinned ? 'Disematkan' : 'Sematkan'}</span>
          </button>
          <button
            onClick={() => handleToggleMemberPref('muted')}
            className={`py-2.5 px-2 rounded-xl border text-xs font-medium flex flex-col items-center gap-1 transition-colors ${
              isMuted
                ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
                : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            <BellOff className="w-4 h-4" />
            <span>{isMuted ? 'Dibisukan' : 'Bisukan'}</span>
          </button>
          <button
            onClick={() => handleToggleMemberPref('archived')}
            className={`py-2.5 px-2 rounded-xl border text-xs font-medium flex flex-col items-center gap-1 transition-colors ${
              myMemberState?.archived
                ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
                : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            <Archive className="w-4 h-4" />
            <span>{myMemberState?.archived ? 'Diarsip' : 'Arsipkan'}</span>
          </button>
        </div>

        {/* E2EE & Disappearing Messages */}
        <div className="space-y-3 rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5">
          {!isGroup && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                <Lock className="w-3.5 h-3.5" />
                <span>Enkripsi End-to-End Aktif</span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Kode Keamanan: <span className="font-mono-num text-slate-700 dark:text-slate-300">{safetyCode}</span>
              </p>
            </div>
          )}

          <div className="pt-1">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              <Clock className="w-3.5 h-3.5 text-emerald-600" />
              Pesan Sementara
            </label>
            <select
              value={conv.disappearingSeconds || 0}
              onChange={(e) => handleDisappearingChange(Number(e.target.value))}
              disabled={isGroup && !isAdmin}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs text-slate-900 dark:text-white disabled:opacity-60"
            >
              <option value={0}>Mati</option>
              <option value={86400}>24 Jam</option>
              <option value={604800}>7 Hari</option>
              <option value={7776000}>90 Hari</option>
            </select>
          </div>
        </div>

        {/* Media & Starred */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
            <span>Media Bersama ({mediaMessages.length})</span>
          </div>
          {mediaMessages.length > 0 && (
            <div className="grid grid-cols-3 gap-1.5">
              {mediaMessages.slice(0, 6).map((m) => (
                <a
                  key={m.id}
                  href={m.mediaUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="aspect-square rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800 block"
                >
                  {m.type === 'image' ? (
                    <img src={m.mediaUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <video src={m.mediaUrl} className="w-full h-full object-cover" />
                  )}
                </a>
              ))}
            </div>
          )}

          {docAudioMessages.length > 0 && (
            <div className="pt-1 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                <FileText className="w-3.5 h-3.5 text-emerald-600" />
                Dokumen &amp; Audio ({docAudioMessages.length})
              </div>
              <div className="space-y-1.5 max-h-36 overflow-y-auto">
                {docAudioMessages.slice(0, 6).map((m) => (
                  <a
                    key={m.id}
                    href={m.mediaUrl}
                    download={m.mediaName}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between gap-2 p-2 rounded-xl bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs"
                  >
                    <span className="truncate font-medium text-slate-700 dark:text-slate-300">
                      {m.mediaName || (m.type === 'voice' ? 'Pesan Suara' : 'File')}
                    </span>
                    <Download className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="pt-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
              <Star className="w-3.5 h-3.5 text-amber-500" />
              Pesan Berbintang ({starredMessages.length})
            </div>
            {starredMessages.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">Belum ada pesan berbintang.</p>
            ) : (
              <div className="space-y-1.5 max-h-36 overflow-y-auto">
                {starredMessages.slice(0, 5).map((m) => (
                  <div key={m.id} className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 text-xs text-slate-700 dark:text-slate-300 truncate">
                    <strong>{m.senderName}:</strong> {decryptedStarred[m.id] || m.text || `[${m.type}]`}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Group Controls & Members */}
        {isGroup && (
          <div className="space-y-4">
            {isAdmin && (
              <div className="space-y-2 rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5">
                <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Hak Akses &amp; Privasi Grup
                </div>
                <label className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                  <span>Hanya admin kirim pesan</span>
                  <input
                    type="checkbox"
                    checked={conv.onlyAdminsCanSend}
                    onChange={() => handleToggleGroupSetting('onlyAdminsCanSend')}
                    className="accent-emerald-600"
                  />
                </label>
                <label className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                  <span>Hanya admin edit info grup</span>
                  <input
                    type="checkbox"
                    checked={conv.onlyAdminsCanEditInfo}
                    onChange={() => handleToggleGroupSetting('onlyAdminsCanEditInfo')}
                    className="accent-emerald-600"
                  />
                </label>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                  <Users className="w-3.5 h-3.5" /> Anggota ({conv.memberUids.length})
                </span>
                {isAdmin && (
                  <button
                    onClick={() => setShowAddMember(!showAddMember)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 hover:underline"
                  >
                    <UserPlus className="w-3.5 h-3.5" /> Tambah
                  </button>
                )}
              </div>

              {showAddMember && (
                <div className="mb-3 rounded-xl border border-slate-200 dark:border-slate-800 p-2 space-y-1 max-h-36 overflow-y-auto">
                  {availableContactsToAdd.length === 0 ? (
                    <p className="text-xs text-slate-500 p-1">Semua kontak sudah tergabung.</p>
                  ) : (
                    availableContactsToAdd.map((c) => (
                      <button
                        key={c.contactUid}
                        onClick={() => handleAddMember(c.contactUid)}
                        className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-xs text-left"
                      >
                        <span>{c.aliasName} (@{c.username})</span>
                        <span className="text-emerald-600 font-semibold">+ Tambah</span>
                      </button>
                    ))
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                {conv.memberUids.map((uid) => {
                  const prof = membersProfiles[uid];
                  const memberIsAdmin = conv.adminUids.includes(uid);
                  const name = uid === myProfile.uid ? 'Anda' : prof?.displayName || uid.slice(0, 8);
                  return (
                    <div
                      key={uid}
                      className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/40"
                    >
                      <Avatar name={name} src={prof?.photoURL} size="xs" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                          {name}
                        </div>
                        {memberIsAdmin && (
                          <div className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                            Admin Grup
                          </div>
                        )}
                      </div>
                      {isAdmin && uid !== myProfile.uid && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handlePromoteToggle(uid)}
                            className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[10px] font-semibold text-slate-700 dark:text-slate-300"
                          >
                            {memberIsAdmin ? 'Turunkan' : 'Admin'}
                          </button>
                          <button
                            onClick={() => handleKickMember(uid)}
                            className="p-1 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg"
                            title="Keluarkan anggota"
                          >
                            <UserMinus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <button
                onClick={handleLeaveGroup}
                className="w-full py-2.5 rounded-xl border border-rose-200 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 text-xs font-semibold flex items-center justify-center gap-2 hover:bg-rose-50 dark:hover:bg-rose-950/40"
              >
                <LogOut className="w-4 h-4" /> Keluar dari Grup
              </button>
              {isAdmin && (
                <button
                  onClick={handleDeleteGroup}
                  className="w-full py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold flex items-center justify-center gap-2"
                >
                  <Trash2 className="w-4 h-4" /> Hapus Grup Permanen
                </button>
              )}
            </div>
          </div>
        )}

        {/* Private Chat Safety Actions */}
        {!isGroup && peerProfile && (
          <div className="space-y-2 pt-2">
            <button
              onClick={handleBlockToggle}
              className="w-full py-2.5 rounded-xl border border-rose-200 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 text-xs font-semibold flex items-center justify-center gap-2 hover:bg-rose-50 dark:hover:bg-rose-950/40"
            >
              <ShieldAlert className="w-4 h-4" />
              {isBlocked ? 'Buka Blokir Pengguna' : 'Blokir Pengguna'}
            </button>
            <button
              onClick={() => setShowReportModal(true)}
              className="w-full py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold flex items-center justify-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <Flag className="w-4 h-4" />
              Laporkan Pengguna
            </button>
          </div>
        )}
      </div>

      {showReportModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleSubmitReport}
            className="w-full max-w-sm rounded-3xl bg-white dark:bg-[#111820] border border-slate-200 dark:border-slate-800 p-6 space-y-4"
          >
            <h4 className="font-display text-base font-bold text-slate-900 dark:text-white">
              Laporkan Pengguna
            </h4>
            <select
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
            >
              <option>Spam atau Penipuan</option>
              <option>Pelecehan atau Ancaman</option>
              <option>Akun Palsu / Peniruan</option>
              <option>Konten Tidak Pantas</option>
            </select>
            <textarea
              rows={3}
              value={reportDetails}
              onChange={(e) => setReportDetails(e.target.value)}
              placeholder="Jelaskan detail laporan..."
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                className="flex-1 py-2.5 rounded-xl bg-rose-600 text-white text-xs font-semibold"
              >
                Kirim Laporan
              </button>
              <button
                type="button"
                onClick={() => setShowReportModal(false)}
                className="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold"
              >
                Batal
              </button>
            </div>
          </form>
        </div>
      )}
    </aside>
  );
};
