#!/usr/bin/env bun
import { join } from "path";
import { validateManuscript } from "../src/manuscript_document.js";
const hydrated = Bun.argv.includes("--hydrated");
const reference = hydrated || Bun.argv.includes("--reference");
const sourceDir = reference ? join(process.cwd(), "docs", "archive", "crescent-manuscript") : undefined;
const errors = await validateManuscript({ hydrated, sourceDir });
if (errors.length) { console.error(`Manuscript validation failed:\n${errors.map(error => `- ${error}`).join("\n")}`); process.exitCode = 1; }
else console.log(`Manuscript validation passed: ${hydrated ? "hydrated output" : "source contracts"}.`);
