/**
 * Reads the registry from disk and turns sets into the public records. Shared by validate.mjs and build-dist.mjs.
 * Plain Node, no dependencies.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Placeholders every template can print; they come from the certificate itself, not from `fields`. */
export const BUILTIN_KEYS = ["name", "id", "date", "course"];

export const readText = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
export const readJson = (rel) => JSON.parse(readText(rel));
export const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

/** Every set file, as repo-relative paths: sets/<code>.json. */
export function listSetFiles() {
  if (!exists("sets")) return [];
  return fs.readdirSync(path.join(ROOT, "sets")).sort().map((name) => `sets/${name}`);
}

/** The values a certificate prints besides its own name / id / date / course: the set's, overridden by the recipient's. */
export function mergedFields(set, recipient) {
  const out = {};
  for (const source of [set.fields, recipient.fields]) {
    for (const [key, value] of Object.entries(source ?? {})) {
      if (typeof value === "string" && value.trim() !== "") out[key] = value;
    }
  }
  return out;
}

/** One certificate as published (see CertificateRecord in certificate-core.ts). The internal `note` is never published. */
export function toRecord(set, recipient) {
  const record = {
    id: recipient.id,
    recipient: recipient.name,
    course: set.course,
    date: set.date,
    template: set.template,
    status: recipient.revoked ? "revoked" : "valid",
  };
  if (recipient.revoked) {
    record.revoked_at = recipient.revoked.date;
    if (recipient.revoked.reason) record.revoked_reason = recipient.revoked.reason;
  }
  record.fields = mergedFields(set, recipient);
  return record;
}
