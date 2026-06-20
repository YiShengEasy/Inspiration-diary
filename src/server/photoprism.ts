export interface StoredPhotoPrismImage {
  photoUid: string;
  imageUrl: string;
  thumbnailUrl: string;
}

interface PhotoPrismSession {
  authToken: string;
  userUid: string;
}

interface PhotoPrismConfig {
  internalUrl: string;
  publicUrl: string;
  username: string;
  password: string;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function getConfig(): PhotoPrismConfig {
  const internalUrl = process.env.PHOTOPRISM_INTERNAL_URL || "";
  const publicUrl = process.env.PHOTOPRISM_PUBLIC_URL || internalUrl;
  const username = process.env.PHOTOPRISM_USERNAME || "";
  const password = process.env.PHOTOPRISM_PASSWORD || "";

  if (!internalUrl || !publicUrl || !username || !password) {
    throw new Error("PhotoPrism is not configured. Set PHOTOPRISM_INTERNAL_URL, PHOTOPRISM_PUBLIC_URL, PHOTOPRISM_USERNAME, and PHOTOPRISM_PASSWORD.");
  }

  return {
    internalUrl: trimTrailingSlash(internalUrl),
    publicUrl: trimTrailingSlash(publicUrl),
    username,
    password,
  };
}

function decodeDataUrl(dataUrl: string): { buffer: Buffer; mimeType: string; extension: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid image data URL.");
  }

  const mimeType = match[1];
  const extension = mimeType.includes("png") ? "png" : "jpg";
  return {
    buffer: Buffer.from(match[2], "base64"),
    mimeType,
    extension,
  };
}

function generateUploadToken(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < 7; i += 1) {
    token += alphabet.charAt(Math.floor(36 * Math.random()));
  }
  return token;
}

function buildHeaders(authToken: string): HeadersInit {
  return {
    "X-Auth-Token": authToken,
    "X-Client-Version": "inspiration-diary",
  };
}

async function login(config: PhotoPrismConfig): Promise<PhotoPrismSession> {
  const response = await fetch(`${config.internalUrl}/api/v1/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: config.username,
      password: config.password,
    }),
  });

  if (!response.ok) {
    throw new Error(`PhotoPrism login failed with status ${response.status}.`);
  }

  const body: any = await response.json();
  const authToken = body.access_token || body.id;
  const userUid = body.user?.UID || "u000000000000001";

  if (!authToken) {
    throw new Error("PhotoPrism login did not return an auth token.");
  }

  return { authToken, userUid };
}

async function uploadFile(
  config: PhotoPrismConfig,
  session: PhotoPrismSession,
  imageBase64: string,
  filename: string,
  token: string,
): Promise<void> {
  const decoded = decodeDataUrl(imageBase64);
  const formData = new FormData();
  const bytes = new Uint8Array(decoded.buffer);
  const blob = new Blob([bytes], { type: decoded.mimeType });
  formData.append("files", blob, filename);

  const response = await fetch(`${config.internalUrl}/api/v1/users/${session.userUid}/upload/${token}`, {
    method: "POST",
    headers: buildHeaders(session.authToken),
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PhotoPrism upload failed with status ${response.status}: ${text}`);
  }

  const finalizeResponse = await fetch(`${config.internalUrl}/api/v1/users/${session.userUid}/upload/${token}`, {
    method: "PUT",
    headers: {
      ...buildHeaders(session.authToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ albums: [] }),
  });

  if (!finalizeResponse.ok) {
    const text = await finalizeResponse.text();
    throw new Error(`PhotoPrism finalize failed with status ${finalizeResponse.status}: ${text}`);
  }
}

async function findUploadedPhoto(config: PhotoPrismConfig, session: PhotoPrismSession, filename: string): Promise<any> {
  const query = encodeURIComponent(filename);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await fetch(`${config.internalUrl}/api/v1/photos?count=5&q=${query}`, {
      headers: buildHeaders(session.authToken),
    });

    if (response.ok) {
      const photos: any[] = await response.json();
      const photo = photos.find((item) => item && (item.Name === filename || item.OriginalName === filename || item.PhotoUID || item.UID));
      if (photo) {
        return photo;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  throw new Error("PhotoPrism uploaded photo was not found after indexing.");
}

export async function storeImageInPhotoPrism(imageBase64: string): Promise<StoredPhotoPrismImage> {
  const config = getConfig();
  const session = await login(config);
  const decoded = decodeDataUrl(imageBase64);
  const uploadToken = generateUploadToken();
  const filename = `inspiration-${Date.now()}-${uploadToken}.${decoded.extension}`;

  await uploadFile(config, session, imageBase64, filename, uploadToken);

  const photo = await findUploadedPhoto(config, session, filename);
  const hash = photo.Hash || photo.FileHash || photo.Files?.[0]?.Hash;
  const photoUid = photo.UID || photo.PhotoUID || photo.Files?.[0]?.PhotoUID || filename;

  if (!hash) {
    throw new Error("PhotoPrism photo hash is missing.");
  }

  return {
    photoUid,
    thumbnailUrl: `${config.publicUrl}/api/v1/t/${hash}/public/fit_720`,
    imageUrl: `${config.publicUrl}/api/v1/dl/${hash}?t=public`,
  };
}
