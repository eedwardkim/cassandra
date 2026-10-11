import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = new URL("../../../apps/engine/src/", import.meta.url).pathname;
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f.endsWith(".ts") ? [join(d, f)] : []));

describe("order gateway is the only door to Gemini orders", () => {
  for (const f of walk(src).filter((f) => !f.endsWith("/gateway.ts"))) {
    it(f.replace(src, "src/"), () => {
      const code = readFileSync(f, "utf8");
      expect(code).not.toMatch(/placeIoc|placeOrder\s*\(/);
      expect(code).not.toMatch(/GEMINI_API_SECRET|apiSecret/);
    });
  }
  it("gateway.ts sends orders only via placeAuthorized", () => {
    const g = readFileSync(join(src, "gateway.ts"), "utf8");
    expect(g).toMatch(/export async function placeAuthorized/);
    expect(g).not.toMatch(/export (async )?function placeIoc/);
  });
});
