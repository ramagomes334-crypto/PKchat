import React, { useEffect, useRef, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from 'lucide-react';
import { db } from '../lib/firebase';
import { playNotificationChime, sendCallSignal, updateCallDoc } from '../lib/chatService';
import { Avatar } from './PKLogo';
import { useToast } from './ToastProvider';

export interface ActiveCallSession {
  callId: string;
  direction: 'outgoing' | 'incoming';
  callType: 'audio' | 'video';
  peerUid: string;
  peerName: string;
  peerPhoto?: string;
  status: 'ringing' | 'active';
}

interface CallOverlayProps {
  session: ActiveCallSession | null;
  myUid: string;
  myName: string;
  myPhoto?: string;
  onUpdateStatus: (status: 'active') => void;
  onClose: () => void;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export const CallOverlay: React.FC<CallOverlayProps> = ({
  session,
  myUid,
  onUpdateStatus,
  onClose,
}) => {
  const { showToast } = useToast();
  const [micMuted, setMicMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const seenSignalsRef = useRef<Set<string>>(new Set());
  const offerSentRef = useRef(false);
  const closingRef = useRef(false);

  const cleanupMedia = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    pendingCandidates.current = [];
    seenSignalsRef.current.clear();
    offerSentRef.current = false;
  };

  const setupPeerConnection = async (isVideo: boolean, targetUid: string, callId: string) => {
    if (pcRef.current) return pcRef.current;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: isVideo,
    });
    localStreamRef.current = stream;
    if (localVideoRef.current && isVideo) {
      localVideoRef.current.srcObject = stream;
    }

    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcRef.current = pc;

    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendCallSignal({
          callId,
          senderUid: myUid,
          targetUid,
          type: 'ice-candidate',
          payload: event.candidate.toJSON(),
        });
      }
    };

    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (remoteVideoRef.current && isVideo) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStream;
      }
    };

    return pc;
  };

  useEffect(() => {
    if (!session) {
      cleanupMedia();
      closingRef.current = false;
      setElapsed(0);
      return;
    }

    closingRef.current = false;
    let ringInterval: number | undefined;
    let missTimeout: number | undefined;
    if (session.status === 'ringing') {
      if (session.direction === 'incoming') {
        playNotificationChime('call');
        ringInterval = window.setInterval(() => playNotificationChime('call'), 3200);
      }
      missTimeout = window.setTimeout(() => {
        if (!closingRef.current) {
          closingRef.current = true;
          updateCallDoc(session.callId, 'missed', 0);
          cleanupMedia();
          onClose();
          showToast('Panggilan tidak terjawab', 'info');
        }
      }, 45000);
    }

    const unsubCallDoc = onSnapshot(
      doc(db, 'calls', session.callId),
      async (snap) => {
        if (!snap.exists() || closingRef.current) return;
        const data = snap.data() as { status?: string };

        if (data.status === 'active' && session.direction === 'outgoing' && !offerSentRef.current) {
          offerSentRef.current = true;
          try {
            onUpdateStatus('active');
            const pc = await setupPeerConnection(
              session.callType === 'video',
              session.peerUid,
              session.callId
            );
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            await sendCallSignal({
              callId: session.callId,
              senderUid: myUid,
              targetUid: session.peerUid,
              type: 'offer',
              payload: offer,
            });
          } catch {
            showToast('Gagal mengakses mikrofon atau kamera', 'error');
            handleHangup('ended');
          }
        }

        if (
          (data.status === 'rejected' || data.status === 'ended' || data.status === 'missed') &&
          !closingRef.current
        ) {
          closingRef.current = true;
          cleanupMedia();
          onClose();
          showToast(
            data.status === 'rejected'
              ? 'Panggilan ditolak'
              : data.status === 'missed'
              ? 'Panggilan tidak terjawab'
              : 'Panggilan berakhir',
            'info'
          );
        }
      },
      () => {}
    );

    const unsubSignals = onSnapshot(
      query(collection(db, 'calls', session.callId, 'signals'), where('targetUid', '==', myUid)),
      async (snap) => {
        const ordered = snap.docs
          .map((d) => d.data() as {
            id: string;
            type: 'offer' | 'answer' | 'ice-candidate';
            payload: string;
            createdAt?: { toMillis?: () => number };
          })
          .sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));

        for (const sig of ordered) {
          if (seenSignalsRef.current.has(sig.id)) continue;
          seenSignalsRef.current.add(sig.id);
          try {
            const parsed = JSON.parse(sig.payload);
            if (sig.type === 'offer') {
              const pc = await setupPeerConnection(
                session.callType === 'video',
                session.peerUid,
                session.callId
              );
              await pc.setRemoteDescription(new RTCSessionDescription(parsed));
              for (const cand of pendingCandidates.current) {
                await pc.addIceCandidate(new RTCIceCandidate(cand));
              }
              pendingCandidates.current = [];
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              await sendCallSignal({
                callId: session.callId,
                senderUid: myUid,
                targetUid: session.peerUid,
                type: 'answer',
                payload: answer,
              });
            } else if (sig.type === 'answer' && pcRef.current && !pcRef.current.currentRemoteDescription) {
              await pcRef.current.setRemoteDescription(new RTCSessionDescription(parsed));
              for (const cand of pendingCandidates.current) {
                await pcRef.current.addIceCandidate(new RTCIceCandidate(cand));
              }
              pendingCandidates.current = [];
            } else if (sig.type === 'ice-candidate') {
              if (pcRef.current && pcRef.current.remoteDescription) {
                await pcRef.current.addIceCandidate(new RTCIceCandidate(parsed));
              } else {
                pendingCandidates.current.push(parsed);
              }
            }
          } catch {
            // Ignore stale or malformed signaling frame
          }
        }
      },
      () => {}
    );

    return () => {
      unsubCallDoc();
      unsubSignals();
      if (ringInterval) clearInterval(ringInterval);
      if (missTimeout) clearTimeout(missTimeout);
    };
  }, [session?.callId, session?.direction, session?.status]);

  useEffect(() => {
    if (!session || session.status !== 'active') return;
    const timer = window.setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [session?.status]);

  if (!session) return null;

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const handleAccept = async () => {
    try {
      await setupPeerConnection(session.callType === 'video', session.peerUid, session.callId);
      onUpdateStatus('active');
      await updateCallDoc(session.callId, 'active', 0);
    } catch {
      showToast('Izin mikrofon/kamera ditolak oleh browser', 'error');
      handleHangup('ended');
    }
  };

  const handleReject = async () => {
    closingRef.current = true;
    await updateCallDoc(session.callId, 'rejected', 0);
    cleanupMedia();
    onClose();
  };

  const handleHangup = async (endStatus: 'ended' | 'missed' = 'ended') => {
    closingRef.current = true;
    const finalStatus = session.status === 'ringing' && session.direction === 'outgoing' ? 'missed' : endStatus;
    await updateCallDoc(session.callId, finalStatus, elapsed);
    cleanupMedia();
    onClose();
  };

  const toggleMic = () => {
    if (!localStreamRef.current) return;
    localStreamRef.current.getAudioTracks().forEach((t) => {
      t.enabled = micMuted;
    });
    setMicMuted(!micMuted);
  };

  const toggleCam = () => {
    if (!localStreamRef.current) return;
    localStreamRef.current.getVideoTracks().forEach((t) => {
      t.enabled = camOff;
    });
    setCamOff(!camOff);
  };

  return (
    <div className="fixed inset-0 z-[90] bg-slate-950/95 backdrop-blur-md flex flex-col items-center justify-between p-6 text-white">
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

      <div className="text-center mt-4">
        <div className="text-xs font-medium text-emerald-400">
          {session.callType === 'video' ? 'Panggilan Video Terenkripsi' : 'Panggilan Suara Terenkripsi'}
        </div>
        <h2 className="mt-1 text-2xl font-display font-bold">{session.peerName}</h2>
        <p className="mt-1 text-sm text-slate-300 font-mono-num">
          {session.status === 'ringing'
            ? session.direction === 'incoming'
              ? 'Panggilan masuk...'
              : 'Memanggil...'
            : formatDuration(elapsed)}
        </p>
      </div>

      <div className="relative w-full max-w-2xl flex-1 my-6 flex items-center justify-center rounded-3xl overflow-hidden bg-slate-900 border border-slate-800">
        {session.callType === 'video' && session.status === 'active' ? (
          <>
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="absolute bottom-4 right-4 w-28 sm:w-36 aspect-[3/4] rounded-2xl object-cover border-2 border-emerald-500 shadow-lg bg-slate-800"
            />
          </>
        ) : (
          <div className="flex flex-col items-center justify-center gap-4">
            <Avatar name={session.peerName} src={session.peerPhoto} size="xl" />
            <span className="text-xs text-slate-400">
              {session.status === 'ringing' ? 'Menghubungkan WebRTC...' : 'Audio aktif'}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-4 mb-4">
        {session.direction === 'incoming' && session.status === 'ringing' ? (
          <>
            <button
              onClick={handleReject}
              className="w-14 h-14 rounded-full bg-rose-600 hover:bg-rose-700 flex items-center justify-center transition-colors shadow-lg"
              aria-label="Tolak panggilan"
            >
              <PhoneOff className="w-6 h-6" />
            </button>
            <button
              onClick={handleAccept}
              className="w-14 h-14 rounded-full bg-emerald-600 hover:bg-emerald-700 flex items-center justify-center transition-colors shadow-lg"
              aria-label="Terima panggilan"
            >
              <Phone className="w-6 h-6" />
            </button>
          </>
        ) : (
          <>
            <button
              onClick={toggleMic}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
                micMuted ? 'bg-rose-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-white'
              }`}
              aria-label={micMuted ? 'Nyalakan mikrofon' : 'Bisukan mikrofon'}
            >
              {micMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
            {session.callType === 'video' && (
              <button
                onClick={toggleCam}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
                  camOff ? 'bg-rose-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-white'
                }`}
                aria-label={camOff ? 'Nyalakan kamera' : 'Matikan kamera'}
              >
                {camOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
              </button>
            )}
            <button
              onClick={() => handleHangup('ended')}
              className="w-14 h-14 rounded-full bg-rose-600 hover:bg-rose-700 flex items-center justify-center transition-colors shadow-lg"
              aria-label="Akhiri panggilan"
            >
              <PhoneOff className="w-6 h-6" />
            </button>
          </>
        )}
      </div>
    </div>
  );
};
