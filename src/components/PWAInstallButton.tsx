import React, { useState } from 'react';
import { Download, Smartphone, WifiOff } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const PWAInstallButton: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        onClick={install}
        className={`inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-medium transition-colors whitespace-nowrap shrink-0 ${
          compact ? 'px-3 py-1.5 text-xs' : 'px-4 py-2.5 text-sm w-full'
        }`}
      >
        <Download className="w-4 h-4" />
        Instal Aplikasi PK Chat
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSGuide(true)}
          className={`inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 font-medium transition-colors whitespace-nowrap shrink-0 ${
            compact ? 'px-3 py-1.5 text-xs' : 'px-4 py-2.5 text-sm w-full'
          }`}
        >
          <Smartphone className="w-4 h-4" />
          Instal di iOS / Android
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#111820] border border-slate-200 dark:border-slate-800 p-6 shadow-xl">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                Instal PK Chat di Layar Utama
              </h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                1. Ketuk tombol <strong>Bagikan (Share)</strong> pada bilah Safari.<br />
                2. Gulir ke bawah dan pilih <strong>Tambah ke Layar Utama (Add to Home Screen)</strong>.
              </p>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 py-2.5 text-sm font-medium text-white transition-colors"
              >
                Mengerti
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="fixed bottom-20 lg:bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl bg-amber-600 px-3.5 py-2 text-xs font-medium text-white shadow-lg">
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>Mode Offline — Menampilkan data tersimpan</span>
    </div>
  );
};
