import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { WebSocketServer, WebSocket } from 'ws';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

dotenv.config();

const firebaseConfig = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'firebase-applet-config.json'), 'utf8')
) as { projectId: string };

if (!getApps().length) {
  initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

const adminAuth = getAuth();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

app.use(express.json({ limit: '25mb' }));

// Security headers for uploaded files
app.use('/uploads', (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  next();
}, express.static(UPLOAD_DIR));

interface AuthReq extends express.Request {
  uid?: string;
  email?: string;
}

const requireFirebaseAuth = async (req: AuthReq, res: express.Response, next: express.NextFunction) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Autentikasi diperlukan' });
  }
  const token = header.slice(7).trim();
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    req.uid = decoded.uid;
    req.email = decoded.email;
    next();
  } catch {
    return res.status(401).json({ error: 'Token sesi tidak valid atau kedaluwarsa' });
  }
};

// --- Allowed MIME types for media uploads ---
const MIME_EXT_MAP: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/wav': '.wav',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'application/zip': '.zip',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
};

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'pk-chat' });
});

// Media upload endpoint
app.post('/api/upload', requireFirebaseAuth, async (req: AuthReq, res) => {
  try {
    const { filename, mimeType, dataBase64 } = req.body as {
      filename?: string;
      mimeType?: string;
      dataBase64?: string;
    };

    if (!mimeType || !dataBase64) {
      return res.status(400).json({ error: 'Data media tidak lengkap' });
    }

    const baseMime = mimeType.split(';')[0].trim().toLowerCase();
    const ext = MIME_EXT_MAP[baseMime];
    if (!ext) {
      return res.status(400).json({ error: `Tipe file ${baseMime} tidak didukung` });
    }

    const cleanBase64 = dataBase64.includes(',') ? dataBase64.split(',')[1] : dataBase64;
    const buffer = Buffer.from(cleanBase64, 'base64');
    if (buffer.length === 0 || buffer.length > 18 * 1024 * 1024) {
      return res.status(400).json({ error: 'Ukuran file maksimal 18 MB' });
    }

    const safeFileName = `${crypto.randomUUID()}${ext}`;
    const resolvedPath = path.resolve(UPLOAD_DIR, safeFileName);
    if (!resolvedPath.startsWith(UPLOAD_DIR + path.sep)) {
      return res.status(400).json({ error: 'Path file tidak valid' });
    }

    await fs.promises.writeFile(resolvedPath, buffer);
    const originalName = (filename || `file${ext}`).replace(/[^\w.\- ]+/g, '_').slice(0, 120);

    res.json({
      url: `/uploads/${safeFileName}`,
      name: originalName,
      mimeType: baseMime,
      size: buffer.length,
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Gagal mengunggah file ke server' });
  }
});

// Scrypt password / PIN hashing
app.post('/api/security/hash-password', requireFirebaseAuth, (req: AuthReq, res) => {
  const { password } = req.body as { password?: string };
  if (!password || password.length < 6 || password.length > 128) {
    return res.status(400).json({ error: 'Kata sandi harus 6–128 karakter' });
  }
  const salt = crypto.randomBytes(16).toString('hex');
  crypto.scrypt(password, salt, 64, (err, derivedKey) => {
    if (err) return res.status(500).json({ error: 'Gagal mengenkripsi kata sandi' });
    res.json({ passwordHash: `${salt}:${derivedKey.toString('hex')}` });
  });
});

app.post('/api/security/verify-password', requireFirebaseAuth, (req: AuthReq, res) => {
  const { password, passwordHash } = req.body as { password?: string; passwordHash?: string };
  if (!password || !passwordHash || !passwordHash.includes(':')) {
    return res.status(400).json({ valid: false });
  }
  const [salt, keyHex] = passwordHash.split(':');
  crypto.scrypt(password, salt, 64, (err, derivedKey) => {
    if (err) return res.status(500).json({ valid: false });
    const storedBuf = Buffer.from(keyHex, 'hex');
    const valid = storedBuf.length === derivedKey.length && crypto.timingSafeEqual(storedBuf, derivedKey);
    res.json({ valid });
  });
});

// --- WebSocket Server for Real-time Presence, Typing & WebRTC Signaling ---
interface AuthenticatedWS extends WebSocket {
  uid?: string;
  isAlive?: boolean;
}

const userSockets = new Map<string, Set<AuthenticatedWS>>();

function sendToUser(uid: string, payload: unknown) {
  const sockets = userSockets.get(uid);
  if (!sockets) return;
  const raw = JSON.stringify(payload);
  for (const sock of sockets) {
    if (sock.readyState === WebSocket.OPEN) {
      sock.send(raw);
    }
  }
}

function broadcastPresence(uid: string, online: boolean) {
  const msg = JSON.stringify({ type: 'presence', uid, online, ts: Date.now() });
  for (const [, sockets] of userSockets) {
    for (const sock of sockets) {
      if (sock.readyState === WebSocket.OPEN && sock.uid !== uid) {
        sock.send(msg);
      }
    }
  }
}

async function startServer() {
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const urlPath = request.url?.split('?')[0];
    if (urlPath === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else if (urlPath !== '/__vite_ws') {
      socket.destroy();
    }
  });

  wss.on('connection', (ws: AuthenticatedWS) => {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'auth' && typeof msg.token === 'string') {
          const decoded = await adminAuth.verifyIdToken(msg.token);
          ws.uid = decoded.uid;
          if (!userSockets.has(decoded.uid)) {
            userSockets.set(decoded.uid, new Set());
          }
          userSockets.get(decoded.uid)!.add(ws);
          ws.send(JSON.stringify({
            type: 'auth:ok',
            uid: decoded.uid,
            onlineUsers: Array.from(userSockets.keys()),
          }));
          broadcastPresence(decoded.uid, true);
          return;
        }

        if (!ws.uid) return;

        // Typing indicator
        if (msg.type === 'typing' && typeof msg.convId === 'string' && Array.isArray(msg.targetUids)) {
          for (const targetUid of msg.targetUids) {
            if (typeof targetUid === 'string' && targetUid !== ws.uid) {
              sendToUser(targetUid, {
                type: 'typing',
                convId: msg.convId,
                uid: ws.uid,
                displayName: msg.displayName || '',
                isTyping: Boolean(msg.isTyping),
              });
            }
          }
          return;
        }

        // WebRTC Call Signaling
        if (
          typeof msg.type === 'string' &&
          msg.type.startsWith('call:') &&
          typeof msg.targetUid === 'string'
        ) {
          sendToUser(msg.targetUid, {
            ...msg,
            fromUid: ws.uid,
          });
          return;
        }

        // Instant ping/notification
        if (msg.type === 'notify:ping' && Array.isArray(msg.targetUids)) {
          for (const targetUid of msg.targetUids) {
            if (typeof targetUid === 'string' && targetUid !== ws.uid) {
              sendToUser(targetUid, {
                type: 'notify:ping',
                fromUid: ws.uid,
                title: msg.title,
                body: msg.body,
                convId: msg.convId,
              });
            }
          }
        }
      } catch {
        // Ignore malformed socket frames
      }
    });

    ws.on('close', () => {
      if (ws.uid) {
        const set = userSockets.get(ws.uid);
        if (set) {
          set.delete(ws);
          if (set.size === 0) {
            userSockets.delete(ws.uid);
            broadcastPresence(ws.uid, false);
          }
        }
      }
    });
  });

  // Heartbeat interval to clean stale sockets
  const interval = setInterval(() => {
    wss.clients.forEach((client) => {
      const ws = client as AuthenticatedWS;
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(interval));

  if (process.env.NODE_ENV !== 'production') {
    process.env.DISABLE_HMR = process.env.DISABLE_HMR ?? 'true';
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: {
          server,
          path: '/__vite_ws',
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`PK Chat server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
