#!/usr/bin/env node
/**
 * Makes sure a Cloudflare Pages project exists — creates it (as a "direct upload" project) when it does not.
 * The same file is used by the database and the website repo.
 *
 * Env:
 *   CLOUDFLARE_API_TOKEN   token with  Account → Cloudflare Pages → Edit
 *   CLOUDFLARE_ACCOUNT_ID  your account id
 *   PROJECT_NAME           the project name (it becomes <name>.pages.dev)
 *   PRODUCTION_BRANCH      optional, default "main"
 *
 * Writes `subdomain=<real>.pages.dev` to $GITHUB_OUTPUT and the job summary. The real subdomain can
 * differ from the project name: when the name is already taken by someone else, Cloudflare appends
 * a random suffix (e.g. "database-34a.pages.dev").
 */
import fs from "node:fs";

const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account, PROJECT_NAME: name } = process.env;
const branch = process.env.PRODUCTION_BRANCH || "main";

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}
if (!token) fail("CLOUDFLARE_API_TOKEN is not set. Add it as a GitHub Actions secret (see docs/DEPLOYMENT.md).");
if (!account) fail("CLOUDFLARE_ACCOUNT_ID is not set. Add it as a GitHub Actions secret (see docs/DEPLOYMENT.md).");
if (!name || !/^[a-z0-9][a-z0-9-]{0,56}[a-z0-9]$/.test(name)) {
  fail(`Invalid Cloudflare project name "${name ?? ""}": use 3–58 lowercase letters, digits and hyphens (no leading/trailing hyphen).`);
}

const base = process.env.CLOUDFLARE_API_BASE || "https://api.cloudflare.com/client/v4"; // override is for tests only
const api = `${base}/accounts/${account}/pages/projects`;
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

async function call(url, init) {
  let res;
  try {
    res = await fetch(url, { ...init, headers });
  } catch (error) {
    fail(`Could not reach the Cloudflare API: ${error instanceof Error ? error.message : error}`);
  }
  const body = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok && body.success !== false, body };
}
const describe = (r) => (r.body?.errors ?? []).map((e) => `${e.code}: ${e.message}`).join("; ") || `HTTP ${r.status}`;

let res = await call(`${api}/${name}`);
if (res.status === 404) {
  console.log(`Pages project "${name}" does not exist yet — creating it (production branch: ${branch}).`);
  res = await call(api, { method: "POST", body: JSON.stringify({ name, production_branch: branch }) });
  if (!res.ok) fail(`Could not create the Pages project "${name}": ${describe(res)}`);
  console.log(`Created Pages project "${name}".`);
} else if (!res.ok) {
  fail(
    `Could not read the Pages project "${name}": ${describe(res)}. ` +
      "Check CLOUDFLARE_ACCOUNT_ID and that the API token has the permission Account → Cloudflare Pages → Edit.",
  );
} else {
  console.log(`Pages project "${name}" already exists.`);
}

const subdomain = res.body.result?.subdomain || `${name}.pages.dev`;
console.log(`Public address: https://${subdomain}`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `subdomain=${subdomain}\n`);
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Cloudflare Pages project\n\n**${name}** → https://${subdomain}\n`);
}
