"use client";
/**
 * Browser-side helpers. Every call goes to the real API with the signed-in persona's session cookie;
 * the server enforces roles and publisher scope. Switching persona is a real sign-in.
 */
export type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface ApiResult {
  ok: boolean;
  status: number;
  data: Json;
}

export async function api(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<ApiResult> {
  try {
    const res = await fetch(path, {
      method: init.method ?? "GET",
      headers: { ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as Json;
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { code: "NETWORK_ERROR", detail: "Could not reach the server. Check your connection and try again." } };
  }
}

export async function signIn(persona: string): Promise<ApiResult> {
  return api("/v1/demo/sessions", { method: "POST", body: { persona } });
}

export async function signOut(): Promise<ApiResult> {
  return api("/v1/demo/sessions", { method: "DELETE" });
}

export const SEGTAX_PATH: Record<number, string> = { 4: "audience/1.1", 6: "content/2.2", 7: "content/3.0", 9: "content/3.1" };

export interface NodeInfo {
  id: string;
  name: string;
  path: string[];
}
const nodeCache = new Map<string, Promise<NodeInfo | null>>();
/** Looks up an official IAB node through the real taxonomy endpoint (cached per page load). */
export function lookupNode(segtax: number, id: string): Promise<NodeInfo | null> {
  const p = SEGTAX_PATH[segtax];
  if (!p) return Promise.resolve(null);
  const key = `${segtax}/${id}`;
  if (!nodeCache.has(key)) {
    nodeCache.set(
      key,
      api(`/v1/taxonomies/${p}/nodes/${encodeURIComponent(id)}`).then((r) => {
        if (r.ok) return { id: r.data.node.id, name: r.data.node.name, path: r.data.node.path };
        if (r.status === 404) return null;
        nodeCache.delete(key); // transient failure: allow a retry
        return null;
      }),
    );
  }
  return nodeCache.get(key)!;
}

export const ROLE_LABEL: Record<string, string> = {
  publisher_ops: "Publisher ops",
  reviewer: "Reviewer",
  curator: "Deal curator",
  admin: "Platform admin",
};

export interface Persona {
  persona: string;
  displayName: string;
  role: string;
  publishers: string[];
}
