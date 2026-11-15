import type { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth.js";
import type { Session } from "../lib/session.js";

declare module "express-serve-static-core" {
  interface Request {
    session: Session;
  }
}

export const sessionProvider = {
  get: (headers: Request["headers"]) =>
    auth.api.getSession({ headers: fromNodeHeaders(headers) }),
};

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const session = await sessionProvider.get(req.headers);

  if (!session?.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  req.session = session;
  next();
}
