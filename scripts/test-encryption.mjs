import assert from "node:assert/strict";
import {
  bufferToBase64,
  decryptMedia,
  decryptText,
  encryptMedia,
  encryptText,
  generateRoomKey,
  importRoomKey,
} from "../artifacts/veil-chat/src/lib/crypto.ts";

const inviteSecret = await generateRoomKey();
assert.match(inviteSecret, /^ecdh1\./);
const roomKey = await importRoomKey(inviteSecret);
const message = "private Veil Chat test";
const encryptedMessage = await encryptText(roomKey, message);
assert.match(encryptedMessage.ciphertext, /^ecdh-p256-v1:/);
assert.equal(encryptedMessage.ciphertext.includes(message), false);
assert.equal(
  await decryptText(roomKey, encryptedMessage.ciphertext, encryptedMessage.iv),
  message,
);

const wrongRoomKey = await importRoomKey(await generateRoomKey());
assert.equal(
  await decryptText(
    wrongRoomKey,
    encryptedMessage.ciphertext,
    encryptedMessage.iv,
  ),
  null,
);

const mediaBytes = new TextEncoder().encode("encrypted file test").buffer;
const encryptedMedia = await encryptMedia(roomKey, mediaBytes);
assert.equal(
  new TextDecoder().decode(await decryptMedia(roomKey, encryptedMedia)),
  "encrypted file test",
);
await assert.rejects(() => decryptMedia(wrongRoomKey, encryptedMedia));

const maximumPlaintextBytes = 10 * 1024 * 1024;
const maximumMedia = await encryptMedia(
  roomKey,
  new Uint8Array(maximumPlaintextBytes).buffer,
);
assert.equal(maximumMedia.byteLength, maximumPlaintextBytes + 103);

// Keep messages and files created with existing AES-only invite links readable.
const legacyRawKey = crypto.getRandomValues(new Uint8Array(32));
const legacyRoomKey = await importRoomKey(bufferToBase64(legacyRawKey.buffer));
assert.equal(legacyRoomKey.version, 1);
const legacyCiphertext = await crypto.subtle.encrypt(
  { name: "AES-GCM", iv: new Uint8Array(12) },
  legacyRoomKey.aesKey,
  new TextEncoder().encode(message),
);
assert.equal(
  await decryptText(
    legacyRoomKey,
    bufferToBase64(legacyCiphertext),
    bufferToBase64(new Uint8Array(12).buffer),
  ),
  message,
);
const legacyMedia = await encryptMedia(legacyRoomKey, mediaBytes);
assert.equal(
  new TextDecoder().decode(await decryptMedia(legacyRoomKey, legacyMedia)),
  "encrypted file test",
);

console.log("ECDH/AES-GCM and legacy AES-GCM encryption checks passed.");
