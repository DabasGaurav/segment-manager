/**
 * Errors use application/problem+json (RFC 9457) with a stable `code` (Phase 3 §4.1).
 * Every response carries `request_id`, also echoed in the X-Request-Id header.
 */
import { randomUUID } from "node:crypto";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly detail: string,
    public readonly errors?: { path: string; message: string }[],
    public readonly headers?: Record<string, string>,
  ) {
    super(`${status} ${code}: ${detail}`);
  }
}

const TITLES: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  409: "Conflict",
  413: "Payload Too Large",
  415: "Unsupported Media Type",
  422: "Unprocessable Content",
  429: "Too Many Requests",
  500: "Internal Server Error",
  503: "Service Unavailable",
};

export function newRequestId(): string {
  return `req_${randomUUID()}`;
}

export function problem(requestId: string, e: ApiError): Response {
  const body = {
    type: `https://segment-manager.example/problems/${e.code.toLowerCase()}`,
    title: TITLES[e.status] ?? "Error",
    status: e.status,
    code: e.code,
    detail: e.detail,
    ...(e.errors ? { errors: e.errors } : {}),
    request_id: requestId,
  };
  return new Response(JSON.stringify(body), {
    status: e.status,
    headers: {
      "content-type": "application/problem+json",
      "cache-control": "no-store",
      "x-request-id": requestId,
      ...(e.headers ?? {}),
    },
  });
}

export function json(requestId: string, body: Record<string, unknown>, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ request_id: requestId, ...body }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", "x-request-id": requestId, ...headers },
  });
}

/**
 * Wrap a route handler: assigns a request id, turns ApiError into problem+json, and turns any
 * unexpected error into a generic 500 without leaking internals.
 */
export function handler<C>(fn: (req: Request, ctx: C, requestId: string) => Promise<Response>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    const requestId = newRequestId();
    try {
      return await fn(req, ctx, requestId);
    } catch (e) {
      if (e instanceof ApiError) return problem(requestId, e);
      console.error(`[${requestId}] unhandled error`, e);
      return problem(requestId, new ApiError(500, "INTERNAL", "Unexpected server error."));
    }
  };
}

/** Read the body as text without buffering more than `limit` bytes. */
export async function readBodyLimited(req: Request, limit: number): Promise<string> {
  const declared = Number(req.headers.get("content-length") ?? "NaN");
  if (Number.isFinite(declared) && declared > limit) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", `Body is ${declared} bytes; the limit is ${limit}.`);
  }
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new ApiError(413, "PAYLOAD_TOO_LARGE", `Body exceeds the ${limit}-byte limit.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function requireJsonContentType(req: Request): void {
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!ct.startsWith("application/json")) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Send the body as application/json.");
  }
}
