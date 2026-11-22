import React, { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, Info, X, AlertCircle } from 'lucide-react';

interface Toast {
  id: string;
  title: string;
  type: 'success' | 'error' | 'info';
}

interface ToastContextType {
  showToast: (title: string, type?: 'success' | 'error' | 'info') => void;
}

const ToastContext = createContext<ToastContextType>({ showToast: () => {} });

export const useToast = () => useContext(ToastContext);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((title: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev.slice(-3), { id, title, type }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3600);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border text-sm font-medium transition-all ${
              t.type === 'success'
                ? 'bg-emerald-600 text-white border-emerald-500'
                : t.type === 'error'
                ? 'bg-rose-600 text-white border-rose-500'
                : 'bg-slate-900 dark:bg-slate-800 text-white border-slate-700'
            }`}
          >
            {t.type === 'success' && <CheckCircle2 className="w-4 h-4 shrink-0" />}
            {t.type === 'error' && <AlertCircle className="w-4 h-4 shrink-0" />}
            {t.type === 'info' && <Info className="w-4 h-4 shrink-0" />}
            <span className="flex-1 leading-snug">{t.title}</span>
            <button
              onClick={() => setToasts((prev) => prev.filter((item) => item.id !== t.id))}
              className="p-1 rounded-lg hover:bg-white/15"
              aria-label="Tutup notifikasi"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
