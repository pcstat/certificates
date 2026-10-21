#!/usr/bin/env node
/**
 * Validates the certificate registry. Run with `pnpm validate` (or `node scripts/validate.mjs`).
 * Exits with code 1 when any error is found, so CI blocks a bad commit before anything is published
 * (the previously published lookup files stay online).
 *
 * Plain Node, no dependencies. The admin panel runs the same rules before it saves.
 */
import { PERSON_ID_RE, SET_CODE_RE, formatId, idCheck, isIsoDate, setFileName, templatePlaceholders } from "./lib/certificate-core.ts";
import { BUILTIN_KEYS, exists, listSetFiles, readJson, readText } from "./lib/registry.mjs";

const errors = [];
const warnings = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);
const warn = (file, msg) => warnings.push(`${file}: ${msg}`);
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const nonEmpty = (v) => typeof v === "string" && v.trim() !== "";

function load(rel) {
  if (!exists(rel)) {
    err(rel, "file is missing");
    return null;
  }
  try {
    return readJson(rel);
  } catch (e) {
    err(rel, `invalid JSON — ${e.message}`);
    return null;
  }
}

// ── templates/manifest.json ─────────────────────────────────────────────────
const SCOPES = ["set", "recipient", "either"];
/** file name → { fields: Map(key → field) } */
const templates = new Map();
const manifest = load("templates/manifest.json");
if (manifest) {
  if (!Array.isArray(manifest.templates) || manifest.templates.length === 0) err("templates/manifest.json", `"templates" must be a list with at least one template`);
  for (const t of manifest.templates ?? []) {
    const where = `template ${t.file ?? "?"}`;
    if (!/^[A-Za-z0-9_.-]+\.svg$/.test(t.file ?? "")) {
      err("templates/manifest.json", `${where}: "file" must be a plain file name ending in .svg`);
      continue;
    }
    if (templates.has(t.file)) err("templates/manifest.json", `${where}: listed twice`);
    if (!nonEmpty(t.label)) err("templates/manifest.json", `${where}: "label" is required`);
    const fields = new Map();
    for (const f of t.fields ?? []) {
      if (!/^[A-Za-z0-9_]+$/.test(f.key ?? "")) err("templates/manifest.json", `${where}: a field has an invalid "key"`);
      else if (BUILTIN_KEYS.includes(f.key)) err("templates/manifest.json", `${where}: "${f.key}" is filled in automatically and cannot be a field`);
      else if (fields.has(f.key)) err("templates/manifest.json", `${where}: field "${f.key}" is listed twice`);
      if (!nonEmpty(f.label)) err("templates/manifest.json", `${where}: field "${f.key}" needs a "label"`);
      if (!SCOPES.includes(f.scope)) err("templates/manifest.json", `${where}: field "${f.key}": "scope" must be one of ${SCOPES.join(", ")}`);
      fields.set(f.key, f);
    }
    templates.set(t.file, { fields });
    const svgPath = `templates/${t.file}`;
    if (!exists(svgPath)) {
      err("templates/manifest.json", `${where}: ${svgPath} does not exist`);
      continue;
    }
    // Every {{placeholder}} of the SVG has to be a built-in value or a declared field, and the other way round.
    const used = templatePlaceholders(readText(svgPath));
    for (const key of used) if (!BUILTIN_KEYS.includes(key) && !fields.has(key)) err("templates/manifest.json", `${where}: the SVG prints {{${key}}} but the manifest does not declare it`);
    for (const key of fields.keys()) if (!used.includes(key)) warn("templates/manifest.json", `${where}: field "${key}" is declared but the SVG never prints it`);
    templates.get(t.file).placeholders = used;
  }
}

// ── sets (one file per set of certificates: sets/<code>.json) ───────────────
// A set file has two parts: "certificate" (the same on every certificate of the set) and "people"
// (person id → person). The ID printed on a certificate is SPC-<code>-<person id>.
let certificateCount = 0;

const files = listSetFiles();
for (const rel of files) {
  const m = /^sets\/([^/]+)\.json$/.exec(rel);
  const stem = m?.[1] ?? "";
  const set = m ? load(rel) : null;
  if (!m) err(rel, "only sets/<code>.json files belong in sets/");
  if (!isObject(set)) {
    if (set !== null) err(rel, "must contain a JSON object");
    continue;
  }
  if (!SET_CODE_RE.test(set.code ?? "")) err(rel, `"code" must be 2–12 capital letters or digits, starting with a letter (got "${set.code ?? ""}")`);
  else if (setFileName(set.code) !== `${stem}.json`) err(rel, `the file must be named ${setFileName(set.code)} to match its code "${set.code}"`);

  // ── part 1: the certificate ──
  const cert = set.certificate;
  if (!isObject(cert)) {
    err(rel, `"certificate" (the part shared by everyone in the set) is missing`);
    continue;
  }
  if (!nonEmpty(cert.title)) err(rel, `certificate.title is required — what the certificates are for`);
  if (!isIsoDate(cert.date)) err(rel, `certificate.date must be a real date written 2026-06-15 (got "${cert.date ?? ""}")`);
  if (cert.course_id !== undefined && !nonEmpty(cert.course_id)) err(rel, `certificate.course_id must be a course id from courses.json, or left out`);
  const tpl = templates.get(cert.template);
  if (!tpl) err(rel, `certificate.template "${cert.template ?? ""}" is not listed in templates/manifest.json`);

  const checkFields = (where, fields, allowed) => {
    if (fields === undefined) return;
    if (!isObject(fields)) return err(rel, `${where}: "fields" must be an object`);
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value !== "string") err(rel, `${where}: field "${key}" must be text`);
      if (tpl && !allowed.includes(key)) {
        const declared = tpl.fields.get(key);
        err(rel, declared ? `${where}: field "${key}" belongs to ${declared.scope === "set" ? "the certificate part, not to a person" : "a person, not to the certificate part"}` : `${where}: template ${cert.template} has no field "${key}"`);
      }
    }
  };
  const scoped = (...scopes) => (tpl ? [...tpl.fields.values()].filter((f) => scopes.includes(f.scope)).map((f) => f.key) : []);
  checkFields("certificate", cert.fields, scoped("set", "either"));

  // ── part 2: the people ──
  if (!isObject(set.people)) {
    err(rel, `"people" must be an object: person id → person`);
    continue;
  }
  const entries = Object.entries(set.people);
  // JSON.parse silently keeps the last of two equal keys, which would drop a person: look for repeats in the text.
  const keyCount = [...readText(rel).matchAll(/"([0-9A-HJKMNP-TV-Z]{5})"\s*:\s*\{/g)].length;
  if (keyCount > entries.filter(([pid]) => PERSON_ID_RE.test(pid)).length) err(rel, `a person id appears twice in "people" — ids must be unique inside the file`);
  if (entries.length === 0) warn(rel, "the set has no people yet");
  if (entries.length > 5000) warn(rel, `${entries.length} people in one file — the verification page downloads the whole file for every lookup; consider a second set`);

  const names = new Map();
  const empty = new Map(); // placeholder → number of certificates that print nothing for it
  for (const [pid, r] of entries) {
    const who = `person ${pid}${isObject(r) && r.name ? ` (${r.name})` : ""}`;
    if (!PERSON_ID_RE.test(pid)) err(rel, `${who}: a person id is exactly 5 characters from 0-9 and A-Z without I, L, O, U (got "${pid}")`);
    else if (idCheck(formatId(set.code ?? "XX", pid)) === "invalid") warn(rel, `${who}: the check character of "${pid}" is wrong — was it typed by hand? The website will call this ID mistyped even when it is entered exactly`);
    if (!isObject(r)) {
      err(rel, `${who}: must be an object`);
      continue;
    }
    certificateCount += 1;
    if (!nonEmpty(r.name)) err(rel, `${who}: "name" is required`);
    checkFields(who, r.fields, scoped("recipient", "either"));
    if (r.note !== undefined && typeof r.note !== "string") err(rel, `${who}: "note" must be text`);
    if (r.revoked !== undefined) {
      if (!isObject(r.revoked) || !isIsoDate(r.revoked.date)) err(rel, `${who}: "revoked" needs a "date" written 2026-06-15`);
      else if (r.revoked.reason !== undefined && typeof r.revoked.reason !== "string") err(rel, `${who}: "revoked.reason" must be text`);
    }
    if (nonEmpty(r.name)) names.set(r.name.trim().toLowerCase(), (names.get(r.name.trim().toLowerCase()) ?? 0) + 1);
    if (tpl) {
      const values = { ...(isObject(cert.fields) ? cert.fields : {}), ...(isObject(r.fields) ? r.fields : {}) };
      for (const key of tpl.placeholders ?? []) {
        if (BUILTIN_KEYS.includes(key) || key === "course1") continue; // course1 falls back to the title
        if (!nonEmpty(values[key])) empty.set(key, (empty.get(key) ?? 0) + 1);
      }
    }
  }
  for (const [name, n] of names) if (n > 1) warn(rel, `"${name}" appears ${n} times in this set (a duplicate, or two people with the same name?)`);
  for (const [key, n] of empty) warn(rel, `${n} certificate${n === 1 ? "" : "s"} print nothing for {{${key}}} on ${cert.template}`);
}

// ── report ───────────────────────────────────────────────────────────────────
for (const w of warnings) console.warn(`⚠  ${w}`);
for (const e of errors) console.error(`✖  ${e}`);
if (errors.length) {
  console.error(`\n${errors.length} error(s), ${warnings.length} warning(s).`);
  process.exit(1);
}
console.log(`✔ Registry is valid: ${files.length} set${files.length === 1 ? "" : "s"}, ${certificateCount} certificate${certificateCount === 1 ? "" : "s"} (${warnings.length} warning(s)).`);
