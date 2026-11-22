// Client-side End-to-End Encryption (ECDH P-256 + AES-GCM 256) via WebCrypto + IndexedDB key storage

const DB_NAME = 'pk_chat_keys_db';
const STORE_NAME = 'keypairs';

function openKeyDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getStoredPrivateKey(uid: string): Promise<CryptoKey | null> {
  try {
    const db = await openKeyDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(`priv_${uid}`);
      req.onsuccess = () => resolve((req.result as CryptoKey) || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function storePrivateKey(uid: string, key: CryptoKey): Promise<void> {
  const db = await openKeyDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(key, `priv_${uid}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function ensureE2EEKeyPair(uid: string): Promise<string | null> {
  if (!window.crypto?.subtle) return null;
  try {
    const existingPriv = await getStoredPrivateKey(uid);
    const cachedPub = localStorage.getItem(`pk_e2ee_pub_${uid}`);
    if (existingPriv && cachedPub) {
      return cachedPub;
    }

    const keyPair = await window.crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveKey']
    );

    const spki = await window.crypto.subtle.exportKey('spki', keyPair.publicKey);
    const pubB64 = btoa(String.fromCharCode(...new Uint8Array(spki)));
    await storePrivateKey(uid, keyPair.privateKey);
    localStorage.setItem(`pk_e2ee_pub_${uid}`, pubB64);
    return pubB64;
  } catch {
    return null;
  }
}

async function deriveSharedAesKey(myUid: string, peerPublicKeyB64: string): Promise<CryptoKey | null> {
  try {
    const privKey = await getStoredPrivateKey(myUid);
    if (!privKey) return null;
    const raw = Uint8Array.from(atob(peerPublicKeyB64), (c) => c.charCodeAt(0));
    const peerPub = await window.crypto.subtle.importKey(
      'spki',
      raw,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      []
    );
    return await window.crypto.subtle.deriveKey(
      { name: 'ECDH', public: peerPub },
      privKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  } catch {
    return null;
  }
}

export async function encryptMessageText(
  myUid: string,
  peerPublicKeyB64: string | undefined,
  plaintext: string
): Promise<{ encryptedPayload?: string; iv?: string }> {
  if (!peerPublicKeyB64 || !window.crypto?.subtle) return {};
  const aesKey = await deriveSharedAesKey(myUid, peerPublicKeyB64);
  if (!aesKey) return {};
  const ivBytes = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipher = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ivBytes },
    aesKey,
    encoded
  );
  return {
    encryptedPayload: btoa(String.fromCharCode(...new Uint8Array(cipher))),
    iv: btoa(String.fromCharCode(...ivBytes)),
  };
}

export async function decryptMessageText(
  myUid: string,
  peerPublicKeyB64: string | undefined,
  encryptedPayload?: string,
  ivB64?: string
): Promise<string | null> {
  if (!peerPublicKeyB64 || !encryptedPayload || !ivB64 || !window.crypto?.subtle) return null;
  try {
    const aesKey = await deriveSharedAesKey(myUid, peerPublicKeyB64);
    if (!aesKey) return null;
    const ivBytes = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
    const cipherBytes = Uint8Array.from(atob(encryptedPayload), (c) => c.charCodeAt(0));
    const plain = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBytes },
      aesKey,
      cipherBytes
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

export async function computeSafetyCode(pubA?: string, pubB?: string): Promise<string> {
  if (!pubA || !pubB || !window.crypto?.subtle) return '00000 00000 00000 00000';
  const combined = [pubA, pubB].sort().join(':');
  const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(combined));
  const bytes = new Uint8Array(digest);
  const digits = Array.from(bytes.slice(0, 15))
    .map((b) => String(b).padStart(3, '0').slice(-2))
    .join('');
  return digits.match(/.{1,5}/g)?.slice(0, 6).join(' ') || '';
}
