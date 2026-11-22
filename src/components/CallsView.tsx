import React, { useState } from 'react';
import { Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Plus, Search, Video, X } from 'lucide-react';
import type { CallRecord, Contact } from '../types/chat';
import { Avatar } from './PKLogo';

interface CallsViewProps {
  calls: CallRecord[];
  contacts: Contact[];
  myUid: string;
  onStartCall: (peerUid: string, peerName: string, peerPhoto: string | undefined, type: 'audio' | 'video') => void;
}

export const CallsView: React.FC<CallsViewProps> = ({ calls, contacts, myUid, onStartCall }) => {
  const [filter, setFilter] = useState<'all' | 'missed'>('all');
  const [showNewCallModal, setShowNewCallModal] = useState(false);
  const [contactSearch, setContactSearch] = useState('');

  const formatTime = (ts: any) => {
    if (!ts) return '';
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const filteredCalls = calls.filter((c) => {
    if (filter === 'missed') {
      return c.status === 'missed' || c.status === 'rejected';
    }
    return true;
  });

  const filteredContacts = contacts.filter(
    (c) =>
      c.aliasName.toLowerCase().includes(contactSearch.toLowerCase()) ||
      c.username.toLowerCase().includes(contactSearch.toLowerCase())
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-white dark:bg-[#111820]">
      <div className="p-4 sm:p-6 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
            Riwayat Panggilan
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Panggilan suara dan video WebRTC terenkripsi antar pengguna PK Chat.
          </p>
        </div>
        <button
          onClick={() => setShowNewCallModal(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors"
        >
          <Plus className="w-4 h-4" />
          Panggilan Baru
        </button>
      </div>

      <div className="px-4 sm:px-6 py-2.5 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2 bg-slate-50 dark:bg-[#0E151B]">
        {[
          { id: 'all', label: 'Semua' },
          { id: 'missed', label: 'Tak Terjawab' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id as 'all' | 'missed')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              filter === tab.id
                ? 'bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 shadow-2xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {filteredCalls.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center mb-4">
            <Phone className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            {filter === 'missed' ? 'Tidak Ada Panggilan Tak Terjawab' : 'Belum Ada Riwayat Panggilan'}
          </h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 max-w-xs">
            Ketuk tombol Panggilan Baru atau buka percakapan pribadi untuk memulai panggilan suara/video.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-slate-800/80 pb-20 lg:pb-6">
          {filteredCalls.map((c) => {
            const isOutgoing = c.callerUid === myUid;
            const peerUid = isOutgoing ? c.calleeUid : c.callerUid;
            const peerName = isOutgoing ? c.calleeName : c.callerName;
            const peerPhoto = isOutgoing ? c.calleePhoto : c.callerPhoto;
            const isMissed = c.status === 'missed' || c.status === 'rejected';

            return (
              <div
                key={c.id}
                className="flex items-center gap-3.5 px-4 sm:px-6 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
              >
                <Avatar name={peerName} src={peerPhoto} size="md" />
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-semibold truncate ${isMissed && !isOutgoing ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'}`}>
                    {peerName}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {isMissed ? (
                      <PhoneMissed className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                    ) : isOutgoing ? (
                      <PhoneOutgoing className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    ) : (
                      <PhoneIncoming className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    )}
                    <span>
                      {isMissed
                        ? isOutgoing
                          ? 'Tidak terjawab'
                          : 'Panggilan tak terjawab'
                        : isOutgoing
                        ? 'Keluar'
                        : 'Masuk'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-num">{formatTime(c.startedAt)}</span>
                    {c.durationSeconds > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-num">{c.durationSeconds}d</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onStartCall(peerUid, peerName, peerPhoto, 'audio')}
                    className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 transition-colors"
                    aria-label={`Panggilan suara ke ${peerName}`}
                  >
                    <Phone className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => onStartCall(peerUid, peerName, peerPhoto, 'video')}
                    className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 transition-colors"
                    aria-label={`Panggilan video ke ${peerName}`}
                  >
                    <Video className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showNewCallModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-[#111820] border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Pilih Kontak untuk Panggilan
              </h3>
              <button onClick={() => setShowNewCallModal(false)} className="p-1 text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={contactSearch}
                onChange={(e) => setContactSearch(e.target.value)}
                placeholder="Cari kontak..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
              />
            </div>
            <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {filteredContacts.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-500">
                  Belum ada kontak. Tambahkan kontak di tab Komunitas terlebih dahulu.
                </p>
              ) : (
                filteredContacts.map((c) => (
                  <div key={c.contactUid} className="flex items-center gap-3 py-2.5">
                    <Avatar name={c.aliasName} src={c.photoURL} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{c.aliasName}</div>
                      <div className="text-xs text-slate-500">@{c.username}</div>
                    </div>
                    <button
                      onClick={() => {
                        setShowNewCallModal(false);
                        onStartCall(c.contactUid, c.aliasName, c.photoURL, 'audio');
                      }}
                      className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600"
                      title="Panggilan Suara"
                    >
                      <Phone className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        setShowNewCallModal(false);
                        onStartCall(c.contactUid, c.aliasName, c.photoURL, 'video');
                      }}
                      className="p-2 rounded-xl bg-emerald-600 text-white"
                      title="Panggilan Video"
                    >
                      <Video className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
