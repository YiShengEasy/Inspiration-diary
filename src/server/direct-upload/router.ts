import { Router, type NextFunction, type Response } from "express";

import type { AuthenticatedRequest, AuthUser } from "../auth.ts";
import type { FeatureAudience } from "../runtimeConfig.ts";
import type { UploadAuthorizationRequest, UploadMediaKind } from "./types.ts";

export interface DirectUploadRouterService {
  authorize(
    user: AuthUser,
    request: UploadAuthorizationRequest,
  ): Promise<unknown>;
  complete(user: AuthUser, uploadId: string): Promise<unknown>;
  get(user: AuthUser, uploadId: string): Promise<unknown>;
  abort(user: AuthUser, uploadId: string): Promise<unknown>;
}

export interface DirectUploadRouterOptions {
  mode: FeatureAudience;
  service: DirectUploadRouterService;
}

const MEDIA_KINDS = new Set<UploadMediaKind>([
  "primary_image",
  "image_asset",
  "video",
  "document",
  "combo_image",
  "combo_video",
]);

const NOT_FOUND_CODES = new Set([
  "not_found",
  "upload_not_found",
  "owner_mismatch",
  "not_owner",
  "forbidden",
]);
const CONFLICT_CODES = new Set([
  "expired",
  "invalid_state",
  "illegal_state",
  "state_conflict",
  "already_claimed",
]);
const SIZE_CODES = new Set([
  "size_exceeded",
  "size_mismatch",
  "content_length_mismatch",
]);
const TYPE_CODES = new Set([
  "type_mismatch",
  "unsupported_type",
  "media_kind_mismatch",
  "signature_mismatch",
  "mime_mismatch",
  "content_type_mismatch",
  "invalid_signature",
]);
const LIMIT_CODES = new Set([
  "rate_limited",
  "authorization_rate_limit",
  "active_limit",
  "active_session_limit",
  "limit_exceeded",
  "too_many_active_uploads",
]);
const STORAGE_CODES = new Set([
  "storage_error",
  "oss_error",
  "oss_failure",
  "gateway_error",
]);
const BAD_REQUEST_CODES = new Set([
  "invalid_request",
  "unsafe_key_segment",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseAuthorizationBody(value: unknown): UploadAuthorizationRequest | null {
  const body = asRecord(value);
  if (!body) return null;

  const mediaKind = body.mediaKind;
  const filename = body.filename;
  const mimeType = body.mimeType;
  const size = body.size;
  if (
    typeof mediaKind !== "string" ||
    !MEDIA_KINDS.has(mediaKind as UploadMediaKind) ||
    typeof filename !== "string" ||
    filename.trim().length === 0 ||
    filename.trim().length > 255 ||
    typeof mimeType !== "string" ||
    mimeType.trim().length === 0 ||
    mimeType.trim().length > 255 ||
    !Number.isSafeInteger(size) ||
    Number(size) <= 0
  ) {
    return null;
  }

  return {
    mediaKind: mediaKind as UploadMediaKind,
    filename: filename.trim(),
    mimeType: mimeType.trim().toLowerCase(),
    size: Number(size),
  };
}

function parseUploadId(value: string): string | null {
  return /^[A-Za-z0-9_-]{1,128}$/u.test(value) ? value : null;
}

function hasUnexpectedBody(value: unknown): boolean {
  if (value === undefined) return false;
  const body = asRecord(value);
  return body === null || Object.keys(body).length > 0;
}

function errorCode(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return "";
  }
  return typeof error.code === "string" ? error.code : "";
}

function sendPublicError(res: Response, error: unknown): Response {
  const code = errorCode(error);
  if (NOT_FOUND_CODES.has(code)) {
    return res.status(404).json({ error: "上传会话不存在" });
  }
  if (CONFLICT_CODES.has(code)) {
    return res.status(409).json({ error: "上传状态冲突" });
  }
  if (SIZE_CODES.has(code)) {
    return res.status(413).json({ error: "上传文件过大" });
  }
  if (TYPE_CODES.has(code)) {
    return res.status(415).json({ error: "上传文件类型无效" });
  }
  if (LIMIT_CODES.has(code)) {
    return res.status(429).json({ error: "上传请求过于频繁" });
  }
  if (STORAGE_CODES.has(code)) {
    return res.status(502).json({ error: "对象存储暂时不可用" });
  }
  if (BAD_REQUEST_CODES.has(code)) {
    return res.status(400).json({ error: "上传参数无效" });
  }

  // Do not log the original error because upstream SDK errors can contain
  // signed URLs or credentials. The public response is deliberately generic.
  console.error("Direct upload route failed with an unclassified error");
  return res.status(500).json({ error: "上传服务异常" });
}

function requireUploadAccess(mode: FeatureAudience) {
  return (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ): Response | void => {
    if (mode === "off") {
      return res.status(404).json({ error: "接口不存在" });
    }
    if (!req.user) {
      return res.status(401).json({ error: "未登录" });
    }
    if (mode === "admin" && req.user.role !== "admin") {
      return res.status(404).json({ error: "接口不存在" });
    }
    next();
  };
}

export function createDirectUploadRouter(
  options: DirectUploadRouterOptions,
): Router {
  const router = Router();
  router.use(requireUploadAccess(options.mode));

  router.post("/authorize", async (req: AuthenticatedRequest, res: Response) => {
    const request = parseAuthorizationBody(req.body);
    if (!request) return res.status(400).json({ error: "上传参数无效" });

    try {
      const result = await options.service.authorize(req.user!, request);
      return res.status(201).json(result);
    } catch (error: unknown) {
      return sendPublicError(res, error);
    }
  });

  router.post("/:id/complete", async (req: AuthenticatedRequest, res: Response) => {
    const uploadId = parseUploadId(req.params.id);
    if (!uploadId || hasUnexpectedBody(req.body)) {
      return res.status(400).json({ error: "上传参数无效" });
    }

    try {
      const result = await options.service.complete(req.user!, uploadId);
      return res.json(result);
    } catch (error: unknown) {
      return sendPublicError(res, error);
    }
  });

  router.get("/:id", async (req: AuthenticatedRequest, res: Response) => {
    const uploadId = parseUploadId(req.params.id);
    if (!uploadId) return res.status(400).json({ error: "上传参数无效" });

    try {
      const result = await options.service.get(req.user!, uploadId);
      return res.json(result);
    } catch (error: unknown) {
      return sendPublicError(res, error);
    }
  });

  router.post("/:id/abort", async (req: AuthenticatedRequest, res: Response) => {
    const uploadId = parseUploadId(req.params.id);
    if (!uploadId || hasUnexpectedBody(req.body)) {
      return res.status(400).json({ error: "上传参数无效" });
    }

    try {
      const result = await options.service.abort(req.user!, uploadId);
      return res.json(result);
    } catch (error: unknown) {
      return sendPublicError(res, error);
    }
  });

  return router;
}
