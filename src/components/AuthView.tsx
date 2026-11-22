import React, { useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import {
  ArrowRight,
  AtSign,
  Camera,
  Check,
  KeyRound,
  Lock,
  Mail,
  Phone,
  ShieldCheck,
  User as UserIcon,
  X,
} from 'lucide-react';
import { auth, googleAuthProvider } from '../lib/firebase';
import {
  checkUsernameAvailable,
  sanitizeUsername,
  saveUserOnboarding,
  uploadMediaFile,
} from '../lib/chatService';
import { ensureE2EEKeyPair } from '../lib/e2ee';
import { Avatar, PKLogo } from './PKLogo';
import { useToast } from './ToastProvider';

interface AuthViewProps {
  firebaseUser: User | null;
  needsOnboarding: boolean;
  onOnboardingComplete: () => void;
}

export const AuthView: React.FC<AuthViewProps> = ({
  firebaseUser,
  needsOnboarding,
  onOnboardingComplete,
}) => {
  const { showToast } = useToast();
  const [authTab, setAuthTab] = useState<'login' | 'register' | 'forgot'>('login');
  const [registerMode, setRegisterMode] = useState<'username' | 'email'>('username');
  const [identifier, setIdentifier] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regDisplayName, setRegDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [creatingUsernameAccount, setCreatingUsernameAccount] = useState(false);
  const [providerHint, setProviderHint] = useState<string | null>(null);

  // Onboarding state (for Google / Email sign-ups)
  const [username, setUsername] = useState('');
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [displayName, setDisplayName] = useState(firebaseUser?.displayName || '');
  const [bio, setBio] = useState('Tersedia di PK Chat');
  const [phone, setPhone] = useState('');
  const [phoneSearchable, setPhoneSearchable] = useState(true);
  const [accountPin, setAccountPin] = useState('');
  const [photoURL, setPhotoURL] = useState(firebaseUser?.photoURL || '');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  useEffect(() => {
    if (firebaseUser) {
      setDisplayName((prev) => prev || firebaseUser.displayName || firebaseUser.email?.split('@')[0] || '');
      setPhotoURL((prev) => prev || firebaseUser.photoURL || '');
      if (!username && firebaseUser.email) {
        const base = sanitizeUsername(firebaseUser.email.split('@')[0]);
        if (base.length >= 3) setUsername(base);
      }
    }
  }, [firebaseUser]);

  useEffect(() => {
    const clean = sanitizeUsername(username);
    if (!firebaseUser || clean.length < 3) {
      setUsernameAvailable(null);
      return;
    }
    const timer = window.setTimeout(async () => {
      setCheckingUsername(true);
      try {
        const ok = await checkUsernameAvailable(clean);
        setUsernameAvailable(ok);
      } catch {
        setUsernameAvailable(null);
      } finally {
        setCheckingUsername(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [username, firebaseUser?.uid]);

  const mapAuthError = (err: any): string => {
    const code = err?.code || '';
    if (code === 'auth/unauthorized-domain') {
      return `Domain "${window.location.hostname}" belum didaftarkan di Firebase Authentication → Settings → Authorized domains.`;
    }
    if (code === 'auth/popup-blocked') {
      return 'Popup login diblokir oleh browser. Izinkan popup untuk situs ini lalu coba lagi.';
    }
    if (code === 'auth/invalid-credential' || code === 'auth/user-not-found' || code === 'auth/wrong-password') {
      return 'Username/email atau kata sandi tidak cocok. Jika Anda mendaftar dengan Google/Email pribadi, masuklah dengan Google atau alamat email Anda.';
    }
    if (code === 'auth/email-already-in-use') {
      return 'Username atau email ini sudah terdaftar. Silakan masuk atau pilih yang lain.';
    }
    if (code === 'auth/weak-password') {
      return 'Kata sandi terlalu lemah. Gunakan minimal 6 karakter.';
    }
    if (code === 'auth/too-many-requests') {
      return 'Terlalu banyak percobaan login. Tunggu beberapa saat sebelum mencoba lagi.';
    }
    if (code === 'auth/network-request-failed') {
      return 'Koneksi internet bermasalah. Periksa jaringan Anda lalu coba lagi.';
    }
    return err?.message || 'Autentikasi gagal. Periksa kembali data Anda.';
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setProviderHint(null);
    try {
      await signInWithPopup(auth, googleAuthProvider);
      showToast('Berhasil masuk dengan akun Google', 'success');
    } catch (err: any) {
      if (err?.code !== 'auth/popup-closed-by-user' && err?.code !== 'auth/cancelled-popup-request') {
        const msg = mapAuthError(err);
        if (err?.code === 'auth/unauthorized-domain') setProviderHint(msg);
        showToast(msg, 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setProviderHint(null);
    try {
      if (authTab === 'forgot') {
        const trimmed = identifier.trim();
        if (!trimmed.includes('@')) {
          showToast('Reset sandi via tautan hanya berlaku untuk akun yang terdaftar dengan email.', 'info');
          setLoading(false);
          return;
        }
        await sendPasswordResetEmail(auth, trimmed);
        showToast('Tautan reset kata sandi telah dikirim ke email Anda.', 'success');
        setAuthTab('login');
      } else if (authTab === 'register' && registerMode === 'username') {
        const cleanUser = sanitizeUsername(regUsername);
        if (cleanUser.length < 3) {
          showToast('Username minimal 3 karakter (huruf kecil, angka, atau _)', 'error');
          setLoading(false);
          return;
        }
        const finalName = regDisplayName.trim() || cleanUser;
        setCreatingUsernameAccount(true);
        const cred = await createUserWithEmailAndPassword(auth, `${cleanUser}@pkchat.local`, password);
        try {
          const e2eePublicKey = (await ensureE2EEKeyPair(cred.user.uid)) || '';
          await saveUserOnboarding({
            uid: cred.user.uid,
            email: '',
            username: cleanUser,
            displayName: finalName,
            bio: 'Tersedia di PK Chat',
            phone: '',
            phoneSearchable: false,
            photoURL: '',
            e2eePublicKey,
            otpVerified: true,
          });
          showToast(`Selamat datang, @${cleanUser}!`, 'success');
          onOnboardingComplete();
        } catch (profileErr: any) {
          await deleteUser(cred.user).catch(() => {});
          throw profileErr;
        } finally {
          setCreatingUsernameAccount(false);
        }
      } else if (authTab === 'register') {
        const cred = await createUserWithEmailAndPassword(auth, identifier.trim(), password);
        await sendEmailVerification(cred.user);
        showToast('Akun dibuat. Silakan verifikasi email Anda lalu lengkapi profil.', 'success');
      } else {
        const rawInput = identifier.trim();
        let loginEmail = rawInput;
        if (!rawInput.includes('@')) {
          const cleanUser = sanitizeUsername(rawInput);
          if (cleanUser.length < 3) {
            showToast('Masukkan username (minimal 3 karakter) atau email yang valid.', 'error');
            setLoading(false);
            return;
          }
          loginEmail = `${cleanUser}@pkchat.local`;
        }
        await signInWithEmailAndPassword(auth, loginEmail, password);
        showToast('Berhasil masuk ke PK Chat', 'success');
      }
    } catch (err: any) {
      if (err?.code === 'auth/operation-not-allowed') {
        setProviderHint(
          'Login Username/Email & Password belum diaktifkan di Firebase Console (Authentication → Sign-in method → Email/Password). Aktifkan sekali di Firebase Console, atau gunakan Lanjutkan dengan Google.'
        );
      } else {
        const msg = mapAuthError(err);
        if (err?.code === 'auth/unauthorized-domain') setProviderHint(msg);
        showToast(msg, 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    try {
      const uploaded = await uploadMediaFile(file);
      setPhotoURL(uploaded.url);
      showToast('Foto profil berhasil diunggah', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Gagal mengunggah foto', 'error');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleResendVerification = async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      await sendEmailVerification(firebaseUser);
      showToast('Email verifikasi dikirim ulang. Periksa kotak masuk Anda.', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Gagal mengirim email verifikasi', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteOnboarding = async () => {
    if (!firebaseUser) return;
    const cleanUser = sanitizeUsername(username);
    if (cleanUser.length < 3 || usernameAvailable === false) {
      showToast('Pilih username unik yang tersedia (minimal 3 karakter)', 'error');
      return;
    }
    if (!displayName.trim()) {
      showToast('Nama tampilan wajib diisi', 'error');
      return;
    }

    setLoading(true);
    try {
      const isLocalUsernameAcct = Boolean(firebaseUser.email?.endsWith('@pkchat.local'));
      await firebaseUser.reload();
      if (!isLocalUsernameAcct && !firebaseUser.emailVerified) {
        showToast('Silakan klik tautan verifikasi di email Anda terlebih dahulu, lalu coba lagi.', 'error');
        setLoading(false);
        return;
      }

      const token = await firebaseUser.getIdToken(true);

      let passwordHash: string | undefined;
      if (accountPin.trim().length >= 6) {
        const hashRes = await fetch('/api/security/hash-password', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ password: accountPin.trim() }),
        });
        const hashData = await hashRes.json();
        if (hashRes.ok) passwordHash = hashData.passwordHash;
      }

      const e2eePublicKey = (await ensureE2EEKeyPair(firebaseUser.uid)) || '';

      await saveUserOnboarding({
        uid: firebaseUser.uid,
        email: firebaseUser.email || '',
        username: cleanUser,
        displayName: displayName.trim(),
        bio: bio.trim(),
        phone: phone.trim(),
        phoneSearchable,
        photoURL,
        e2eePublicKey,
        passwordHash,
        otpVerified: Boolean(firebaseUser.emailVerified || isLocalUsernameAcct),
      });

      showToast('Profil PK Chat siap digunakan!', 'success');
      onOnboardingComplete();
    } catch (err: any) {
      showToast(err?.message || 'Gagal menyimpan profil', 'error');
    } finally {
      setLoading(false);
    }
  };

  if (creatingUsernameAccount) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-[#0B1014] flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3 text-center">
          <PKLogo size={46} />
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
            Menyiapkan akun @{sanitizeUsername(regUsername)}...
          </p>
        </div>
      </div>
    );
  }

  if (firebaseUser && needsOnboarding) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-[#0B1014] flex items-center justify-center p-4">
        <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-[#111820] border border-slate-200 dark:border-slate-800 shadow-sm p-6 sm:p-8">
          <div className="flex items-center justify-between mb-6">
            <PKLogo size={34} />
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Pengaturan Identitas
              </span>
              <button
                type="button"
                onClick={() => signOut(auth)}
                className="text-xs font-semibold text-rose-600 hover:text-rose-700 dark:text-rose-400"
              >
                Ganti Akun
              </button>
            </div>
          </div>

          <div className="space-y-5">
              <div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                  Lengkapi Profil PK Chat
                </h1>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                  Pilih username unik dan atur informasi tampilan Anda sebelum mulai berkirim pesan.
                </p>
              </div>

              <div className="flex items-center gap-4">
                <Avatar name={displayName || 'PK'} src={photoURL} size="xl" />
                <div>
                  <label className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-sm font-medium cursor-pointer transition-colors">
                    <Camera className="w-4 h-4" />
                    {uploadingPhoto ? 'Mengunggah...' : 'Unggah Foto Profil'}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handlePhotoSelect}
                      className="hidden"
                      disabled={uploadingPhoto}
                    />
                  </label>
                  <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                    JPG, PNG, atau WebP maksimal 18 MB.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    Username Unik
                  </label>
                  <div className="relative">
                    <AtSign className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(sanitizeUsername(e.target.value))}
                      placeholder="contoh: budi_santoso"
                      className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      {checkingUsername ? (
                        <span className="text-xs text-slate-400">...</span>
                      ) : usernameAvailable === true ? (
                        <Check className="w-4 h-4 text-emerald-600" />
                      ) : usernameAvailable === false ? (
                        <X className="w-4 h-4 text-rose-500" />
                      ) : null}
                    </div>
                  </div>
                  {usernameAvailable === false && (
                    <p className="mt-1 text-xs text-rose-600">Username sudah digunakan. Coba variasi lain.</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    Nama Tampilan
                  </label>
                  <div className="relative">
                    <UserIcon className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Nama lengkap atau panggilan"
                      maxLength={80}
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    Bio
                  </label>
                  <input
                    type="text"
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    placeholder="Tulis status singkat Anda"
                    maxLength={240}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      Nomor HP (Opsional)
                    </label>
                    <div className="relative">
                      <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="08123456789"
                        className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      Kata Sandi / PIN Keamanan
                    </label>
                    <div className="relative">
                      <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="password"
                        value={accountPin}
                        onChange={(e) => setAccountPin(e.target.value)}
                        placeholder="Min. 6 karakter"
                        className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>
                </div>

                <label className="flex items-center gap-2.5 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={phoneSearchable}
                    onChange={(e) => setPhoneSearchable(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  Izinkan teman menemukan akun saya menggunakan nomor HP
                </label>
              </div>

              {!firebaseUser.emailVerified && !firebaseUser.email?.endsWith('@pkchat.local') && (
                <div className="rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 p-3.5 text-xs text-amber-900 dark:text-amber-200 flex flex-wrap items-center justify-between gap-2">
                  <span>Email Anda belum terverifikasi. Cek kotak masuk lalu klik tautan verifikasi.</span>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      type="button"
                      onClick={async () => {
                        setLoading(true);
                        try {
                          await firebaseUser.reload();
                          await firebaseUser.getIdToken(true);
                          showToast(
                            firebaseUser.emailVerified
                              ? 'Email terverifikasi! Silakan klik Simpan & Masuk.'
                              : 'Email masih belum diverifikasi. Periksa kotak masuk atau folder spam.',
                            firebaseUser.emailVerified ? 'success' : 'info'
                          );
                        } finally {
                          setLoading(false);
                        }
                      }}
                      disabled={loading}
                      className="font-semibold underline"
                    >
                      Cek Status
                    </button>
                    <button
                      type="button"
                      onClick={handleResendVerification}
                      disabled={loading}
                      className="font-semibold underline"
                    >
                      Kirim Ulang
                    </button>
                  </div>
                </div>
              )}

              <button
                onClick={handleCompleteOnboarding}
                disabled={loading}
                className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                {loading ? 'Menyimpan Profil...' : 'Simpan & Masuk ke PK Chat'}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0B1014] flex flex-col lg:flex-row">
      {/* Showcase Column */}
      <div className="hidden lg:flex lg:w-[48%] bg-emerald-700 dark:bg-[#0D1F18] text-white p-12 flex-col justify-between relative overflow-hidden">
        <div className="relative z-10">
          <div className="inline-flex items-center gap-3 px-4 py-2 rounded-2xl bg-white/10 backdrop-blur-sm">
            <PKLogo size={32} showWordmark={false} />
            <span className="font-display font-bold text-lg tracking-tight">PK Chat</span>
          </div>
          <h1 className="mt-10 font-display text-4xl font-bold leading-tight text-balance max-w-md">
            Komunikasi instan yang cepat, bersih, dan terenkripsi.
          </h1>
          <p className="mt-4 text-emerald-100/90 text-base leading-relaxed max-w-md">
            Terhubung dengan teman, keluarga, dan komunitas melalui pesan real-time, grup kolaboratif, status 24 jam, serta panggilan suara dan video HD.
          </p>
        </div>

        <div className="relative z-10 grid grid-cols-2 gap-4 max-w-md">
          <div className="rounded-2xl bg-white/10 backdrop-blur-sm p-4">
            <ShieldCheck className="w-5 h-5 text-emerald-200 mb-2" />
            <div className="text-sm font-semibold">End-to-End Encrypted</div>
            <p className="text-xs text-emerald-100/80 mt-1">
              Kunci ECDH P-256 &amp; AES-GCM untuk percakapan pribadi Anda.
            </p>
          </div>
          <div className="rounded-2xl bg-white/10 backdrop-blur-sm p-4">
            <Lock className="w-5 h-5 text-emerald-200 mb-2" />
            <div className="text-sm font-semibold">Sinkron Web &amp; Mobile</div>
            <p className="text-xs text-emerald-100/80 mt-1">
              Satu akun aman untuk browser desktop, tablet, dan Android PWA.
            </p>
          </div>
        </div>
      </div>

      {/* Interactive Login / Register Column */}
      <div className="flex-1 flex items-center justify-center p-5 sm:p-8">
        <div className="w-full max-w-md rounded-3xl bg-white dark:bg-[#111820] border border-slate-200 dark:border-slate-800 shadow-sm p-6 sm:p-8">
          <div className="lg:hidden mb-6">
            <PKLogo size={36} />
          </div>

          <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
            {authTab === 'login'
              ? 'Masuk ke PK Chat'
              : authTab === 'register'
              ? 'Buat Akun Baru'
              : 'Reset Kata Sandi'}
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {authTab === 'forgot'
              ? 'Masukkan email terdaftar untuk menerima tautan pemulihan.'
              : authTab === 'register'
              ? 'Daftar langsung memakai username & sandi, atau dengan email/Google.'
              : 'Masuk memakai username & kata sandi, email, atau akun Google.'}
          </p>

          <div className="mt-5 flex gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900 mb-4">
            <button
              type="button"
              onClick={() => {
                setAuthTab('login');
                setProviderHint(null);
              }}
              className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${
                authTab === 'login'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Masuk
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthTab('register');
                setProviderHint(null);
              }}
              className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${
                authTab === 'register'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Daftar
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthTab('forgot');
                setProviderHint(null);
              }}
              className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${
                authTab === 'forgot'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Lupa Sandi
            </button>
          </div>

          {authTab === 'register' && (
            <div className="grid grid-cols-2 gap-2 mb-4">
              <button
                type="button"
                onClick={() => setRegisterMode('username')}
                className={`py-2 px-3 rounded-xl border text-xs font-semibold transition-colors ${
                  registerMode === 'username'
                    ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
                    : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                }`}
              >
                Username &amp; Sandi
              </button>
              <button
                type="button"
                onClick={() => setRegisterMode('email')}
                className={`py-2 px-3 rounded-xl border text-xs font-semibold transition-colors ${
                  registerMode === 'email'
                    ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
                    : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                }`}
              >
                Pakai Email
              </button>
            </div>
          )}

          {providerHint && (
            <div className="mb-4 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
              {providerHint}
            </div>
          )}

          <form onSubmit={handleEmailAuth} className="space-y-3.5">
            {authTab === 'register' && registerMode === 'username' ? (
              <>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Username
                  </label>
                  <div className="relative">
                    <AtSign className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      minLength={3}
                      maxLength={30}
                      value={regUsername}
                      onChange={(e) => setRegUsername(sanitizeUsername(e.target.value))}
                      placeholder="contoh: budi_santoso"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Huruf kecil, angka, dan garis bawah (_) minimal 3 karakter.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Nama Tampilan
                  </label>
                  <div className="relative">
                    <UserIcon className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      maxLength={80}
                      value={regDisplayName}
                      onChange={(e) => setRegDisplayName(e.target.value)}
                      placeholder="Nama Anda di PK Chat"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>
              </>
            ) : (
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {authTab === 'login' ? 'Username atau Email' : 'Email'}
                </label>
                <div className="relative">
                  {authTab === 'login' ? (
                    <UserIcon className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  ) : (
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  )}
                  <input
                    type={authTab === 'login' ? 'text' : 'email'}
                    required
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder={authTab === 'login' ? 'username atau nama@email.com' : 'nama@email.com'}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>
            )}

            {authTab !== 'forgot' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Kata Sandi
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimal 6 karakter"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors shadow-sm"
            >
              {loading
                ? 'Memproses...'
                : authTab === 'login'
                ? 'Masuk ke PK Chat'
                : authTab === 'register'
                ? registerMode === 'username'
                  ? 'Daftar dengan Username'
                  : 'Daftar dengan Email'
                : 'Kirim Tautan Reset'}
            </button>
          </form>

          <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
            <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
            <span>atau</span>
            <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
          </div>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full py-2.5 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 font-semibold text-sm flex items-center justify-center gap-2.5 transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Lanjutkan dengan Google
          </button>
        </div>
      </div>
    </div>
  );
};
