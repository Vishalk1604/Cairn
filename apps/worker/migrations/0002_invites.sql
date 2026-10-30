-- Cairn is invite-only: only an address on this list can sign in as a new
-- person, and the cron only checks people whose own address is on it.
-- College accounts join someone already signed in, so they need no row here.
-- Managed with `node scripts/invite.mjs add|remove|list` from the repository.
CREATE TABLE IF NOT EXISTS invites (
  email TEXT PRIMARY KEY,
  note TEXT,
  created_at INTEGER NOT NULL
);

-- Everyone already using Cairn keeps their place.
INSERT OR IGNORE INTO invites (email, note, created_at)
  SELECT lower(email), 'using Cairn before invites', CAST(strftime('%s', 'now') AS INTEGER) * 1000 FROM users;
