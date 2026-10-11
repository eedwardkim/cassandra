import { config } from "../config.js";

/** Up to five fresh web snippets from Context.dev for the Reporter. Silently empty when no key or on any failure. */
export async function contextSnippets(query: string): Promise<string[]> {
  if (!config.contextDevKey) return [];
  try {
    const res = await fetch("https://api.context.dev/v1/web/search", {
      method: "POST",
      headers: { authorization: `Bearer ${config.contextDevKey}`, "content-type": "application/json" },
      body: JSON.stringify({ query, numResults: 10, descriptionMaxCharacters: 300 }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { results?: { title?: string; snippet?: string; description?: string; url?: string }[] };
    return (body.results ?? []).slice(0, 5).map((r) => `${r.title ?? ""}: ${(r.snippet ?? r.description ?? "").slice(0, 300)} (${r.url ?? ""})`);
  } catch {
    return [];
  }
}
