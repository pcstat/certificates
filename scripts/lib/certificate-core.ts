/**
 * The rules every part of the certificate system shares: the ID format, the date format and how a certificate
 * template is filled in.
 *
 * THIS FILE EXISTS IN THREE REPOSITORIES AND MUST STAY IDENTICAL:
 *   certificates  scripts/lib/certificate-core.ts   (validator and build script, run by Node)
 *   admin         src/lib/certificates/core.ts       (issuing, searching, preview)
 *   website       src/lib/certificates/core.ts       (verification page and certificate viewer)
 * It has no imports and uses only syntax that Node can run directly, so the same file works everywhere.
 * `pnpm test` in the certificates repo checks the rules with fixed test vectors.
 *
 * The idea: certificates are stored in one file per SET (a course run: "PY26", "SPSS26"). Every ID starts with its
 * set's code, so whoever has an ID knows which single file to open — no index, no searching.
 */

/** Crockford's base 32: digits and capitals without I, L, O, U — nothing that can be mistaken for something else. */
export const ID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A set code: the short name of one set of certificates ("PY26"). Letters and digits of ID_ALPHABET only, starting with a letter. */
export const SET_CODE_RE = /^[A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]{1,11}$/;

/** Length of the end of every ID: 7 random characters + 1 check character. */
const TAIL_LENGTH = 8;

/** One certificate as the public verification files store it (and as the website reads it). */
export interface CertificateRecord {
  /** The ID as printed on the certificate, e.g. "PY26-K7M4-9QXC". */
  id: string;
  recipient: string;
  /** Course title as printed. */
  course: string;
  /** ISO date, 2026-06-15. */
  date: string;
  /** File name of the SVG template, e.g. "Certificate_B.svg". */
  template: string;
  status: "valid" | "revoked";
  revoked_at?: string;
  revoked_reason?: string;
  /** Every other value the template prints (reason, signatories, score, grade …). */
  fields: Record<string, string>;
}

/**
 * The form of an ID that is the same however it is typed: capitals only, no dashes or spaces, and the look-alike
 * characters O → 0, I and L → 1. "spc-2026-k7m4-9qxc", "SPC 2026 K7M4 9QXC" and "SPC2026K7M49QXC" are one ID.
 * This is the key under which a certificate is stored and looked up.
 */
export function normalizeId(input: unknown): string {
  return String(input ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
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

/**
 * Splits an ID into the code of its set and its 8-character tail: "py26-k7m4-9qxc" → { set: "PY26", tail: "K7M49QXC" }.
 * The set code is what tells which file holds the certificate (sets/py26.json), so nothing else has to be searched.
 * Returns null when the input cannot be an ID of this system.
 */
export function splitId(input: unknown): { set: string; tail: string } | null {
  const key = normalizeId(input);
  if (key.length < TAIL_LENGTH + 2) return null;
  const set = key.slice(0, key.length - TAIL_LENGTH);
  const tail = key.slice(key.length - TAIL_LENGTH);
  return SET_CODE_RE.test(set) && /^[0-9A-HJKMNP-TV-Z]+$/.test(tail) ? { set, tail } : null;
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
  return checkChar(parts.tail.slice(0, TAIL_LENGTH - 1)) === parts.tail[TAIL_LENGTH - 1] ? "valid" : "invalid";
}

/** A new random ID of a set, such as "PY26-K7M4-9QXC", that is not in `taken` (normalized IDs, as a Set or any list). */
export function generateId(setCode: string, taken: Iterable<string> = []): string {
  if (!SET_CODE_RE.test(setCode)) throw new Error(`The set code must be 2–12 letters or digits, starting with a letter, without I, L, O or U — got "${setCode}".`);
  const used = taken instanceof Set ? (taken as Set<string>) : new Set(taken);
  for (;;) {
    const bytes = new Uint8Array(TAIL_LENGTH - 1);
    globalThis.crypto.getRandomValues(bytes);
    let body = "";
    for (const b of bytes) body += ID_ALPHABET[b % 32];
    const tail = body + checkChar(body);
    const id = `${setCode}-${tail.slice(0, 4)}-${tail.slice(4)}`;
    if (!used.has(normalizeId(id))) return id;
  }
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

/** The values a template prints for one certificate. `course1` falls back to the course (templates with a one-line course). */
export function templateValues(record: Pick<CertificateRecord, "id" | "recipient" | "course" | "date" | "fields">): Record<string, string> {
  return {
    course1: record.course,
    ...record.fields,
    name: record.recipient,
    id: record.id,
    date: formatDateLong(record.date),
    course: record.course,
  };
}
