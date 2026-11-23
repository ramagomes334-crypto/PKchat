import React, { useEffect, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signOut,
  updatePassword,
} from 'firebase/auth';
import {
  Bell,
  Camera,
  Check,
  Clock,
  HardDrive,
  KeyRound,
  Laptop,
  Link2,
  Lock,
  LogOut,
  Moon,
  Shield,
  Sun,
  Trash2,
  UserX,
} from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  checkUsernameAvailable,
  deleteAccountData,
  getCloudinaryConfig,
  hashPasswordClient,
  normalizePhoneKey,
  sanitizeUsername,
  saveCloudinaryConfig,
  uploadMediaFile,
} from '../lib/chatService';
import type {
  BlockedUser,
  DeviceSession,
  UserPrivateInfo,
  UserProfile,
  UserSettings,
} from '../types/chat';
import { Avatar } from './PKLogo';
import { PWAInstallButton } from './PWAInstallButton';
import { useToast } from './ToastProvider';

interface SettingsViewProps {
  myProfile: UserProfile;
  settings: UserSettings;
  blockedUsers: BlockedUser[];
  hasAppLock?: boolean;
  onSaveAppLock?: (pinHash: string | null) => void;
  onLockNow?: () => void;
  onApplyTheme: (theme: 'light' | 'dark' | 'system') => void;
  onApplyFontSize: (size: 'small' | 'medium' | 'large') => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  myProfile,
  settings,
  blockedUsers,
  hasAppLock = false,
  onSaveAppLock,
  onLockNow,
  onApplyTheme,
  onApplyFontSize,
}) => {
  const { showToast } = useToast();
  const [displayName, setDisplayName] = useState(myProfile.displayName);
  const [username, setUsername] = useState(myProfile.username);
  const [bio, setBio] = useState(myProfile.bio || '');
  const [phone, setPhone] = useState('');
  const [phoneSearchable, setPhoneSearchable] = useState(true);
  const [devices, setDevices] = useState<DeviceSession[]>([]);
  const [savingProfile, setSavingProfile] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [storageInfo, setStorageInfo] = useState<string>('Menghitung...');
  const [blockedProfiles, setBlockedProfiles] = useState<Record<string, UserProfile>>({});
  const [notifPerm, setNotifPerm] = useState<string>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
  );
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [changingPwd, setChangingPwd] = useState(false);
  const [appPinInput, setAppPinInput] = useState('');
  const initialCloudCfg = getCloudinaryConfig();
  const [cloudName, setCloudName] = useState(initialCloudCfg.cloudName);
  const [uploadPreset, setUploadPreset] = useState(initialCloudCfg.uploadPreset);
  const cloudFromEnv = initialCloudCfg.fromEnv;

  useEffect(() => {
    getDoc(doc(db, 'users', myProfile.uid, 'private', 'info')).then((snap) => {
      if (snap.exists()) {
        const priv = snap.data() as UserPrivateInfo;
        setPhone(priv.phone || '');
        setPhoneSearchable(Boolean(priv.phoneSearchable));
      }
    });

    const unsubDevices = onSnapshot(
      query(collection(db, 'users', myProfile.uid, 'devices'), where('uid', '==', myProfile.uid)),
      (snap) => {
        setDevices(snap.docs.map((d) => d.data() as DeviceSession));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `users/${myProfile.uid}/devices`)
    );

    if (navigator.storage?.estimate) {
      navigator.storage.estimate().then((est) => {
        const mb = ((est.usage || 0) / (1024 * 1024)).toFixed(2);
        setStorageInfo(`${mb} MB digunakan di penyimpanan lokal perangkat`);
      });
    } else {
      setStorageInfo('Penyimpanan lokal siap digunakan');
    }

    return () => unsubDevices();
  }, [myProfile.uid]);

  useEffect(() => {
    blockedUsers.forEach((b) => {
      if (!blockedProfiles[b.blockedUid]) {
        getDoc(doc(db, 'users', b.blockedUid)).then((snap) => {
          if (snap.exists()) {
            setBlockedProfiles((prev) => ({ ...prev, [b.blockedUid]: snap.data() as UserProfile }));
          }
        }).catch(() => {});
      }
    });
  }, [blockedUsers]);

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const uploaded = await uploadMediaFile(file);
      await updateDoc(doc(db, 'users', myProfile.uid), {
        photoURL: uploaded.url,
        updatedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'usernames', myProfile.username), {
        photoURL: uploaded.url,
      });
      showToast('Foto profil diperbarui', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Gagal mengganti foto profil', 'error');
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUser = sanitizeUsername(username);
    if (cleanUser.length < 3) {
      showToast('Username minimal 3 karakter', 'error');
      return;
    }
    setSavingProfile(true);
    try {
      if (cleanUser !== myProfile.username) {
        const available = await checkUsernameAvailable(cleanUser);
        if (!available) {
          showToast('Username baru sudah digunakan oleh akun lain', 'error');
          setSavingProfile(false);
          return;
        }
        await setDoc(doc(db, 'usernames', cleanUser), {
          uid: myProfile.uid,
          username: cleanUser,
          displayName: displayName.trim(),
          photoURL: myProfile.photoURL || '',
          createdAt: serverTimestamp(),
        });
        await deleteDoc(doc(db, 'usernames', myProfile.username));
      } else {
        await updateDoc(doc(db, 'usernames', cleanUser), {
          displayName: displayName.trim(),
        });
      }

      await updateDoc(doc(db, 'users', myProfile.uid), {
        username: cleanUser,
        displayName: displayName.trim(),
        bio: bio.trim(),
        updatedAt: serverTimestamp(),
      });

      await updateDoc(doc(db, 'users', myProfile.uid, 'private', 'info'), {
        phone: phone.trim(),
        phoneSearchable,
        updatedAt: serverTimestamp(),
      });

      if (phoneSearchable && phone.trim().length >= 6) {
        const key = normalizePhoneKey(phone);
        await setDoc(doc(db, 'phoneDirectory', key), {
          uid: myProfile.uid,
          phoneKey: key,
          username: cleanUser,
          displayName: displayName.trim(),
          photoURL: myProfile.photoURL || '',
          createdAt: serverTimestamp(),
        });
      }

      showToast('Profil berhasil disimpan', 'success');
    } catch {
      showToast('Gagal menyimpan perubahan profil', 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  const updateSettingsField = async (patch: Partial<UserSettings>) => {
    try {
      await updateDoc(doc(db, 'users', myProfile.uid, 'settings', 'preferences'), {
        ...patch,
        updatedAt: serverTimestamp(),
      });

      // Mirror public visibility flags onto public profile
      const profilePatch: Record<string, any> = {};
      if (patch.onlineVisibility !== undefined) {
        profilePatch.showOnlineStatus = patch.onlineVisibility === 'everyone';
      }
      if (patch.lastSeenVisibility !== undefined) {
        profilePatch.showLastSeen = patch.lastSeenVisibility !== 'nobody';
      }
      if (patch.profilePhotoVisibility !== undefined) {
        profilePatch.showProfilePhoto = patch.profilePhotoVisibility !== 'nobody';
      }
      if (Object.keys(profilePatch).length > 0) {
        await updateDoc(doc(db, 'users', myProfile.uid), {
          ...profilePatch,
          updatedAt: serverTimestamp(),
        });
      }
      showToast('Pengaturan diperbarui', 'success');
    } catch {
      showToast('Gagal memperbarui pengaturan', 'error');
    }
  };

  const handleUnblock = async (blockedUid: string) => {
    try {
      await deleteDoc(doc(db, 'users', myProfile.uid, 'blocked', blockedUid));
      showToast('Pengguna dibuka blokirnya', 'info');
    } catch {
      showToast('Gagal membuka blokir', 'error');
    }
  };

  const handleRevokeDevice = async (deviceId: string) => {
    try {
      await deleteDoc(doc(db, 'users', myProfile.uid, 'devices', deviceId));
      showToast('Sesi perangkat dihapus', 'info');
    } catch {
      showToast('Gagal menghapus sesi perangkat', 'error');
    }
  };

  const handleClearCache = async () => {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    showToast('Cache aplikasi lokal berhasil dibersihkan', 'success');
  };

  const handleDeleteAccount = async () => {
    try {
      await deleteAccountData(myProfile.uid, myProfile.username);
      await signOut(auth);
      showToast('Data akun telah dihapus', 'info');
    } catch {
      showToast('Gagal menghapus akun', 'error');
    }
  };

  const handleRequestBrowserNotif = async () => {
    if (!('Notification' in window)) {
      showToast('Browser tidak mendukung notifikasi desktop', 'error');
      return;
    }
    const perm = await Notification.requestPermission();
    setNotifPerm(perm);
    if (perm === 'granted') {
      showToast('Notifikasi browser diaktifkan', 'success');
    } else {
      showToast('Izin notifikasi ditolak atau ditutup', 'info');
    }
  };

  const isUsernameAccount = Boolean(auth.currentUser?.email?.endsWith('@pkchat.local'));

  const handleSendPasswordReset = async () => {
    const email = auth.currentUser?.email;
    if (!email || email.endsWith('@pkchat.local')) {
      showToast('Akun username mengubah kata sandi langsung di kolom bawah.', 'info');
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      showToast(`Tautan ubah password dikirim ke ${email}`, 'success');
    } catch {
      showToast('Gagal mengirim tautan reset password', 'error');
    }
  };

  const handleChangeLocalPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user?.email) return;
    if (newPwd.length < 6) {
      showToast('Kata sandi baru minimal 6 karakter', 'error');
      return;
    }
    setChangingPwd(true);
    try {
      const cred = EmailAuthProvider.credential(user.email, oldPwd);
      await reauthenticateWithCredential(user, cred);
      await updatePassword(user, newPwd);
      setOldPwd('');
      setNewPwd('');
      showToast('Kata sandi berhasil diperbarui', 'success');
    } catch {
      showToast('Kata sandi saat ini tidak cocok', 'error');
    } finally {
      setChangingPwd(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-white dark:bg-[#111820]">
      <div className="p-4 sm:p-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
            Profil &amp; Pengaturan
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Kelola identitas, privasi, keamanan sesi, notifikasi, dan tampilan PK Chat.
          </p>
        </div>
        <button
          onClick={() => signOut(auth)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-rose-200 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-semibold transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
          Keluar
        </button>
      </div>

      <div className="p-4 sm:p-6 max-w-3xl space-y-8 pb-24">
        {/* PWA Install Banner */}
        <PWAInstallButton />

        {/* Profil */}
        <section className="space-y-4">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Profil Pengguna</h3>
          <div className="flex items-center gap-4">
            <Avatar name={myProfile.displayName} src={myProfile.photoURL} size="xl" />
            <div>
              <label className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
                <Camera className="w-4 h-4" />
                Ganti Foto Profil
                <input type="file" accept="image/*" onChange={handlePhotoChange} className="hidden" />
              </label>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                ID Akun: <span className="font-mono-num">{myProfile.uid.slice(0, 12)}...</span>
              </p>
              <button
                type="button"
                onClick={async () => {
                  const link = `${window.location.origin}/?u=${myProfile.username}`;
                  try {
                    await navigator.clipboard.writeText(link);
                    showToast('Tautan chat pribadi berhasil disalin!', 'success');
                  } catch {
                    showToast(link, 'info');
                  }
                }}
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-xs font-semibold text-emerald-700 dark:text-emerald-300 transition-colors"
              >
                <Link2 className="w-3.5 h-3.5" />
                Salin Tautan Chat Saya (@{myProfile.username})
              </button>
            </div>
          </div>

          <form onSubmit={handleSaveProfile} className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                Nama Tampilan
              </label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                Username Unik
              </label>
              <input
                type="text"
                required
                disabled={isUsernameAccount}
                value={username}
                onChange={(e) => setUsername(sanitizeUsername(e.target.value))}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white disabled:opacity-60 disabled:cursor-not-allowed"
              />
              {isUsernameAccount && (
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  Digunakan sebagai username untuk masuk ke akun.
                </p>
              )}
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                Bio
              </label>
              <input
                type="text"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                maxLength={240}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                Nomor HP
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0812..."
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 pb-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={phoneSearchable}
                  onChange={(e) => setPhoneSearchable(e.target.checked)}
                />
                Izinkan pencarian lewat nomor HP
              </label>
            </div>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={savingProfile}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
              >
                <Check className="w-4 h-4" />
                {savingProfile ? 'Menyimpan...' : 'Simpan Profil'}
              </button>
            </div>
          </form>
        </section>

        <hr className="border-slate-200 dark:border-slate-800" />

        {/* Tampilan & Ukuran Tulisan */}
        <section className="space-y-4">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Tampilan &amp; Tema</h3>
          <div className="grid grid-cols-3 gap-2.5">
            {(['light', 'dark', 'system'] as const).map((t) => (
              <button
                key={t}
                onClick={() => {
                  onApplyTheme(t);
                  updateSettingsField({ theme: t });
                }}
                className={`py-2.5 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-colors ${
                  settings.theme === t
                    ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                    : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                {t === 'light' ? <Sun className="w-4 h-4" /> : t === 'dark' ? <Moon className="w-4 h-4" /> : null}
                {t === 'light' ? 'Terang' : t === 'dark' ? 'Gelap' : 'Sistem'}
              </button>
            ))}
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">
              Ukuran Tulisan Chat
            </label>
            <div className="grid grid-cols-3 gap-2.5">
              {(['small', 'medium', 'large'] as const).map((sz) => (
                <button
                  key={sz}
                  onClick={() => {
                    onApplyFontSize(sz);
                    updateSettingsField({ fontSize: sz });
                  }}
                  className={`py-2 rounded-xl border text-xs font-semibold ${
                    settings.fontSize === sz
                      ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                      : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {sz === 'small' ? 'Kecil' : sz === 'medium' ? 'Sedang' : 'Besar'}
                </button>
              ))}
            </div>
          </div>
        </section>

        <hr className="border-slate-200 dark:border-slate-800" />

        {/* Privasi & Keamanan */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Privasi &amp; Keamanan</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Foto Profil
              </label>
              <select
                value={settings.profilePhotoVisibility || 'everyone'}
                onChange={(e) => updateSettingsField({ profilePhotoVisibility: e.target.value as any })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs text-slate-900 dark:text-white"
              >
                <option value="everyone">Semua Orang</option>
                <option value="contacts">Kontak Saya</option>
                <option value="nobody">Tidak Ada</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Terakhir Dilihat
              </label>
              <select
                value={settings.lastSeenVisibility || 'everyone'}
                onChange={(e) => updateSettingsField({ lastSeenVisibility: e.target.value as any })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs text-slate-900 dark:text-white"
              >
                <option value="everyone">Semua Orang</option>
                <option value="contacts">Kontak Saya</option>
                <option value="nobody">Tidak Ada</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Status Online
              </label>
              <select
                value={settings.onlineVisibility || 'everyone'}
                onChange={(e) => updateSettingsField({ onlineVisibility: e.target.value as any })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs text-slate-900 dark:text-white"
              >
                <option value="everyone">Tampilkan ke Semua</option>
                <option value="nobody">Sembunyikan</option>
              </select>
            </div>
          </div>

          <label className="flex items-center justify-between p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 cursor-pointer">
            <div>
              <div className="text-sm font-medium text-slate-900 dark:text-white">
                Laporan Dibaca (Centang Biru)
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Jika dimatikan, Anda juga tidak dapat melihat laporan dibaca orang lain.
              </div>
            </div>
            <input
              type="checkbox"
              checked={settings.readReceipts}
              onChange={(e) => updateSettingsField({ readReceipts: e.target.checked })}
              className="w-4 h-4 accent-emerald-600"
            />
          </label>

          {/* Pesan Sementara Default */}
          <div className="flex items-center justify-between gap-4 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800">
            <div>
              <div className="flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-white">
                <Clock className="w-4 h-4 text-emerald-600" />
                Timer Pesan Sementara Default
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Otomatis aktif untuk percakapan pribadi baru yang Anda mulai.
              </div>
            </div>
            <select
              value={settings.disappearingDefaultSeconds || 0}
              onChange={(e) => updateSettingsField({ disappearingDefaultSeconds: Number(e.target.value) })}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs text-slate-900 dark:text-white"
            >
              <option value={0}>Mati</option>
              <option value={86400}>24 Jam</option>
              <option value={604800}>7 Hari</option>
              <option value={7776000}>90 Hari</option>
            </select>
          </div>

          {/* Ubah / Reset Password */}
          {auth.currentUser?.providerData.some((p) => p.providerId === 'password') && (
            isUsernameAccount ? (
              <form
                onSubmit={handleChangeLocalPassword}
                className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-2.5"
              >
                <div className="flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-white">
                  <KeyRound className="w-4 h-4 text-emerald-600" />
                  Ubah Kata Sandi Akun Username
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="password"
                    required
                    value={oldPwd}
                    onChange={(e) => setOldPwd(e.target.value)}
                    placeholder="Kata sandi saat ini"
                    className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"
                  />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={newPwd}
                    onChange={(e) => setNewPwd(e.target.value)}
                    placeholder="Kata sandi baru (min. 6)"
                    className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"
                  />
                </div>
                <button
                  type="submit"
                  disabled={changingPwd}
                  className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-xs font-semibold text-white"
                >
                  {changingPwd ? 'Menyimpan...' : 'Simpan Kata Sandi Baru'}
                </button>
              </form>
            ) : (
              <div className="flex items-center justify-between gap-4 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800">
                <div>
                  <div className="flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-white">
                    <KeyRound className="w-4 h-4 text-emerald-600" />
                    Kata Sandi Akun
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Kirim tautan ubah password aman ke email Anda ({auth.currentUser?.email}).
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleSendPasswordReset}
                  className="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-xs font-semibold text-slate-800 dark:text-slate-200 shrink-0"
                >
                  Ubah Password
                </button>
              </div>
            )
          )}

          {/* Kunci Layar PIN Aplikasi */}
          {onSaveAppLock && (
            <div className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-white">
                    <Lock className="w-4 h-4 text-emerald-600" />
                    Kunci Layar Aplikasi (PIN Perangkat)
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {hasAppLock
                      ? 'Aktif di perangkat ini. Layar chat akan terkunci dengan PIN Anda.'
                      : 'Lindungi isi chat dengan PIN 4–8 karakter setiap kali aplikasi dibuka atau dikunci.'}
                  </div>
                </div>
                {hasAppLock && onLockNow && (
                  <button
                    type="button"
                    onClick={onLockNow}
                    className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shrink-0"
                  >
                    Kunci Sekarang
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="password"
                  value={appPinInput}
                  onChange={(e) => setAppPinInput(e.target.value)}
                  maxLength={12}
                  placeholder={hasAppLock ? 'Ganti PIN baru (min. 4)' : 'Buat PIN (min. 4 karakter)'}
                  className="flex-1 min-w-[160px] px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"
                />
                <button
                  type="button"
                  onClick={async () => {
                    if (appPinInput.trim().length < 4) {
                      showToast('PIN minimal 4 karakter', 'error');
                      return;
                    }
                    const hash = await hashPasswordClient(appPinInput.trim());
                    onSaveAppLock(hash);
                    setAppPinInput('');
                    showToast('PIN kunci aplikasi disimpan', 'success');
                  }}
                  className="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-xs font-semibold text-slate-800 dark:text-slate-200"
                >
                  {hasAppLock ? 'Ubah PIN' : 'Aktifkan PIN'}
                </button>
                {hasAppLock && (
                  <button
                    type="button"
                    onClick={() => {
                      onSaveAppLock(null);
                      showToast('Kunci layar PIN dimatikan', 'info');
                    }}
                    className="px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                  >
                    Matikan
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Pengguna Diblokir */}
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">
              <UserX className="w-3.5 h-3.5" />
              Pengguna Diblokir ({blockedUsers.length})
            </div>
            {blockedUsers.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">Tidak ada pengguna yang diblokir.</p>
            ) : (
              <div className="space-y-2">
                {blockedUsers.map((b) => {
                  const prof = blockedProfiles[b.blockedUid];
                  return (
                    <div
                      key={b.blockedUid}
                      className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar name={prof?.displayName || b.blockedUid} src={prof?.photoURL} size="xs" />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                            {prof?.displayName || `Pengguna (${b.blockedUid.slice(0, 8)}...)`}
                          </div>
                          {prof?.username && (
                            <div className="text-[11px] text-slate-500">@{prof.username}</div>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => handleUnblock(b.blockedUid)}
                        className="text-xs font-semibold text-emerald-600 hover:underline shrink-0"
                      >
                        Buka Blokir
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <hr className="border-slate-200 dark:border-slate-800" />

        {/* Notifikasi */}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-emerald-600" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Notifikasi</h3>
            </div>
            {notifPerm !== 'unsupported' && (
              <button
                type="button"
                onClick={handleRequestBrowserNotif}
                disabled={notifPerm === 'granted'}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                  notifPerm === 'granted'
                    ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                }`}
              >
                {notifPerm === 'granted'
                  ? 'Notifikasi Browser Aktif'
                  : notifPerm === 'denied'
                  ? 'Izin Diblokir Browser'
                  : 'Aktifkan Notifikasi Browser'}
              </button>
            )}
          </div>
          {[
            { key: 'notifyMessages', label: 'Notifikasi Pesan Pribadi' },
            { key: 'notifyGroups', label: 'Notifikasi Pesan Grup & Mention' },
            { key: 'notifyCalls', label: 'Notifikasi Panggilan Masuk' },
            { key: 'notifyStatuses', label: 'Notifikasi Pembaruan Status' },
            { key: 'notificationSound', label: 'Suara Notifikasi' },
          ].map((item) => (
            <label
              key={item.key}
              className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-800 cursor-pointer"
            >
              <span className="text-sm text-slate-800 dark:text-slate-200">{item.label}</span>
              <input
                type="checkbox"
                checked={Boolean((settings as any)[item.key])}
                onChange={(e) => updateSettingsField({ [item.key]: e.target.checked })}
                className="w-4 h-4 accent-emerald-600"
              />
            </label>
          ))}
        </section>

        <hr className="border-slate-200 dark:border-slate-800" />

        {/* Perangkat & Penyimpanan */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Laptop className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Perangkat Terhubung &amp; Sesi Login ({devices.length})
            </h3>
          </div>
          <div className="space-y-2">
            {devices.map((d) => (
              <div
                key={d.deviceId}
                className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 dark:border-slate-800"
              >
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    {d.deviceName}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {d.platform} · {d.verified ? 'Terverifikasi' : 'Aktif'}
                  </div>
                </div>
                <button
                  onClick={() => handleRevokeDevice(d.deviceId)}
                  className="text-xs font-semibold text-rose-600 hover:underline"
                >
                  Hapus Sesi
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <HardDrive className="w-5 h-5 text-slate-500" />
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-white">
                  Kelola Penyimpanan
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">{storageInfo}</div>
              </div>
            </div>
            <button
              onClick={handleClearCache}
              className="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-xs font-semibold text-slate-800 dark:text-slate-200"
            >
              Bersihkan Cache
            </button>
          </div>

          <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-2.5">
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                Penyimpanan Media Gratis (Cloudinary untuk Cloudflare Pages)
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {cloudFromEnv
                  ? 'Aktif otomatis melalui environment variable Cloudflare Pages / hosting.'
                  : 'Opsional untuk upload foto, video, & voice note di Cloudflare Pages gratis (buat Unsigned Upload Preset gratis di Cloudinary).'}
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                disabled={cloudFromEnv}
                value={cloudName}
                onChange={(e) => setCloudName(e.target.value)}
                placeholder="Cloud Name (contoh: dxyz123)"
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs text-slate-900 dark:text-white disabled:opacity-60"
              />
              <input
                type="text"
                disabled={cloudFromEnv}
                value={uploadPreset}
                onChange={(e) => setUploadPreset(e.target.value)}
                placeholder="Unsigned Upload Preset"
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs text-slate-900 dark:text-white disabled:opacity-60"
              />
            </div>
            {!cloudFromEnv && (
              <button
                type="button"
                onClick={() => {
                  saveCloudinaryConfig(cloudName, uploadPreset);
                  showToast(
                    cloudName.trim() && uploadPreset.trim()
                      ? 'Pengaturan Cloudinary disimpan untuk upload media'
                      : 'Pengaturan Cloudinary dikosongkan',
                    'success'
                  );
                }}
                className="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-xs font-semibold text-slate-800 dark:text-slate-200"
              >
                Simpan Pengaturan Media
              </button>
            )}
          </div>
        </section>

        <hr className="border-slate-200 dark:border-slate-800" />

        {/* Zona Berbahaya: Hapus Akun */}
        <section className="rounded-2xl border border-rose-200 dark:border-rose-900/60 p-4 space-y-3">
          <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
            <Lock className="w-4 h-4" />
            <h3 className="text-sm font-bold">Hapus Akun PK Chat</h3>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Tindakan ini akan menghapus profil, kontak, dan pengaturan akun Anda secara permanen.
          </p>
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Hapus Akun Saya
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={handleDeleteAccount}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold"
              >
                Ya, Hapus Permanen
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200"
              >
                Batal
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
