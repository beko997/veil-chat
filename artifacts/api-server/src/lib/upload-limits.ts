const DEFAULT_MAX_UPLOAD_SIZE_MB = 10;
const BYTES_PER_MB = 1024 * 1024;
const ENCRYPTED_MEDIA_OVERHEAD_BYTES = 103;

export function getMaxUploadSizeMb(): number {
  const rawValue = process.env["MAX_UPLOAD_SIZE_MB"]?.trim();
  if (!rawValue) return DEFAULT_MAX_UPLOAD_SIZE_MB;

  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("MAX_UPLOAD_SIZE_MB must be a finite number greater than 0.");
  }

  return value;
}

export function getMaxUploadSizeBytes(): number {
  const bytes = getMaxUploadSizeMb() * BYTES_PER_MB;
  if (!Number.isSafeInteger(Math.floor(bytes))) {
    throw new Error("MAX_UPLOAD_SIZE_MB is too large.");
  }
  return Math.floor(bytes);
}

export function getMaxEncryptedMediaBytes(): number {
  return getMaxUploadSizeBytes() + ENCRYPTED_MEDIA_OVERHEAD_BYTES;
}

export function getMaxUploadRequestBodyBytes(): number {
  // The request uses base64 JSON, which expands the file by about 4/3. Leave
  // additional room for the encrypted message envelope and JSON properties.
  return Math.ceil(getMaxEncryptedMediaBytes() * (4 / 3) + 1024 * 1024);
}
