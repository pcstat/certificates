#!/usr/bin/env node
/**
 * Builds the public files into ./dist — exactly what is uploaded to Cloudflare Pages.
 *
 *   node scripts/build-dist.mjs          (or: node scripts/build-dist.mjs)
 *
 *   dist/sets/<code>.json   one file per set: { code, certificate, people } — the set file without internal notes.
 *                           The ID SPC-<code>-<person> says which file to open and which person to read in it.
 *   dist/meta.json          totals and the build time
 *   dist/templates/         the SVG designs and their manifest
 *   dist/_headers           CORS, so the website can read all of this in the browser
 */
import fs from "node:fs";
import path from "node:path";
import { setFileName } from "./lib/certificate-core.ts";
import { ROOT, listSetFiles, publicSet, readJson } from "./lib/registry.mjs";

const DIST = path.join(ROOT, "dist");
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, "sets"), { recursive: true });
fs.mkdirSync(path.join(DIST, "templates"), { recursive: true });

let total = 0;
let revoked = 0;
const sets = [];
for (const file of listSetFiles()) {
  const set = readJson(file);
  const people = Object.values(set.people ?? {});
  total += people.length;
  revoked += people.filter((p) => p.revoked).length;
  fs.writeFileSync(path.join(DIST, "sets", setFileName(set.code)), JSON.stringify(publicSet(set)));
  sets.push({ code: set.code, count: people.length });
}
fs.writeFileSync(path.join(DIST, "meta.json"), JSON.stringify({ version: 3, generated: new Date().toISOString(), total, valid: total - revoked, revoked, sets }) + "\n");

const manifest = readJson("templates/manifest.json");
fs.copyFileSync(path.join(ROOT, "templates", "manifest.json"), path.join(DIST, "templates", "manifest.json"));
for (const t of manifest.templates) fs.copyFileSync(path.join(ROOT, "templates", t.file), path.join(DIST, "templates", t.file));
fs.copyFileSync(path.join(ROOT, "_headers"), path.join(DIST, "_headers"));

console.log(`Built ${total} certificate${total === 1 ? "" : "s"} (${revoked} revoked) in ${sets.length} set file${sets.length === 1 ? "" : "s"}.`);
