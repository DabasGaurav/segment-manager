import { getRegistry } from "@/lib/taxonomy/registry";
import { ApiError } from "./problem";

export function registryOr503() {
  try {
    return getRegistry();
  } catch {
    throw new ApiError(503, "TAXONOMY_UNAVAILABLE", "Official taxonomy files failed verification.", undefined, { "retry-after": "60" });
  }
}
