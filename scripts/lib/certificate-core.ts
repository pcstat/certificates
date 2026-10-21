/**
 * The rules every part of the certificate system shares: the ID format, the date format, how the two parts of a set
 * file are merged into one certificate, and how a certificate template is filled in.
 *
 * THIS FILE EXISTS IN THREE REPOSITORIES AND MUST STAY IDENTICAL:
 *   certificates  scripts/lib/certificate-core.ts   (validator and build script, run by Node)
 *   admin         src/lib/certificates/core.ts       (issuing, searching, preview)
 *   website       src/lib/certificates/core.ts       (verification page and certificate viewer)
 * It has no imports and uses only syntax that Node can run directly, so the same file works everywhere.
 * `node scripts/test.mjs` in the certificates repo checks the rules with fixed test vectors.
 *
 * The idea: certificates are stored one file per SET (sets/py26.json). A set file has two parts:
 *   "certificate"  what is the same on every certificate of the set (design, title, date, signatories …) — written once;
 *   "people"       one entry per person, keyed by a short PERSON ID that only has to be unique inside this file.
 * A printed ID is  SPC-<set code>-<person id>  (SPC-PY26-7W348): the set code names the file to open, the person id
 * names the entry in it. Merging the two parts gives the certificate, so nothing is searched and nothing is repeated.
 */

/** Crockford's base 32: digits and capitals without I, L, O, U — nothing that can be mistaken for something else. */
export const ID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A set code: the short name of one set file ("PY26", "CONTEST26"). Capital letters and digits, starting with a letter. */
export const SET_CODE_RE = /^[A-Z][A-Z0-9]{1,11}$/;

/** What is printed on every certificate of a set (the first part of the file). Nothing personal. */
export interface CertificateSection {
  /** What the certificate is for, printed and shown on the verification page: a course, a contest, "Active member 2026" … */
  title: string;
  /** ISO date, 2026-06-15. */
  date: string;
  /** File name of the SVG design, e.g. "Certificate_B.svg". */
  template: string;
  /** Optional link to a course in the database's courses.json. A certificate does not need a course. */
  course_id?: string;
  /** Everything else the design prints that is the same for all (reason, signatories, hours …). */
  fields?: Record<string, string>;
}

/** One person of a set (the second part of the file). */
export interface PersonEntry {
  name: string;
  /** Values that differ per person (score, grade …). */
  fields?: Record<string, string>;
  /** Internal note. Never published. */
  note?: string;
  revoked?: { date: string; reason?: string };
}

/** A set file, sets/<code>.json. */
export interface SetFile {
  code: string;
  certificate: CertificateSection;
  /** Person id → person. The id is 5 characters (4 + a check character) and only has to be unique inside this file. */
  people: Record<string, PersonEntry>;
}

/** One finished certificate: the set's part and the person's part merged. */
export interface CertificateRecord {
  /** The ID as printed: SPC-PY26-7W348. */
  id: string;
  recipient: string;
  title: string;
  date: string;
  template: string;
  status: "valid" | "revoked";
  revoked_at?: string;
  revoked_reason?: string;
  /** Every value the design prints besides name / id / date / title: the set's, overridden by the person's. */
  fields: Record<string, string>;
}

/**
 * The form of an ID that is the same however it is typed: capitals and digits only, no dashes or spaces.
 * "spc-py26-7w34n", "SPC PY26 7W34N" and "SPCPY267W34N" are one ID.
 */
export function normalizeId(input: unknown): string {
  return String(input ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** The look-alike characters of a person id are one character each: O → 0, I and L → 1 (person ids never contain I, L, O). */
export function foldLookalikes(text: string): string {
  return text.replace(/O/g, "0").replace(/[IL]/g, "1");
}

/** Luhn mod 32: the check character of `body` (characters of ID_ALPHABET). Catches every single typo and most swaps. */
export function checkChar(body: string): string {
  const n = ID_ALPHABET.length;
  let factor = 2;
  let sum = 0;
  for (let i = body.length - 1; i >= 0; i -= 1) {
    const code = ID_ALPHABET.indexOf(body[i] as string);
    if (code < 0) throw new Error(`"${body[i]}" is not a valid ID character.`);
    let addend = factor * code;
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / n) + (addend % n);
    sum += addend;
  }
  return ID_ALPHABET[(n - (sum % n)) % n] as string;
}

/** Every certificate ID starts with this. */
export const ID_PREFIX = "SPC";
/** Person ids are exactly this long: 4 random characters + 1 check character. */
export const PERSON_ID_LENGTH = 5;
export const PERSON_ID_RE = /^[0-9A-HJKMNP-TV-Z]{5}$/;

/**
 * Splits an ID into the code of its set and its person id: "spc py26 7w348" → { set: "PY26", person: "7W348" }.
 * The set code names the file (sets/py26.json); the person id names the entry in it. Because the person id has a fixed
 * length, the ID is read the same however it was typed (dashes, spaces, case, O for 0).
 * Returns null when the input cannot be an ID of this system.
 */
export function splitId(input: unknown): { set: string; person: string } | null {
  const key = normalizeId(input);
  if (!key.startsWith(ID_PREFIX)) return null;
  const rest = key.slice(ID_PREFIX.length);
  if (rest.length < PERSON_ID_LENGTH + 2) return null;
  const set = rest.slice(0, rest.length - PERSON_ID_LENGTH);
  const person = foldLookalikes(rest.slice(rest.length - PERSON_ID_LENGTH));
  return SET_CODE_RE.test(set) && PERSON_ID_RE.test(person) ? { set, person } : null;
}

/** The printed form of an ID: "PY26", "7W348" → "SPC-PY26-7W348". */
export function formatId(setCode: string, person: string): string {
  return `${ID_PREFIX}-${setCode}-${person}`;
}

/** The set file name for a set code: "PY26" → "py26.json" (the file lives at sets/py26.json). */
export function setFileName(code: string): string {
  return `${code.toLowerCase()}.json`;
}

/**
 * "valid"   — the check character is right,
 * "invalid" — it is wrong: someone mistyped the ID,
 * "other"   — not an ID of this system.
 */
export function idCheck(input: unknown): "valid" | "invalid" | "other" {
  const parts = splitId(input);
  if (!parts) return "other";
  return checkChar(parts.person.slice(0, PERSON_ID_LENGTH - 1)) === parts.person[PERSON_ID_LENGTH - 1] ? "valid" : "invalid";
}

/** A new random person id such as "7W348" that is not in `taken` (the person ids already used in this one file). */
export function generatePersonId(taken: Iterable<string> = []): string {
  const used = taken instanceof Set ? (taken as Set<string>) : new Set(taken);
  for (;;) {
    const bytes = new Uint8Array(PERSON_ID_LENGTH - 1);
    globalThis.crypto.getRandomValues(bytes);
    let body = "";
    for (const b of bytes) body += ID_ALPHABET[b % 32];
    const id = body + checkChar(body);
    if (!used.has(id)) return id;
  }
}

/**
 * Merges the two parts of a set file into one certificate. Returns null when the person is not in the file.
 * `person` may be typed any way (any case, O for 0 …): both sides are compared in normalized form.
 */
export function resolveCertificate(file: SetFile, person: string): CertificateRecord | null {
  const wanted = foldLookalikes(normalizeId(person));
  const stored = Object.keys(file.people).find((k) => foldLookalikes(normalizeId(k)) === wanted);
  const entry = stored ? file.people[stored] : undefined;
  if (!stored || !entry) return null;
  const fields: Record<string, string> = {};
  for (const source of [file.certificate.fields, entry.fields]) {
    for (const [k, v] of Object.entries(source ?? {})) if (typeof v === "string" && v.trim() !== "") fields[k] = v;
  }
  const record: CertificateRecord = {
    id: formatId(file.code, stored),
    recipient: entry.name,
    title: file.certificate.title,
    date: file.certificate.date,
    template: file.certificate.template,
    status: entry.revoked ? "revoked" : "valid",
    fields,
  };
  if (entry.revoked) {
    record.revoked_at = entry.revoked.date;
    if (entry.revoked.reason) record.revoked_reason = entry.revoked.reason;
  }
  return record;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** True for a real calendar date written 2026-06-15. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** "2026-06-15" → "June 15, 2026" (the form printed on certificates). Anything else is returned unchanged. */
export function formatDateLong(iso: string): string {
  if (!isIsoDate(iso)) return iso;
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

const XML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };

/** Makes text safe inside SVG/XML. A name such as "Tom & Jerry" would otherwise break the certificate, and "<script>" would run. */
export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => XML_ESCAPES[c] as string);
}

/** The `{{names}}` a template prints, in order of appearance, without repeats. */
export function templatePlaceholders(svg: string): string[] {
  return [...new Set([...svg.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)].map((m) => m[1] as string))];
}

/**
 * Fills a template in. One pass, so a value that happens to contain "{{id}}" is printed as text instead of being
 * replaced again; every value is escaped; a placeholder without a value prints nothing.
 */
export function renderTemplate(svg: string, values: Record<string, string | undefined>): string {
  return svg.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, key: string) => escapeXml(values[key] ?? ""));
}

/**
 * The values a template prints for one certificate. The title is printed in the `{{course}}` / `{{title}}` slot;
 * `course1` falls back to it (designs with a one-line title).
 */
export function templateValues(record: Pick<CertificateRecord, "id" | "recipient" | "title" | "date" | "fields">): Record<string, string> {
  return {
    course1: record.title,
    ...record.fields,
    name: record.recipient,
    id: record.id,
    date: formatDateLong(record.date),
    course: record.title,
    title: record.title,
  };
}
