import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { parsePermitCatalog } from "../src/alerts/permits.ts";

// This narrow publication guard detects Google-key-shaped values in captures;
// it is not a general secret scanner or a credential validity check.
function embeddedGoogleKeyLocations(root: string): Array<{file: string; line: number}> {
  const shape = new RegExp(["AI", "za"].join("") + "[A-Za-z0-9_-]{35}");
  const found: Array<{file: string; line: number}> = [];
  let bytes = 0;
  function walk(directory: string, depth = 0): void {
    if (depth > 12) throw new Error("Fixture nesting exceeds the publication guard bound");
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Fixture publication cannot follow symlinks");
      if (entry.isDirectory()) { walk(path, depth + 1); continue; }
      if (!entry.isFile()) throw new Error("Fixture must be a regular file");
      const body = readFileSync(path); bytes += body.byteLength;
      if (bytes > 64 * 1024 * 1024) throw new Error("Fixture publication exceeds byte bound");
      body.toString("utf8").split(/\r?\n/).forEach((line, index) => {
        if (shape.test(line)) found.push({file: relative(root, path), line: index + 1});
      });
    }
  }
  walk(root); return found;
}

test("published captures contain no unredacted Google-key-shaped values", () => {
  // Diagnostics return only file/line locators, never matched values.
  expect(embeddedGoogleKeyLocations(join(import.meta.dir, "fixtures"))).toEqual([]);
});

test("fixture publication guard detects nested credential-bearing input without disclosing it", () => {
  const root = mkdtempSync(join(tmpdir(), "fixture-credentials-"));
  try {
    mkdirSync(join(root, "nested"));
    const synthetic = ["AI", "za"].join("") + "A".repeat(35);
    writeFileSync(join(root, "nested", "capture.html"), `<html>\n<script>MG.GoogleApiKey=${JSON.stringify(synthetic)};</script></html>`);
    expect(embeddedGoogleKeyLocations(root)).toEqual([{file: join("nested", "capture.html"), line: 2}]);
    writeFileSync(join(root, "nested", "capture.html"), '<html><script>MG.GoogleApiKey="";</script></html>');
    expect(embeddedGoogleKeyLocations(root)).toEqual([]);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test("irrelevant sanitized browser configuration preserves the real permit catalog", () => {
  const html = readFileSync(join(import.meta.dir, "fixtures/permits/mygov-permits-module-pi.html"), "utf8");
  const expected = parsePermitCatalog(html);
  expect(expected).toHaveLength(5);
  expect(parsePermitCatalog(html + '<script>MG.GoogleApiKey="";MG.loggedUserId=0;</script>')).toEqual(expected);
});
