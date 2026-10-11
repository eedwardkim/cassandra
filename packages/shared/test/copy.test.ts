import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bannedHits } from "../src/copy/banned.js";

const root = new URL("../../../", import.meta.url).pathname;
const walk = (dir: string, ext: RegExp): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (f === "node_modules" || f === ".next") return [];
    return statSync(p).isDirectory() ? walk(p, ext) : ext.test(f) ? [p] : [];
  });

// string literals and JSX text only, so identifiers and imports don't count
const literals = (src: string) => [
  ...src.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g),
  ...src.matchAll(/>([^<>{}]+)</g),
].map((m) => m.slice(1).find((x) => x != null) ?? "");

describe("no AI-filler copy", () => {
  const files = [join(root, "README.md"), ...walk(join(root, "docs"), /\.md$/)];
  for (const f of files) {
    it(f.replace(root, ""), () => {
      expect(bannedHits(readFileSync(f, "utf8"))).toEqual([]);
    });
  }
  for (const f of ["app", "components", "lib"].flatMap((d) => walk(join(root, "apps/web", d), /\.(tsx?|jsx?)$/))) {
    it(f.replace(root, ""), () => {
      expect(literals(readFileSync(f, "utf8")).flatMap(bannedHits)).toEqual([]);
    });
  }
  it("catches the listed phrases", () => {
    expect(bannedHits("It's important to note the landscape is robust")).toEqual(["landscape", "robust", "It's important to note"]);
  });
});
