#!/usr/bin/env node
/**
 * Fixed test vectors for the rules in scripts/lib/certificate-core.ts. The same file is used by the admin panel and
 * the website, so these values must never change: an ID printed today has to verify years from now.
 */
import assert from "node:assert/strict";
import { ID_ALPHABET, SET_CODE_RE, checkChar, escapeXml, formatDateLong, generateId, idCheck, isIsoDate, normalizeId, renderTemplate, setFileName, splitId, templatePlaceholders, templateValues } from "./lib/certificate-core.ts";

let passed = 0;
const test = (name, fn) => Promise.resolve(fn()).then(() => { passed += 1; }, (e) => { console.error(`✖ ${name}\n${e.message}`); process.exitCode = 1; });

await test("normalizeId ignores case, dashes, spaces and look-alike characters", () => {
  assert.equal(normalizeId("py26-k7m4-9qxc"), "PY26K7M49QXC");
  assert.equal(normalizeId(" PY26 K7M4 9QXC "), "PY26K7M49QXC");
  assert.equal(normalizeId("PY26-K7M4-9QXI"), "PY26K7M49QX1"); // I typed for 1
  assert.equal(normalizeId(undefined), "");
});

await test("check characters (fixed vectors, cross-checked with an independent Luhn mod 32 validator)", () => {
  assert.equal(checkChar("0000000"), "0");
  for (const [body, check] of [["WQXKACC", "A"], ["0123456", "Z"], ["ZZZZZZZ", "7"], ["K7M49QX", "1"]]) assert.equal(checkChar(body), check, `${body} → ${check}`);
});

await test("splitId finds the set of an ID, however it is typed", () => {
  assert.deepEqual(splitId("PY26-K7M4-9QX1"), { set: "PY26", tail: "K7M49QX1" });
  assert.deepEqual(splitId("py26 k7m4 9qx1"), { set: "PY26", tail: "K7M49QX1" });
  assert.deepEqual(splitId("SPSS26K7M49QX1"), { set: "SPSS26", tail: "K7M49QX1" });
  assert.equal(splitId("K7M4-9QX1"), null); // no set code
  assert.equal(splitId("2026-K7M4-9QX1"), null); // a set code starts with a letter
  assert.equal(splitId(""), null);
  assert.equal(setFileName("PY26"), "py26.json");
});

await test("idCheck tells a typo from something that is not an ID", () => {
  assert.equal(idCheck("PY26-WQXK-ACCA"), "valid");
  assert.equal(idCheck("py26 wqxk acca"), "valid");
  assert.equal(idCheck("PY26-WQXK-ACCB"), "invalid");
  assert.equal(idCheck("PY26-WQXK-ACAC"), "invalid"); // two characters swapped
  assert.equal(idCheck("hello"), "other");
  assert.equal(idCheck(""), "other");
});

await test("set codes", () => {
  for (const ok of ["PY26", "R26", "SPSS26", "AB"]) assert.ok(SET_CODE_RE.test(ok), ok);
  for (const bad of ["26PY", "P", "PYTHON26", "PYTHONISGREAT1", "py26", "PL26", "P-26"]) assert.ok(!SET_CODE_RE.test(bad), bad);
});

await test("generateId makes valid, unique IDs that start with the set code", () => {
  const taken = new Set();
  for (let i = 0; i < 500; i += 1) {
    const id = generateId("PY26", taken);
    assert.match(id, /^PY26-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    assert.equal(idCheck(id), "valid");
    assert.equal(splitId(id).set, "PY26");
    assert.ok(!taken.has(normalizeId(id)));
    taken.add(normalizeId(id));
  }
  assert.equal(ID_ALPHABET.length, 32);
  assert.throws(() => generateId("py26"), /set code/);
});

await test("every single-character typo is caught", () => {
  const tail = "WQXKACCA";
  for (let p = 0; p < 8; p += 1) for (const ch of ID_ALPHABET) {
    if (ch === tail[p]) continue;
    assert.equal(idCheck(`PY26${tail.slice(0, p)}${ch}${tail.slice(p + 1)}`), "invalid");
  }
});

await test("dates", () => {
  assert.equal(formatDateLong("2026-06-15"), "June 15, 2026");
  assert.equal(formatDateLong("2026-12-01"), "December 1, 2026");
  assert.equal(formatDateLong("not a date"), "not a date");
  assert.ok(isIsoDate("2024-02-29"));
  assert.ok(!isIsoDate("2026-02-29"));
  assert.ok(!isIsoDate("2026-13-01"));
  assert.ok(!isIsoDate("2026-6-1"));
});

await test("templates are filled safely", () => {
  assert.equal(escapeXml(`<a href="x">Tom & 'Jerry'</a>`), "&lt;a href=&quot;x&quot;&gt;Tom &amp; &apos;Jerry&apos;&lt;/a&gt;");
  assert.equal(renderTemplate("<t>{{name}}|{{ id }}|{{missing}}</t>", { name: "A & B {{id}}", id: "X" }), "<t>A &amp; B {{id}}|X|</t>");
  assert.deepEqual(templatePlaceholders("{{a}} {{b}} {{a}} {{ c }}"), ["a", "b", "c"]);
  const values = templateValues({ id: "SPC-1", recipient: "Jane", course: "R", date: "2026-07-10", fields: { score: "9" } });
  assert.deepEqual(values, { course1: "R", score: "9", name: "Jane", id: "SPC-1", date: "July 10, 2026", course: "R" });
  assert.equal(templateValues({ id: "x", recipient: "y", course: "R", date: "2026-07-10", fields: { course1: "Line one" } }).course1, "Line one");
});

if (process.exitCode) process.exit(process.exitCode);
console.log(`✔ ${passed} test groups passed.`);
