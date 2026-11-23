import { createHash } from "node:crypto";

/** Service keys are stored only as SHA-256 hashes. */
export const hashKey = (key: string): string => createHash("sha256").update(key, "utf8").digest("hex");
