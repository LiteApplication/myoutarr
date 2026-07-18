/**
 * Sequential migrations, applied in order and tracked via PRAGMA user_version.
 * Never edit an entry after release - append a new one.
 */
export const migrations: string[] = [
	// 1 - initial schema
	`
	CREATE TABLE settings (
		key   TEXT PRIMARY KEY,
		value TEXT NOT NULL -- JSON-encoded
	) STRICT;

	CREATE TABLE sessions (
		id             TEXT PRIMARY KEY,        -- opaque token handed to the browser
		jellyfin_token TEXT NOT NULL,
		user_id        TEXT NOT NULL,           -- Jellyfin user id
		user_name      TEXT NOT NULL,
		is_admin       INTEGER NOT NULL DEFAULT 0,
		created_at     INTEGER NOT NULL,        -- unix ms
		expires_at     INTEGER NOT NULL
	) STRICT;
	CREATE INDEX idx_sessions_expires ON sessions (expires_at);

	CREATE TABLE batches (
		id           TEXT PRIMARY KEY,
		kind         TEXT NOT NULL CHECK (kind IN ('song', 'album', 'artist', 'playlist')),
		source_id    TEXT NOT NULL,             -- YT Music browse/video id
		title        TEXT NOT NULL,
		artist       TEXT,
		thumbnail    TEXT,
		created_at   INTEGER NOT NULL,
		created_by   TEXT NOT NULL              -- Jellyfin user id
	) STRICT;

	CREATE TABLE jobs (
		id            TEXT PRIMARY KEY,
		batch_id      TEXT NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
		video_id      TEXT NOT NULL,
		status        TEXT NOT NULL DEFAULT 'queued'
			CHECK (status IN ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled')),
		position      INTEGER NOT NULL,          -- order within the queue
		attempts      INTEGER NOT NULL DEFAULT 0,
		progress      REAL NOT NULL DEFAULT 0,   -- 0..1
		-- resolved metadata (JSON): title/artist/album/track no/mbids/…
		meta          TEXT NOT NULL DEFAULT '{}',
		error         TEXT,                      -- last failure: message + stderr tail
		next_retry_at INTEGER,                   -- unix ms; backoff gate
		started_at    INTEGER,
		finished_at   INTEGER,
		output_path   TEXT                       -- final library path once published
	) STRICT;
	CREATE INDEX idx_jobs_batch ON jobs (batch_id);
	CREATE INDEX idx_jobs_claim ON jobs (status, next_retry_at, position);

	CREATE TABLE mb_cache (
		key        TEXT PRIMARY KEY,             -- request fingerprint
		value      TEXT NOT NULL,                -- JSON response
		fetched_at INTEGER NOT NULL
	) STRICT;
	`,
	// 2 - artist subscriptions: auto-download new releases
	`
	CREATE TABLE artist_subscriptions (
		browse_id       TEXT PRIMARY KEY,         -- YT Music artist channel id (UC…)
		name            TEXT NOT NULL,
		thumbnail       TEXT,
		created_by      TEXT NOT NULL,            -- Jellyfin user id the downloads are attributed to
		created_at      INTEGER NOT NULL,         -- unix ms
		last_checked_at INTEGER                   -- unix ms; NULL until first check
	) STRICT;

	-- Releases already accounted for, so a daily check only enqueues genuinely
	-- new ones. Seeded with the artist's current discography on subscribe.
	CREATE TABLE subscription_seen (
		browse_id  TEXT NOT NULL
			REFERENCES artist_subscriptions (browse_id) ON DELETE CASCADE,
		release_id TEXT NOT NULL,                 -- album browseId (MPRE…)
		seen_at    INTEGER NOT NULL,              -- unix ms
		PRIMARY KEY (browse_id, release_id)
	) STRICT;
	`
];
