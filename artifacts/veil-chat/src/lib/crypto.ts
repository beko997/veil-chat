const ROOM_KEY_PREFIX = "ecdh1.";
const TEXT_ENVELOPE_PREFIX = "ecdh-p256-v1:";
const MEDIA_ENVELOPE_MAGIC = new TextEncoder().encode("VEIL-ECDH1");
const ECDH_ALGORITHM: EcKeyGenParams = {
  name: "ECDH",
  namedCurve: "P-256",
};

export type RoomCryptoKey =
  | { version: 1; aesKey: CryptoKey }
  | { version: 2; privateKey: CryptoKey; publicKey: CryptoKey };

export function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length))));
  }
  return btoa(chunks.join(""));
}

function bytesToBase64(bytes: Uint8Array): string {
  return bufferToBase64(bytes.slice().buffer as ArrayBuffer);
}

export function base64ToBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function base64UrlToBuffer(value: string): ArrayBuffer {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  return base64ToBuffer(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
}

export async function generateRoomKey(): Promise<string> {
  const pair = (await crypto.subtle.generateKey(
    ECDH_ALGORITHM,
    true,
    ["deriveKey"],
  )) as CryptoKeyPair;
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const encodedPrivateKey = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(privateJwk)),
  );
  return `${ROOM_KEY_PREFIX}${encodedPrivateKey}`;
}

export async function importRoomKey(value: string): Promise<RoomCryptoKey> {
  if (value.startsWith(ROOM_KEY_PREFIX)) {
    const encodedPrivateKey = value.slice(ROOM_KEY_PREFIX.length);
    const privateJwk = JSON.parse(
      new TextDecoder().decode(base64UrlToBuffer(encodedPrivateKey)),
    ) as JsonWebKey;

    if (
      privateJwk.kty !== "EC" ||
      privateJwk.crv !== "P-256" ||
      !privateJwk.d ||
      !privateJwk.x ||
      !privateJwk.y
    ) {
      throw new Error("Oda özel anahtarı geçersiz.");
    }

    const publicJwk: JsonWebKey = {
      kty: "EC",
      crv: "P-256",
      x: privateJwk.x,
      y: privateJwk.y,
      ext: true,
    };
    const [privateKey, publicKey] = await Promise.all([
      crypto.subtle.importKey(
        "jwk",
        privateJwk,
        ECDH_ALGORITHM,
        false,
        ["deriveKey"],
      ),
      crypto.subtle.importKey(
        "jwk",
        publicJwk,
        ECDH_ALGORITHM,
        false,
        [],
      ),
    ]);

    return { version: 2, privateKey, publicKey };
  }

  // Existing invite links use a shared AES key. Keep them readable.
  const aesKey = await crypto.subtle.importKey(
    "raw",
    base64ToBuffer(value),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  return { version: 1, aesKey };
}

async function createEphemeralEncryptionKey(publicKey: CryptoKey) {
  const pair = (await crypto.subtle.generateKey(
    ECDH_ALGORITHM,
    true,
    ["deriveKey"],
  )) as CryptoKeyPair;
  const key = await crypto.subtle.deriveKey(
    { name: "ECDH", public: publicKey },
    pair.privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const ephemeralPublicKey = await crypto.subtle.exportKey("raw", pair.publicKey);
  return { key, ephemeralPublicKey };
}

async function createEphemeralDecryptionKey(
  privateKey: CryptoKey,
  ephemeralPublicKey: ArrayBuffer,
): Promise<CryptoKey> {
  const publicKey = await crypto.subtle.importKey(
    "raw",
    ephemeralPublicKey,
    ECDH_ALGORITHM,
    false,
    [],
  );
  return crypto.subtle.deriveKey(
    { name: "ECDH", public: publicKey },
    privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
}

export async function encryptText(
  roomKey: RoomCryptoKey,
  text: string,
): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(text);

  if (roomKey.version === 1) {
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      roomKey.aesKey,
      plaintext,
    );
    return { ciphertext: bufferToBase64(ciphertext), iv: bytesToBase64(iv) };
  }

  const { key, ephemeralPublicKey } = await createEphemeralEncryptionKey(
    roomKey.publicKey,
  );
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext,
  );
  return {
    ciphertext: `${TEXT_ENVELOPE_PREFIX}${bufferToBase64(ephemeralPublicKey)}:${bufferToBase64(encrypted)}`,
    iv: bytesToBase64(iv),
  };
}

export async function decryptText(
  roomKey: RoomCryptoKey,
  ciphertext: string,
  iv: string,
): Promise<string | null> {
  try {
    const ivBytes = new Uint8Array(base64ToBuffer(iv));
    let plain: ArrayBuffer;

    if (ciphertext.startsWith(TEXT_ENVELOPE_PREFIX)) {
      if (roomKey.version !== 2) return null;
      const envelope = ciphertext.slice(TEXT_ENVELOPE_PREFIX.length);
      const separator = envelope.indexOf(":");
      if (separator < 1 || separator === envelope.length - 1) return null;
      const ephemeralPublicKey = base64ToBuffer(envelope.slice(0, separator));
      const encrypted = base64ToBuffer(envelope.slice(separator + 1));
      const key = await createEphemeralDecryptionKey(
        roomKey.privateKey,
        ephemeralPublicKey,
      );
      plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: ivBytes },
        key,
        encrypted,
      );
    } else {
      if (roomKey.version !== 1) return null;
      plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: ivBytes },
        roomKey.aesKey,
        base64ToBuffer(ciphertext),
      );
    }

    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

export async function encryptMedia(
  roomKey: RoomCryptoKey,
  data: ArrayBuffer,
): Promise<ArrayBuffer> {
  const iv = crypto.getRandomValues(new Uint8Array(12));

  if (roomKey.version === 1) {
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      roomKey.aesKey,
      data,
    );
    const packed = new Uint8Array(iv.byteLength + encrypted.byteLength);
    packed.set(iv, 0);
    packed.set(new Uint8Array(encrypted), iv.byteLength);
    return packed.buffer;
  }

  const { key, ephemeralPublicKey } = await createEphemeralEncryptionKey(
    roomKey.publicKey,
  );
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    data,
  );
  const ephemeralBytes = new Uint8Array(ephemeralPublicKey);
  const packed = new Uint8Array(
    MEDIA_ENVELOPE_MAGIC.byteLength +
      ephemeralBytes.byteLength +
      iv.byteLength +
      encrypted.byteLength,
  );
  let offset = 0;
  packed.set(MEDIA_ENVELOPE_MAGIC, offset);
  offset += MEDIA_ENVELOPE_MAGIC.byteLength;
  packed.set(ephemeralBytes, offset);
  offset += ephemeralBytes.byteLength;
  packed.set(iv, offset);
  offset += iv.byteLength;
  packed.set(new Uint8Array(encrypted), offset);
  return packed.buffer;
}

function hasMediaEnvelope(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= MEDIA_ENVELOPE_MAGIC.byteLength &&
    MEDIA_ENVELOPE_MAGIC.every((byte, index) => bytes[index] === byte)
  );
}

export async function decryptMedia(
  roomKey: RoomCryptoKey,
  packed: ArrayBuffer,
): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(packed);

  if (hasMediaEnvelope(bytes)) {
    if (roomKey.version !== 2) {
      throw new Error("Bu dosya farklı bir oda anahtarıyla şifrelenmiş.");
    }
    const minimumLength =
      MEDIA_ENVELOPE_MAGIC.byteLength + 65 + 12 + 16;
    if (bytes.byteLength < minimumLength) {
      throw new Error("Şifreli medya verisi geçersiz.");
    }

    let offset = MEDIA_ENVELOPE_MAGIC.byteLength;
    const ephemeralPublicKey = bytes.slice(offset, offset + 65).buffer;
    offset += 65;
    const iv = bytes.slice(offset, offset + 12);
    offset += 12;
    const encrypted = bytes.slice(offset);
    const key = await createEphemeralDecryptionKey(
      roomKey.privateKey,
      ephemeralPublicKey,
    );
    return crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted);
  }

  // Existing media envelopes are AES-GCM IV || ciphertext || tag.
  if (roomKey.version !== 1 || bytes.byteLength < 29) {
    throw new Error("Şifreli medya verisi geçersiz.");
  }
  const iv = bytes.slice(0, 12);
  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    roomKey.aesKey,
    bytes.slice(12),
  );
}

export function getAnonymousId(): string {
  const storageKey = "veil-anonymous-id";
  let id = sessionStorage.getItem(storageKey);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(storageKey, id);
  }
  return id;
}

export function kindForMime(mime: string): "image" | "video" | "file" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "file";
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
