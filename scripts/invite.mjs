// Who may sign in to Cairn. Run from anywhere in the repository:
//
//   node scripts/invite.mjs add friend@gmail.com "met at HackMIT"
//   node scripts/invite.mjs remove friend@gmail.com
//   node scripts/invite.mjs list
//
// Add the address someone signs in with first, on their phone: their own
// Google account. A college account they add later joins them and needs no
// invite. Removing someone stops their checks at once and keeps them from
// signing in again; it does not delete their notes.
//
// It talks to the Worker's D1 database through wrangler, so it needs the
// Cloudflare login `wrangler login` set up (once, on this computer).
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WORKER = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "worker");
const [command, rawEmail, ...noteWords] = process.argv.slice(2);

function usage(problem) {
  if (problem) console.error(problem + "\n");
  console.error("Usage:\n  node scripts/invite.mjs add <email> [note]\n  node scripts/invite.mjs remove <email>\n  node scripts/invite.mjs list");
  process.exit(1);
}

// The SQL goes to wrangler as text, so only plain addresses and notes get in.
function email() {
  const value = (rawEmail ?? "").trim().toLowerCase();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(value)) usage(`"${rawEmail ?? ""}" doesn't look like an email address.`);
  return value;
}
const quote = (text) => `'${text.replace(/'/g, "''")}'`;

function sql(statement) {
  const run = spawnSync("npx", ["wrangler", "d1", "execute", "cairn", "--remote", "--json", "--command", JSON.stringify(statement)], {
    cwd: WORKER,
    encoding: "utf8",
    shell: true,
  });
  const text = run.stdout ?? "";
  const start = text.indexOf("[");
  if (run.status !== 0 || start < 0) {
    console.error((run.stderr || text).trim() || "wrangler failed. Run `npx wrangler login` in apps/worker and try again.");
    process.exit(1);
  }
  return JSON.parse(text.slice(start))[0];
}

if (command === "add") {
  const who = email();
  const note = noteWords.join(" ").slice(0, 200);
  const result = sql(`INSERT INTO invites (email, note, created_at) VALUES (${quote(who)}, ${note ? quote(note) : "NULL"}, ${Date.now()}) ON CONFLICT (email) DO UPDATE SET note = COALESCE(excluded.note, invites.note)`);
  console.log(result.success ? `Invited ${who}. They can sign in to Cairn now.` : "That didn't work.");
} else if (command === "remove") {
  const who = email();
  const result = sql(`DELETE FROM invites WHERE email = ${quote(who)}`);
  const changed = result.meta?.changes ?? 0;
  console.log(changed ? `Removed ${who}. Their checks stop and they can't sign in again.` : `${who} wasn't on the list.`);
} else if (command === "list") {
  const { results } = sql("SELECT i.email, COALESCE(i.note, '') AS note, date(i.created_at / 1000, 'unixepoch') AS invited, CASE WHEN u.uid IS NULL THEN 'not yet' ELSE 'yes' END AS signed_in FROM invites i LEFT JOIN users u ON lower(u.email) = i.email ORDER BY i.created_at");
  if (!results.length) console.log("Nobody is invited yet.");
  else console.table(results);
  console.log(`${results.length} of 100 places used (Google allows an unverified app 100 people).`);
} else {
  usage(command ? `Unknown command "${command}".` : "");
}
