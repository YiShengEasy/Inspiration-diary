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
