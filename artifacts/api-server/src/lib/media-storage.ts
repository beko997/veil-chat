import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export type MediaStorageProvider = "r2" | "b2";

type StorageClient = {
  client: S3Client;
  bucket: string;
};

const clients = new Map<MediaStorageProvider, StorageClient>();

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be set to use this media storage provider.`);
  }
  return value;
}

function createStorageClient(provider: MediaStorageProvider): StorageClient {
  const cached = clients.get(provider);
  if (cached) return cached;

  let endpoint: string;
  let region: string;
  let bucket: string;
  let accessKeyId: string;
  let secretAccessKey: string;

  if (provider === "r2") {
    const accountId = process.env["R2_ACCOUNT_ID"]?.trim();
    endpoint =
      process.env["R2_ENDPOINT"]?.trim() ||
      (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");
    if (!endpoint) {
      throw new Error("R2_ACCOUNT_ID or R2_ENDPOINT must be set.");
    }
    region = "auto";
    bucket = requiredEnv("R2_BUCKET");
    accessKeyId = requiredEnv("R2_ACCESS_KEY_ID");
    secretAccessKey = requiredEnv("R2_SECRET_ACCESS_KEY");
  } else {
    region = requiredEnv("B2_REGION");
    endpoint =
      process.env["B2_ENDPOINT"]?.trim() ||
      `https://s3.${region}.backblazeb2.com`;
    bucket = requiredEnv("B2_BUCKET");
    accessKeyId = requiredEnv("B2_KEY_ID");
    secretAccessKey = requiredEnv("B2_APPLICATION_KEY");
  }

  const client = new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
    maxAttempts: 3,
    // Avoid optional checksum headers not consistently implemented by
    // S3-compatible providers; S3 still enforces checksums when required.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  const storage = { client, bucket };
  clients.set(provider, storage);
  return storage;
}

function parseProvider(provider: string): MediaStorageProvider {
  if (provider === "r2" || provider === "b2") return provider;
  throw new Error(`Unsupported media storage provider: ${provider}.`);
}

export function getMediaStorageWriteProvider(): MediaStorageProvider | null {
  const configured = (
    process.env["MEDIA_STORAGE_PROVIDER"] ?? "database"
  ).trim().toLowerCase();

  if (configured === "database") return null;
  if (configured !== "r2" && configured !== "b2") {
    throw new Error(
      "MEDIA_STORAGE_PROVIDER must be set to database, r2, or b2.",
    );
  }

  // Validate provider settings before accepting a file upload.
  createStorageClient(configured);
  return configured;
}

export async function putEncryptedMedia(
  provider: MediaStorageProvider,
  key: string,
  body: Buffer,
): Promise<void> {
  const { client, bucket } = createStorageClient(provider);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "application/octet-stream",
    }),
  );
}

export async function getEncryptedMedia(
  provider: string,
  key: string,
): Promise<Buffer> {
  const { client, bucket } = createStorageClient(parseProvider(provider));
  const response = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );

  if (!response.Body) {
    throw new Error("The object storage provider returned an empty object.");
  }

  return Buffer.from(await response.Body.transformToByteArray());
}

export async function deleteEncryptedMedia(
  provider: MediaStorageProvider,
  key: string,
): Promise<void> {
  const { client, bucket } = createStorageClient(provider);
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
