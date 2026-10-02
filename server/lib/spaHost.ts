/**
 * Production SPA hosting that cannot turn API calls into static 405s.
 *
 * serve-static responds 405 Allow: GET, HEAD for non-GET when `fallthrough` is
 * false. Railway's static/Nixpacks site does the same for the whole tree
 * (GET /api/health is index.html; POST /api/auth/* is 405). This module is the
 * in-process guard: only GET/HEAD assets, never /api, JSON if nothing matches.
 */
import express from 'express';
import path from 'node:path';
import type { Express, NextFunction, Request, Response } from 'express';

type StaticOptions = NonNullable<Parameters<typeof express.static>[1]>;

export function isApiPath(urlPath: string): boolean {
  return urlPath === '/api' || urlPath.startsWith('/api/');
}

/** GET/HEAD file server. Non-GET always falls through — never 405. */
export function staticGetHead(root: string, options?: StaticOptions) {
  const serve = express.static(root, {
    ...(options ?? {}),
    fallthrough: true,
  });
  return function staticGetHeadMiddleware(req: Request, res: Response, next: NextFunction) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    serve(req, res, next);
  };
}

export function apiNotFound(_req: Request, res: Response) {
  res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
}

/**
 * Hashed assets + client-route fallback. Mount only after API routes and
 * `apiNotFound`, so /api is already finished.
 */
export function mountSpa(app: Express, distDir: string): void {
  const assets = staticGetHead(distDir, {
    index: false,
    maxAge: '1h',
    redirect: false,
  });

  app.use((req, res, next) => {
    // Defense in depth: a mis-ordered mount must not static-serve /api.
    if (isApiPath(req.path)) {
      apiNotFound(req, res);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
      return;
    }
    assets(req, res, next);
  });

  // GET/HEAD client routes only. Negative lookahead keeps /api off this route
  // (a GET-only match on an API path is how routers end up answering POST with 405).
  app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}
