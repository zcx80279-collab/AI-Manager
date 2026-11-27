import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface NetworkSecurityConfig {
  bindHost: string;
  port: number;
  remoteAccessEnabled: boolean;
}

export const SESSION_COOKIE_NAME = 'ai_manager_session';
export const CSRF_HEADER_NAME = 'x-ai-manager-csrf';

export function getDefaultNetworkSecurityConfig(port: number): NetworkSecurityConfig {
  return {
    bindHost: '127.0.0.1',
    port,
    remoteAccessEnabled: false,
  };
}

export function isLoopbackAddress(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  return (
    remoteAddress === '127.0.0.1' ||
    remoteAddress === '::1' ||
    remoteAddress === '::ffff:127.0.0.1'
  );
}

export function isAllowedLocalHost(hostHeader: string | undefined, port: number): boolean {
  if (!hostHeader) return false;
  const normalized = hostHeader.trim().toLowerCase();
  const allowed = new Set([
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    `[::1]:${port}`,
    '127.0.0.1',
    'localhost',
    '[::1]',
  ]);
  return allowed.has(normalized);
}

export function isAllowedLocalOrigin(originHeader: string | undefined, port: number): boolean {
  if (!originHeader) return true;
  const normalized = originHeader.trim().toLowerCase();
  const allowed = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://[::1]:${port}`,
  ]);
  return allowed.has(normalized);
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) cookies[key] = val;
  }
  return cookies;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function createNetworkSecurityGuard(config: NetworkSecurityConfig) {
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const csrfToken = crypto.randomBytes(32).toString('hex');

  function verifyLocalOriginAndHost(req: Request, res: Response): boolean {
    if (!config.remoteAccessEnabled && !isLoopbackAddress(req.socket.remoteAddress)) {
      res.status(403).json({
        errorCode: 'REMOTE_ACCESS_DENIED',
        error: '외부 네트워크에서의 접근이 차단되었습니다.',
      });
      return false;
    }

    if (!isAllowedLocalHost(req.headers.host, config.port)) {
      res.status(403).json({
        errorCode: 'INVALID_HOST',
        error: '허용되지 않은 Host 헤더입니다.',
      });
      return false;
    }

    const origin = req.headers.origin;
    if (origin && !isAllowedLocalOrigin(origin, config.port)) {
      res.status(403).json({
        errorCode: 'INVALID_ORIGIN',
        error: '허용되지 않은 Origin에서의 요청입니다.',
      });
      return false;
    }

    const secFetchSite = req.headers['sec-fetch-site'];
    if (typeof secFetchSite === 'string' && secFetchSite === 'cross-site') {
      res.status(403).json({
        errorCode: 'CROSS_SITE_DENIED',
        error: '교차 출처 요청이 차단되었습니다.',
      });
      return false;
    }

    return true;
  }

  function issueSessionHandler(req: Request, res: Response): void {
    if (!verifyLocalOriginAndHost(req, res)) return;

    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=${sessionToken}; HttpOnly; SameSite=Strict; Path=/`
    );
    res.setHeader('Cache-Control', 'no-store');
    res.json({ csrfToken });
  }

  function requireAuthenticatedApi(req: Request, res: Response, next: NextFunction): void {
    if (!verifyLocalOriginAndHost(req, res)) return;

    const cookies = parseCookies(req.headers.cookie);
    const cookieToken = cookies[SESSION_COOKIE_NAME];
    const headerCsrf = req.headers[CSRF_HEADER_NAME];

    if (
      typeof cookieToken !== 'string' ||
      typeof headerCsrf !== 'string' ||
      !timingSafeEqualStr(cookieToken, sessionToken) ||
      !timingSafeEqualStr(headerCsrf, csrfToken)
    ) {
      res.status(401).json({
        errorCode: 'UNAUTHORIZED',
        error: '세션 인증이 필요합니다.',
      });
      return;
    }

    next();
  }

  return {
    config,
    issueSessionHandler,
    requireAuthenticatedApi,
  };
}
