/**
 * Envelope validation for requests that carry an OpenRTB 2.6 bid request (Phase 3.1 §A3.2).
 *
 * Only the envelope and the handful of fields the service needs are validated strictly. Everything
 * else inside bid_request is passed through untouched; individual bad Data objects or Segments are
 * handled in-band by the detector, never with an HTTP error.
 */
import { z } from "zod";
import { DATA_LOCATIONS, isPlainObject } from "./detect";

export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_DATA_OBJECTS = 50;
export const MAX_SEGMENTS = 500;

const bidRequestSchema = z
  .object({
    id: z.string().min(1, "bid_request.id is required (OpenRTB 2.6 §3.2.1)"),
    imp: z.array(z.unknown()).min(1, "bid_request.imp must contain at least one Imp (OpenRTB 2.6 §3.2.1)"),
  })
  .passthrough();

export const envelopeSchema = z.object({
  publisher_id: z.string().regex(/^pub_[a-z0-9_]{1,60}$/, "publisher_id must look like pub_<name>"),
  dsp: z.string().regex(/^[a-z0-9_-]{1,40}$/, "dsp must be a lowercase DSP key such as ttd"),
  bid_request: bidRequestSchema,
});

export type Envelope = z.infer<typeof envelopeSchema> & { bid_request: Record<string, unknown> };

export type EnvelopeResult =
  | { ok: true; value: Envelope }
  | { ok: false; status: 400 | 413 | 422; code: string; detail: string; errors?: { path: string; message: string }[] };

export function countSignals(bidRequest: Record<string, unknown>): { dataObjects: number; segments: number } {
  let dataObjects = 0;
  let segments = 0;
  for (const loc of DATA_LOCATIONS) {
    let cur: unknown = bidRequest;
    for (const k of loc.container) cur = isPlainObject(cur) ? cur[k] : undefined;
    const arr = isPlainObject(cur) ? cur.data : undefined;
    if (!Array.isArray(arr)) continue;
    dataObjects += arr.length;
    for (const d of arr) if (isPlainObject(d) && Array.isArray(d.segment)) segments += d.segment.length;
  }
  return { dataObjects, segments };
}

/** Validate a raw request body (string) into an envelope. Size is checked before parsing. */
export function parseEnvelope(rawBody: string): EnvelopeResult {
  const bytes = Buffer.byteLength(rawBody, "utf8");
  if (bytes > MAX_BODY_BYTES) {
    return { ok: false, status: 413, code: "PAYLOAD_TOO_LARGE", detail: `Body is ${bytes} bytes; the limit is ${MAX_BODY_BYTES}.` };
  }
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return { ok: false, status: 400, code: "INVALID_JSON", detail: "Body is not valid JSON." };
  }
  if (!isPlainObject(json)) {
    return { ok: false, status: 400, code: "SCHEMA_VIOLATION", detail: "Body must be a JSON object.", errors: [{ path: "", message: "expected object" }] };
  }
  const parsed = envelopeSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      code: "SCHEMA_VIOLATION",
      detail: "The request envelope is invalid.",
      errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    };
  }
  // Use the original object (not zod's copy) so unknown fields pass through exactly as sent.
  const bidRequest = json.bid_request as Record<string, unknown>;
  const counts = countSignals(bidRequest);
  if (counts.dataObjects > MAX_DATA_OBJECTS || counts.segments > MAX_SEGMENTS) {
    return {
      ok: false,
      status: 422,
      code: "TOO_MANY_SIGNALS",
      detail: `Request carries ${counts.dataObjects} Data objects and ${counts.segments} segments; limits are ${MAX_DATA_OBJECTS} and ${MAX_SEGMENTS}.`,
    };
  }
  return {
    ok: true,
    value: { publisher_id: parsed.data.publisher_id, dsp: parsed.data.dsp, bid_request: bidRequest } as Envelope,
  };
}
