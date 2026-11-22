import React, { useEffect, useState } from 'react';
import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  Check,
  Globe,
  MessageSquare,
  Plus,
  Search,
  Share2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  createGroupConversation,
  getOrCreatePrivateConversation,
  searchUsersByQuery,
  uploadMediaFile,
} from '../lib/chatService';
import type { Contact, Conversation, UserProfile } from '../types/chat';
import { Avatar } from './PKLogo';
import { useToast } from './ToastProvider';

interface CommunitiesViewProps {
  myProfile: UserProfile;
  contacts: Contact[];
  openCreateGroupSignal?: number;
  onOpenChat: (convId: string) => void;
}

export const CommunitiesView: React.FC<CommunitiesViewProps> = ({
  myProfile,
  contacts,
  openCreateGroupSignal,
  onOpenChat,
}) => {
  const { showToast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [publicGroups, setPublicGroups] = useState<Conversation[]>([]);

  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [groupTitle, setGroupTitle] = useState('');
  const [groupDesc, setGroupDesc] = useState('');
  const [groupPhoto, setGroupPhoto] = useState('');
  const [isPublicGroup, setIsPublicGroup] = useState(true);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (openCreateGroupSignal && openCreateGroupSignal > 0) {
      setShowCreateGroup(true);
    }
  }, [openCreateGroupSignal]);

  useEffect(() => {
    const q = query(collection(db, 'conversations'), where('isPublicGroup', '==', true));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setPublicGroups(snap.docs.map((d) => d.data() as Conversation));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'conversations')
    );
    return () => unsub();
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchTerm.trim()) return;
    setSearching(true);
    try {
      const users = await searchUsersByQuery(searchTerm, myProfile.uid);
      setSearchResults(users);
      if (users.length === 0) {
        showToast('Pengguna tidak ditemukan. Pastikan username atau nomor HP benar.', 'info');
      }
    } catch {
      showToast('Gagal mencari pengguna', 'error');
    } finally {
      setSearching(false);
    }
  };

  const handleAddContact = async (user: UserProfile) => {
    try {
      await setDoc(doc(db, 'users', myProfile.uid, 'contacts', user.uid), {
        ownerUid: myProfile.uid,
        contactUid: user.uid,
        aliasName: user.displayName,
        username: user.username,
        displayName: user.displayName,
        photoURL: user.photoURL || '',
        addedAt: serverTimestamp(),
      });
      showToast(`${user.displayName} ditambahkan ke kontak`, 'success');
    } catch {
      showToast('Gagal menambahkan kontak', 'error');
    }
  };

  const handleRemoveContact = async (contactUid: string) => {
    try {
      await deleteDoc(doc(db, 'users', myProfile.uid, 'contacts', contactUid));
      showToast('Kontak dihapus', 'info');
    } catch {
      showToast('Gagal menghapus kontak', 'error');
    }
  };

  const handleStartPrivateChat = async (peer: UserProfile) => {
    try {
      const convId = await getOrCreatePrivateConversation(myProfile, peer);
      onOpenChat(convId);
    } catch {
      showToast('Gagal membuka percakapan', 'error');
    }
  };

  const handleJoinPublicGroup = async (group: Conversation) => {
    if (group.memberUids.includes(myProfile.uid)) {
      onOpenChat(group.id);
      return;
    }
    try {
      await updateDoc(doc(db, 'conversations', group.id), {
        memberUids: arrayUnion(myProfile.uid),
        updatedAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'conversations', group.id, 'members', myProfile.uid), {
        convId: group.id,
        uid: myProfile.uid,
        role: 'member',
        pinned: false,
        archived: false,
        mutedUntil: 0,
        unreadCount: 0,
        joinedAt: serverTimestamp(),
      });
      showToast(`Bergabung ke grup ${group.title}`, 'success');
      onOpenChat(group.id);
    } catch {
      showToast('Gagal bergabung ke grup', 'error');
    }
  };

  const handleInviteFriend = async () => {
    const inviteUrl = `${window.location.origin}/?u=${myProfile.username}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'Ajak mengobrol di PK Chat',
          text: `Ayo mengobrol dengan saya (@${myProfile.username}) di PK Chat!`,
          url: inviteUrl,
        });
      } else {
        await navigator.clipboard.writeText(inviteUrl);
        showToast('Tautan undangan disalin ke papan klip', 'success');
      }
    } catch {
      await navigator.clipboard.writeText(inviteUrl);
      showToast('Tautan undangan disalin', 'success');
    }
  };

  const handleGroupPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const res = await uploadMediaFile(file);
      setGroupPhoto(res.url);
    } catch {
      showToast('Gagal mengunggah foto grup', 'error');
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupTitle.trim()) {
      showToast('Nama grup wajib diisi', 'error');
      return;
    }
    setCreating(true);
    try {
      const convId = await createGroupConversation({
        myProfile,
        title: groupTitle,
        description: groupDesc,
        memberUids: selectedMembers,
        photoURL: groupPhoto,
        isPublicGroup,
      });
      setShowCreateGroup(false);
      setGroupTitle('');
      setGroupDesc('');
      setGroupPhoto('');
      setSelectedMembers([]);
      showToast('Grup berhasil dibuat!', 'success');
      onOpenChat(convId);
    } catch {
      showToast('Gagal membuat grup', 'error');
    } finally {
      setCreating(false);
    }
  };

  const contactSet = new Set(contacts.map((c) => c.contactUid));

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-white dark:bg-[#111820]">
      <div className="p-4 sm:p-6 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
            Komunitas, Grup &amp; Kontak
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Cari pengguna lewat username/HP, temukan grup publik, atau buat grup baru.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleInviteFriend}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors"
          >
            <Share2 className="w-3.5 h-3.5" />
            Undang Teman
          </button>
          <button
            onClick={() => setShowCreateGroup(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Buat Grup
          </button>
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-8">
        {/* Cari Pengguna */}
        <section>
          <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2.5">
            Cari Pengguna (Username atau Nomor HP)
          </h3>
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Ketik @username atau 0812..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <button
              type="submit"
              disabled={searching}
              className="px-5 py-2.5 rounded-xl bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 dark:hover:bg-emerald-700 text-white text-sm font-semibold transition-colors"
            >
              {searching ? 'Mencari...' : 'Cari'}
            </button>
          </form>

          {searchResults.length > 0 && (
            <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800 rounded-2xl border border-slate-200 dark:border-slate-800">
              {searchResults.map((u) => (
                <div key={u.uid} className="flex items-center gap-3 p-3.5">
                  <Avatar name={u.displayName} src={u.photoURL} size="md" online={u.isOnline} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                      {u.displayName}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      @{u.username} {u.bio ? `· ${u.bio}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!contactSet.has(u.uid) && (
                      <button
                        onClick={() => handleAddContact(u)}
                        className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200"
                        title="Tambahkan ke kontak"
                      >
                        <UserPlus className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => handleStartPrivateChat(u)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      Chat
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Daftar Kontak */}
        <section>
          <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2.5">
            Daftar Kontak ({contacts.length})
          </h3>
          {contacts.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-6 text-center text-sm text-slate-500 dark:text-slate-400">
              Belum ada kontak tersimpan. Cari pengguna di atas untuk menambahkan kontak baru.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {contacts.map((c) => (
                <div
                  key={c.contactUid}
                  className="flex items-center gap-3 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800"
                >
                  <Avatar name={c.aliasName} src={c.photoURL} size="md" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                      {c.aliasName}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">@{c.username}</div>
                  </div>
                  <button
                    onClick={() =>
                      handleStartPrivateChat({
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
                    className="px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-xs font-semibold hover:bg-emerald-100"
                  >
                    Pesan
                  </button>
                  <button
                    onClick={() => handleRemoveContact(c.contactUid)}
                    className="p-1.5 text-slate-400 hover:text-rose-500"
                    title="Hapus kontak"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Temukan Grup Publik */}
        <section>
          <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2.5">
            Temukan Grup &amp; Komunitas ({publicGroups.length})
          </h3>
          {publicGroups.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-6 text-center text-sm text-slate-500 dark:text-slate-400">
              Belum ada grup komunitas publik. Jadilah yang pertama membuat grup publik!
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {publicGroups.map((g) => {
                const isMember = g.memberUids.includes(myProfile.uid);
                return (
                  <div
                    key={g.id}
                    className="flex items-center gap-3 p-4 rounded-2xl border border-slate-200 dark:border-slate-800"
                  >
                    <Avatar name={g.title || 'Grup'} src={g.photoURL} size="md" isGroup />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                          {g.title || 'Grup PK Chat'}
                        </span>
                        <Globe className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {g.description || `${g.memberUids.length} anggota`}
                      </p>
                    </div>
                    <button
                      onClick={() => handleJoinPublicGroup(g)}
                      className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors ${
                        isMember
                          ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                          : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                      }`}
                    >
                      {isMember ? 'Buka' : 'Gabung'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Modal Buat Grup */}
      {showCreateGroup && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateGroup}
            className="w-full max-w-md rounded-3xl bg-white dark:bg-[#111820] border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-xl max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Buat Grup Baru
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateGroup(false)}
                className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-3">
              <Avatar name={groupTitle || 'Grup'} src={groupPhoto} size="lg" isGroup />
              <label className="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer">
                Ubah Foto Grup
                <input type="file" accept="image/*" onChange={handleGroupPhotoUpload} className="hidden" />
              </label>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Nama Grup
              </label>
              <input
                type="text"
                required
                maxLength={100}
                value={groupTitle}
                onChange={(e) => setGroupTitle(e.target.value)}
                placeholder="Contoh: Tim Produk Nusantara"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Deskripsi Grup
              </label>
              <textarea
                rows={2}
                maxLength={400}
                value={groupDesc}
                onChange={(e) => setGroupDesc(e.target.value)}
                placeholder="Topik atau aturan grup..."
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
              />
            </div>

            <label className="flex items-center gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={isPublicGroup}
                onChange={(e) => setIsPublicGroup(e.target.checked)}
                className="rounded border-slate-300 text-emerald-600"
              />
              Tampilkan di direktori Komunitas agar pengguna lain dapat bergabung
            </label>

            {contacts.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  <Users className="w-3.5 h-3.5" />
                  Pilih Anggota dari Kontak ({selectedMembers.length})
                </div>
                <div className="max-h-36 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
                  {contacts.map((c) => {
                    const checked = selectedMembers.includes(c.contactUid);
                    return (
                      <button
                        type="button"
                        key={c.contactUid}
                        onClick={() =>
                          setSelectedMembers((prev) =>
                            checked ? prev.filter((u) => u !== c.contactUid) : [...prev, c.contactUid]
                          )
                        }
                        className="w-full flex items-center gap-2.5 p-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50"
                      >
                        <Avatar name={c.aliasName} src={c.photoURL} size="xs" />
                        <span className="flex-1 text-xs font-medium text-slate-900 dark:text-white truncate">
                          {c.aliasName}
                        </span>
                        {checked && <Check className="w-4 h-4 text-emerald-600" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={creating}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
            >
              {creating ? 'Membuat Grup...' : 'Buat Grup Sekarang'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
