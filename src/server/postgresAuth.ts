import type { NextFunction, RequestHandler, Response } from "express";
import type pg from "pg";

import { requireAuth, type AuthenticatedRequest } from "./auth.ts";
import { getMiniToken, loadMiniSessionUser } from "./miniprogramAuth.ts";

export function createRequirePostgresAuth(pool: pg.Pool | null): RequestHandler {
  const webAuth = pool ? requireAuth(pool) : null;
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!pool || !webAuth) return res.status(503).json({ error: "PostgreSQL is not configured." });
    const miniToken = getMiniToken(req);
    if (miniToken) {
      const miniUser = await loadMiniSessionUser(pool, miniToken);
      if (!miniUser) return res.status(401).json({ error: "登录已过期" });
      req.user = miniUser;
      req.sessionId = miniToken;
      return next();
    }
    return webAuth(req, res, next);
  };
}
