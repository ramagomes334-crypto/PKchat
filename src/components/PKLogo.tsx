import React, { useState } from 'react';

export const PKLogo: React.FC<{ size?: number; showWordmark?: boolean }> = ({
  size = 34,
  showWordmark = true,
}) => {
  return (
    <div className="inline-flex items-center gap-2.5 shrink-0 select-none">
      <div
        style={{ width: size, height: size }}
        className="shrink-0 rounded-xl overflow-hidden bg-[#f2f3f5] border border-slate-200/80 dark:border-slate-700/80 shadow-sm flex items-center justify-center"
      >
        <img
          src="/assets/aistudio/images__6__876dff34.jpeg"
          alt="PK Chat Logo"
          className="w-full h-full object-cover scale-[2.15]"
        />
      </div>
      {showWordmark && (
        <span className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap">
          PK Chat
        </span>
      )}
    </div>
  );
};

const AVATAR_TONES = [
  'bg-emerald-600 text-white',
  'bg-teal-600 text-white',
  'bg-slate-700 text-white',
  'bg-cyan-700 text-white',
  'bg-amber-600 text-white',
  'bg-indigo-600 text-white',
];

function pickTone(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
}

export const Avatar: React.FC<{
  name: string;
  src?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  online?: boolean;
  isGroup?: boolean;
}> = ({ name, src, size = 'md', online, isGroup }) => {
  const [imgError, setImgError] = useState(false);

  const dims: Record<string, string> = {
    xs: 'w-7 h-7 text-xs',
    sm: 'w-9 h-9 text-xs',
    md: 'w-11 h-11 text-sm',
    lg: 'w-14 h-14 text-lg',
    xl: 'w-20 h-20 text-2xl',
  };

  const initials = (name || 'PK')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');

  return (
    <div className={`relative shrink-0 inline-flex items-center justify-center rounded-full ${dims[size]}`}>
      {src && !imgError ? (
        <img
          src={src}
          alt={name}
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          className="w-full h-full rounded-full object-cover bg-slate-200 dark:bg-slate-800"
        />
      ) : (
        <div
          className={`w-full h-full rounded-full flex items-center justify-center font-display font-semibold select-none ${
            isGroup ? 'bg-emerald-700 text-white' : pickTone(name || 'PK')
          }`}
        >
          {initials || 'PK'}
        </div>
      )}
      {online && (
        <span
          title="Online"
          className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-[#111820]"
        />
      )}
    </div>
  );
};
