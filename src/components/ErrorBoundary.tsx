import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    let msg = error.message || 'Terjadi kesalahan tidak terduga pada aplikasi.';
    try {
      const parsed = JSON.parse(msg);
      if (parsed?.error) {
        msg = `Akses data ditolak atau gagal (${parsed.operationType || 'operasi'}): ${parsed.error}`;
      }
    } catch {
      // Plain error message
    }
    return { hasError: true, message: msg };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0B1014] p-6">
          <div className="max-w-md w-full rounded-2xl bg-white dark:bg-[#111820] border border-slate-200 dark:border-slate-800 p-6 text-center shadow-sm">
            <div className="mx-auto w-12 h-12 rounded-full bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center mb-4">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Terjadi Gangguan Koneksi Data
            </h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              {this.state.message}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mt-5 inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Muat Ulang PK Chat
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
