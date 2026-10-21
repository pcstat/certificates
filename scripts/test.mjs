#!/usr/bin/env node
/**
 * Fixed test vectors for the rules in scripts/lib/certificate-core.ts. The same file is used by the admin panel and
 * the website, so these values must never change: an ID printed today has to verify years from now.
 */
import assert from "node:assert/strict";
import { ID_ALPHABET, foldLookalikes, PERSON_ID_RE, SET_CODE_RE, checkChar, escapeXml, formatDateLong, formatId, generatePersonId, idCheck, isIsoDate, normalizeId, renderTemplate, resolveCertificate, setFileName, splitId, templatePlaceholders, templateValues } from "./lib/certificate-core.ts";

let passed = 0;
const test = (name, fn) => Promise.resolve(fn()).then(() => { passed += 1; }, (e) => { console.error(`✖ ${name}\n${e.message}`); process.exitCode = 1; });

await test("normalizeId ignores case, dashes, spaces and look-alike characters", () => {
  assert.equal(normalizeId("spc-py26-7w34n"), "SPCPY267W34N");
  assert.equal(normalizeId(" SPC PY26 7W34N "), "SPCPY267W34N");
  assert.equal(normalizeId("SPC-PY26-7W34B"), "SPCPY267W34B");
  assert.equal(normalizeId("SPC-PY26-7WI48"), "SPCPY267WI48");
  assert.equal(foldLookalikes("7WI4O"), "7W140"); // I typed for 1, the letter O for 0
  assert.equal(normalizeId(undefined), "");
});

await test("check characters (fixed vectors, cross-checked with an independent Luhn mod 32 validator)", () => {
  assert.equal(checkChar("0000"), "0");
  for (const [body, check] of [["7W34", "N"], ["K7M4", "3"], ["ZZZZ", "4"], ["0123", "P"]]) assert.equal(checkChar(body), check, `${body} → ${check}`);
});

await test("splitId reads the set and the person from an ID, however it is typed", () => {
  assert.deepEqual(splitId("SPC-PY26-7W34N"), { set: "PY26", person: "7W34N" });
  assert.deepEqual(splitId("spc py26 7w34n"), { set: "PY26", person: "7W34N" });
  assert.deepEqual(splitId("SPCPY267W34N"), { set: "PY26", person: "7W34N" });
  assert.deepEqual(splitId("SPC-CONTEST26-00042"), { set: "CONTEST26", person: "00042" });
  assert.deepEqual(splitId("SPC-PY26-7WI48"), { set: "PY26", person: "7W148" }); // look-alikes are folded in the person id only
  assert.deepEqual(splitId("SPC-WORKSHOP1-0O0O0"), { set: "WORKSHOP1", person: "00000" });
  assert.equal(splitId("PY26-7W34N"), null); // no SPC
  assert.equal(splitId("SPC-7W34N"), null); // no set
  assert.equal(splitId("SPC-26PY-7W34N"), null); // a set code starts with a letter
  assert.equal(splitId(""), null);
  assert.equal(setFileName("PY26"), "py26.json");
  assert.equal(formatId("PY26", "7W34N"), "SPC-PY26-7W34N");
});

await test("idCheck tells a typo from something that is not an ID", () => {
  assert.equal(idCheck(formatId("PY26", "7W34N")), "valid");
  assert.equal(idCheck("spc py26 7w34n"), "valid");
  assert.equal(idCheck("SPC-PY26-7W34P"), "invalid");
  assert.equal(idCheck("SPC-PY26-7W43N"), "invalid"); // two characters swapped
  assert.equal(idCheck("hello"), "other");
  assert.equal(idCheck(""), "other");
});

await test("set codes", () => {
  for (const ok of ["PY26", "R26", "SPSS26", "AB", "CONTEST26"]) assert.ok(SET_CODE_RE.test(ok), ok);
  for (const bad of ["26PY", "P", "PYTHONISGREAT1", "py26", "P-26"]) assert.ok(!SET_CODE_RE.test(bad), bad);
});

await test("generatePersonId makes valid, unique, 5-character ids", () => {
  const taken = new Set();
  for (let i = 0; i < 2000; i += 1) {
    const id = generatePersonId(taken);
    assert.match(id, PERSON_ID_RE);
    assert.equal(idCheck(formatId("PY26", id)), "valid");
    assert.ok(!taken.has(id));
    taken.add(id);
  }
  assert.equal(ID_ALPHABET.length, 32);
});

await test("every single-character typo is caught", () => {
  const person = "7W34N";
  for (let p = 0; p < 5; p += 1) for (const ch of ID_ALPHABET) {
    if (ch === person[p]) continue;
    assert.equal(idCheck(`SPCPY26${person.slice(0, p)}${ch}${person.slice(p + 1)}`), "invalid");
  }
});

await test("the two parts of a set file merge into a certificate", () => {
  const file = {
    code: "PY26",
    certificate: { title: "Python for Data Analysis", date: "2026-04-30", template: "Certificate_C.svg", fields: { hours: "40", grade: "PASS" } },
    people: {
      "7W34N": { name: "Jane Smith", fields: { grade: "DISTINCTION", score: "92" }, note: "private" },
      "K7M49": { name: "John Doe", revoked: { date: "2026-08-01", reason: "Issued in error" } },
    },
  };
  assert.deepEqual(resolveCertificate(file, "7w34n"), { id: "SPC-PY26-7W34N", recipient: "Jane Smith", title: "Python for Data Analysis", date: "2026-04-30", template: "Certificate_C.svg", status: "valid", fields: { hours: "40", grade: "DISTINCTION", score: "92" } });
  const revoked = resolveCertificate(file, "K7M49");
  assert.equal(revoked.status, "revoked");
  assert.equal(revoked.revoked_at, "2026-08-01");
  assert.equal(revoked.revoked_reason, "Issued in error");
  assert.equal(resolveCertificate(file, "00000"), null);
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
  const values = templateValues({ id: "SPC-1", recipient: "Jane", title: "R", date: "2026-07-10", fields: { score: "9" } });
  assert.deepEqual(values, { course1: "R", score: "9", name: "Jane", id: "SPC-1", date: "July 10, 2026", course: "R", title: "R" });
  assert.equal(templateValues({ id: "x", recipient: "y", title: "R", date: "2026-07-10", fields: { course1: "Line one" } }).course1, "Line one");
});

if (process.exitCode) process.exit(process.exitCode);
console.log(`✔ ${passed} test groups passed.`);
