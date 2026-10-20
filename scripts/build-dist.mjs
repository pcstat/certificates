#!/usr/bin/env node
/**
 * Builds the public files into ./dist — exactly what is uploaded to Cloudflare Pages.
 *
 *   node scripts/build-dist.mjs          (or: pnpm build)
 *
 *   dist/sets/<code>.json   one file per set: { code, title, course, records: { "<normalized id>": CertificateRecord } }.
 *                           The ID starts with the set code, so the website opens exactly this one file.
 *   dist/meta.json          totals and the build time
 *   dist/templates/         the SVG templates and their manifest
 *   dist/_headers           CORS, so the website can read all of this in the browser
 *
 * What is NOT published: internal `note`s. Sets that are being prepared are published like any other, so only
 * commit finished ones.
 */
import fs from "node:fs";
import path from "node:path";
import { normalizeId, setFileName } from "./lib/certificate-core.ts";
import { ROOT, listSetFiles, readJson, toRecord } from "./lib/registry.mjs";

const DIST = path.join(ROOT, "dist");
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, "sets"), { recursive: true });
fs.mkdirSync(path.join(DIST, "templates"), { recursive: true });

let total = 0;
let revoked = 0;
const sets = [];
for (const file of listSetFiles()) {
  const set = readJson(file);
  const records = {};
  for (const recipient of set.recipients ?? []) {
    records[normalizeId(recipient.id)] = toRecord(set, recipient);
    total += 1;
    if (recipient.revoked) revoked += 1;
  }
  fs.writeFileSync(path.join(DIST, "sets", setFileName(set.code)), JSON.stringify({ code: set.code, title: set.title, course: set.course, records }));
  sets.push({ code: set.code, count: Object.keys(records).length });
}
fs.writeFileSync(path.join(DIST, "meta.json"), JSON.stringify({ version: 2, generated: new Date().toISOString(), total, valid: total - revoked, revoked, sets }) + "\n");

const manifest = readJson("templates/manifest.json");
fs.copyFileSync(path.join(ROOT, "templates", "manifest.json"), path.join(DIST, "templates", "manifest.json"));
for (const t of manifest.templates) fs.copyFileSync(path.join(ROOT, "templates", t.file), path.join(DIST, "templates", t.file));
fs.copyFileSync(path.join(ROOT, "_headers"), path.join(DIST, "_headers"));

console.log(`Built ${total} certificate${total === 1 ? "" : "s"} (${revoked} revoked) in ${sets.length} set file${sets.length === 1 ? "" : "s"}.`);
