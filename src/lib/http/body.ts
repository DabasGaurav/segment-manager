import type { z } from "zod";
import { ApiError, readBodyLimited, requireJsonContentType } from "./problem";

/** Read, size-limit, parse and validate a JSON body. */
export async function jsonBody<T extends z.ZodTypeAny>(req: Request, schema: T, limit = 64 * 1024): Promise<z.infer<T>> {
  requireJsonContentType(req);
  const raw = await readBodyLimited(req, limit);
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Body is not valid JSON.");
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new ApiError(
      400,
      "SCHEMA_VIOLATION",
      "The request body is invalid.",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return parsed.data;
}
