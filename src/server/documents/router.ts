import { Readable } from "stream";
import { Router, type Request, type RequestHandler } from "express";

import type { AuthenticatedRequest } from "../auth.ts";
import type { DirectUploadGateway } from "../direct-upload/ossGateway.ts";
import { DirectUploadServiceError, type DirectUploadService } from "../direct-upload/service.ts";

interface ExtractedDocument {
  text: string;
  kind: string;
  truncated: boolean;
}

interface DocumentRouterDependencies {
  uploadMiddleware: RequestHandler;
  directUploadService: DirectUploadService | null;
  directUploadGateway: DirectUploadGateway | null;
  directDocumentHardLimitBytes: number;
  getDirectUploadId: (req: Request, field?: string) => string;
  extractDocumentText: (file: Express.Multer.File, filenameOverride?: string) => Promise<ExtractedDocument>;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function createDocumentRouter(dependencies: DocumentRouterDependencies): Router {
  const {
    uploadMiddleware,
    directUploadService,
    directUploadGateway,
    directDocumentHardLimitBytes,
    getDirectUploadId,
    extractDocumentText,
  } = dependencies;
  const router = Router();
  let directExtractionActive = false;

  router.post("/documents/extract-text", uploadMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      const directUploadId = getDirectUploadId(req);
      if (directUploadId) {
        if (!directUploadService || !directUploadGateway) {
          return res.status(404).json({ error: "Direct upload is not available." });
        }
        if (directExtractionActive) {
          return res.status(429).json({ error: "已有文档正在解析，请稍后重试。" });
        }
        directExtractionActive = true;
        try {
          const session = await directUploadService.get(req.user!, directUploadId);
          if (session.mediaKind !== "document") {
            return res.status(415).json({ error: "Upload media kind is not a document." });
          }
          if (session.status !== "finalized" || !session.finalObjectKey) {
            return res.status(409).json({ error: "Document upload is not finalized." });
          }
          if (session.size > directDocumentHardLimitBytes) {
            return res.status(413).json({ error: "文档不能超过 20MB。" });
          }
          const bytes = await directUploadGateway.readObject(session.finalObjectKey, directDocumentHardLimitBytes);
          if (bytes.byteLength !== session.size || bytes.byteLength > directDocumentHardLimitBytes) {
            return res.status(413).json({ error: "文档大小校验失败。" });
          }
          const filename = String(req.body?.filename || "文档").trim();
          const buffer = Buffer.from(bytes);
          const file = {
            fieldname: "document",
            originalname: filename,
            encoding: "7bit",
            mimetype: session.mimeType,
            size: buffer.length,
            buffer,
            destination: "",
            filename,
            path: "",
            stream: Readable.from(buffer),
          } satisfies Express.Multer.File;
          const extracted = await extractDocumentText(file, filename);
          return res.json({ filename, mimeType: session.mimeType, sizeBytes: session.size, ...extracted });
        } finally {
          directExtractionActive = false;
        }
      }

      if (!req.file) return res.status(400).json({ error: "请上传文档文件。" });
      const filename = String(req.body?.filename || req.file.originalname || "文档").trim();
      const extracted = await extractDocumentText(req.file, filename);
      return res.json({
        filename,
        mimeType: req.file.mimetype || "",
        sizeBytes: req.file.size || req.file.buffer.length,
        ...extracted,
      });
    } catch (error: unknown) {
      console.error("Document text extraction error:", error);
      if (error instanceof DirectUploadServiceError) {
        return res.status(error.httpStatus).json({ error: error.message, code: error.code });
      }
      return res.status(400).json({ error: errorMessage(error, "文档文本提取失败。") });
    }
  });

  return router;
}
