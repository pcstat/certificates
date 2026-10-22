/**
 * Reads the registry from disk and prepares the public set files. Shared by validate.mjs and build-dist.mjs.
 * Plain Node, no dependencies.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Placeholders every template can print; they come from the certificate itself, not from `fields`. */
export const BUILTIN_KEYS = ["name", "id", "date", "course", "title"];

export const readText = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
export const readJson = (rel) => JSON.parse(readText(rel));
export const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

/** Every set file, as repo-relative paths: sets/<code>.json. */
export function listSetFiles() {
  if (!exists("sets")) return [];
  return fs.readdirSync(path.join(ROOT, "sets")).sort().map((name) => `sets/${name}`);
}

/**
 * A set file as it is published: both parts, without the internal `note`s. The website merges the two parts itself
 * (resolveCertificate in certificate-core.ts), so what is shared by the whole set is stored — and downloaded — once.
 */
export function publicSet(set) {
  const people = {};
  for (const [id, person] of Object.entries(set.people ?? {})) {
    const { note: _note, ref: _ref, ...rest } = person;
    people[id] = rest;
  }
  return { code: set.code, certificate: set.certificate, people };
}
