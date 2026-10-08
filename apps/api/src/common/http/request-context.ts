import type { Request } from 'express';

/** Who/where a request came from, passed from controllers into use cases. */
export interface RequestContext {
  ipAddress: string;
  userAgent?: string;
  requestId?: string;
}

export function requestContextOf(req: Request & { id?: unknown }): RequestContext {
  const userAgent = req.headers['user-agent'];
  return {
    ipAddress: req.ip ?? 'unknown',
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 512) : undefined,
    requestId: req.id === undefined ? undefined : String(req.id),
  };
}
