export type UploadStatus =
  | "authorized"
  | "uploaded"
  | "finalized"
  | "claimed"
  | "failed"
  | "expired";

export type UploadMediaKind =
  | "primary_image"
  | "image_asset"
  | "video"
  | "document"
  | "combo_image"
  | "combo_video";

export type UploadCategory = "image" | "video" | "document";

export type SafeUploadExtension =
  | "jpg"
  | "png"
  | "webp"
  | "gif"
  | "mp4"
  | "mov"
  | "webm"
  | "pdf"
  | "md"
  | "txt"
  | "docx";

export type AllowedUploadMimeType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif"
  | "video/mp4"
  | "video/quicktime"
  | "video/webm"
  | "application/pdf"
  | "text/markdown"
  | "text/plain"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export interface UploadAuthorizationRequest {
  mediaKind: UploadMediaKind;
  filename: string;
  mimeType: string;
  size: number;
}

export interface SignedPutGrant {
  url: string;
  headers: Record<string, string>;
}

export interface StsMultipartGrant {
  region: string;
  bucket: string;
  endpoint: string;
  accessKeyId: string;
  accessKeySecret: string;
  securityToken: string;
}

export interface UploadAuthorizationResponse {
  uploadId: string;
  objectKey: string;
  expiresAt: number;
  strategy: "signed-put" | "sts-multipart";
  signedPut?: SignedPutGrant;
  sts?: StsMultipartGrant;
}

export interface ValidatedUploadPolicy {
  category: UploadCategory;
  extension: SafeUploadExtension;
  mimeType: AllowedUploadMimeType;
  maxSize: number;
}

export interface UploadPrincipal {
  id: string;
}

export interface UploadSession {
  id: string;
  userId: string;
  mediaKind: UploadMediaKind;
  originalName: string;
  declaredMimeType: AllowedUploadMimeType;
  declaredSize: number;
  pendingObjectKey: string;
  finalObjectKey: string | null;
  status: UploadStatus;
  expiresAt: number;
  claimedAt: number | null;
  failureCode: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface PublicUploadSession {
  uploadId: string;
  mediaKind: UploadMediaKind;
  mimeType: AllowedUploadMimeType;
  size: number;
  status: UploadStatus;
  expiresAt: number;
  finalObjectKey?: string;
  failureCode?: string;
}

export interface UploadQueryResult<Row = Record<string, unknown>> {
  rows: Row[];
  rowCount?: number | null;
}

/** Structural subset shared by pg.Pool and pg.PoolClient. */
export interface UploadRepositoryClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<UploadQueryResult<Row>>;
}

export interface UploadSessionReservation {
  id: string;
  userId: string;
  mediaKind: UploadMediaKind;
  originalName: string;
  declaredMimeType: AllowedUploadMimeType;
  declaredSize: number;
  pendingObjectKey: string;
  expiresAt: number;
  now: number;
  activeLimit: number;
  rateLimit: number;
  rateWindowStart: number;
}

export interface UploadStatusUpdate {
  uploadId: string;
  userId: string;
  status: UploadStatus;
  now: number;
  finalObjectKey?: string | null;
  failureCode?: string | null;
  claimedAt?: number | null;
}

export interface UploadSessionRepository {
  reserveAuthorized(input: UploadSessionReservation): Promise<UploadSession>;
  getForOwner(uploadId: string, userId: string): Promise<UploadSession | null>;
  withLockedForOwner<T>(
    uploadId: string,
    userId: string,
    operation: (
      client: UploadRepositoryClient,
      upload: UploadSession | null,
    ) => Promise<T>,
  ): Promise<T>;
  getLockedForOwner(
    client: UploadRepositoryClient,
    uploadId: string,
    userId: string,
  ): Promise<UploadSession | null>;
  updateStatus(
    client: UploadRepositoryClient,
    input: UploadStatusUpdate,
  ): Promise<UploadSession | null>;
  markFailed(
    uploadId: string,
    userId: string,
    failureCode: string,
    now: number,
  ): Promise<UploadSession | null>;
}

export type ClaimWriter<Value> = (
  client: UploadRepositoryClient,
  upload: UploadSession,
) => Promise<Value>;

export interface UploadClaimResult<Value> {
  session: PublicUploadSession;
  created: boolean;
  value?: Value;
}
