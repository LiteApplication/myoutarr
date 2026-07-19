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
	`,
	// 3 - playlist sync: mirror an upstream playlist into a Jellyfin playlist and
	// poll followed playlists for newly-added songs.
	`
	-- Remember the Jellyfin playlist a batch materialised into, so repeated syncs
	-- extend the same playlist instead of matching by (mutable) name each time.
	ALTER TABLE batches ADD COLUMN jellyfin_playlist_id TEXT;

	CREATE TABLE playlist_subscriptions (
		browse_id       TEXT PRIMARY KEY,          -- YT Music playlist id (VL…/PL…/OLAK5uy…)
		title           TEXT NOT NULL,
		thumbnail       TEXT,
		enabled         INTEGER NOT NULL DEFAULT 1, -- per-playlist poll toggle
		created_by      TEXT NOT NULL,             -- Jellyfin user id the downloads are attributed to
		created_at      INTEGER NOT NULL,          -- unix ms
		last_checked_at INTEGER                    -- unix ms; NULL until first check
	) STRICT;

	-- Video ids already accounted for, so a check only enqueues songs added after
	-- the playlist was followed. Seeded with the current tracklist on subscribe.
	CREATE TABLE playlist_seen (
		browse_id  TEXT NOT NULL
			REFERENCES playlist_subscriptions (browse_id) ON DELETE CASCADE,
		video_id   TEXT NOT NULL,
		seen_at    INTEGER NOT NULL,               -- unix ms
		PRIMARY KEY (browse_id, video_id)
	) STRICT;
	`,
	// 4 - recommendation playlists: a daily "radio" that prepends new songs
	// matching a seeded playlist's evolving vibe.
	`
	-- Prepend flag: recommendation batches insert new tracks at the front of the
	-- Jellyfin playlist instead of appending.
	ALTER TABLE batches ADD COLUMN prepend INTEGER NOT NULL DEFAULT 0;

	CREATE TABLE recommendation_playlists (
		id              TEXT PRIMARY KEY,           -- generated uuid
		name            TEXT NOT NULL,              -- Jellyfin playlist name (materialisation key)
		daily_count     INTEGER NOT NULL DEFAULT 1, -- songs prepended per run
		created_by      TEXT NOT NULL,              -- Jellyfin user id downloads are attributed to
		created_at      INTEGER NOT NULL,
		last_checked_at INTEGER                     -- unix ms; NULL until first run
	) STRICT;

	-- Every track ever in the playlist: original seeds + all recommendations. Doubles
	-- as the radio-seed pool (sampled each run) and the dedupe/"seen" set.
	CREATE TABLE recommendation_tracks (
		playlist_id TEXT NOT NULL
			REFERENCES recommendation_playlists (id) ON DELETE CASCADE,
		video_id    TEXT NOT NULL,
		title       TEXT NOT NULL,
		artist      TEXT NOT NULL,
		is_seed     INTEGER NOT NULL DEFAULT 0,     -- original seed vs recommended
		added_at    INTEGER NOT NULL,
		PRIMARY KEY (playlist_id, video_id)
	) STRICT;
	`,
	// 5 - make playlist sync optional per batch
	`
	ALTER TABLE batches ADD COLUMN sync_jellyfin INTEGER NOT NULL DEFAULT 1;
	`,
	// 6 - multiuser: subscriptions become per-user. Until now a subscription keyed
	// on browse_id alone, so two users following the same artist/playlist collided
	// on one row (and shared one seen-set). Re-key both tables on
	// (browse_id, created_by) so each user owns an independent subscription.
	// Existing rows keep their recorded created_by (their real owner); nothing is
	// reassigned. Table-rebuild recipe (foreign_keys stays ON inside the migration
	// transaction): build the new tables under temp names, copy, drop the old ones,
	// then rename - the parent rename rewrites the child FK to the final name.
	`
	CREATE TABLE artist_subscriptions_new (
		browse_id       TEXT NOT NULL,
		name            TEXT NOT NULL,
		thumbnail       TEXT,
		created_by      TEXT NOT NULL,            -- Jellyfin user id; owner of this subscription
		created_at      INTEGER NOT NULL,
		last_checked_at INTEGER,
		PRIMARY KEY (browse_id, created_by)
	) STRICT;
	INSERT INTO artist_subscriptions_new (browse_id, name, thumbnail, created_by, created_at, last_checked_at)
		SELECT browse_id, name, thumbnail, created_by, created_at, last_checked_at FROM artist_subscriptions;

	CREATE TABLE subscription_seen_new (
		browse_id  TEXT NOT NULL,
		created_by TEXT NOT NULL,
		release_id TEXT NOT NULL,
		seen_at    INTEGER NOT NULL,
		PRIMARY KEY (browse_id, created_by, release_id),
		FOREIGN KEY (browse_id, created_by)
			REFERENCES artist_subscriptions_new (browse_id, created_by) ON DELETE CASCADE
	) STRICT;
	INSERT INTO subscription_seen_new (browse_id, created_by, release_id, seen_at)
		SELECT s.browse_id, a.created_by, s.release_id, s.seen_at
		FROM subscription_seen s
		JOIN artist_subscriptions a ON a.browse_id = s.browse_id;

	DROP TABLE subscription_seen;
	DROP TABLE artist_subscriptions;
	ALTER TABLE artist_subscriptions_new RENAME TO artist_subscriptions;
	ALTER TABLE subscription_seen_new RENAME TO subscription_seen;
	CREATE INDEX idx_artist_subs_user ON artist_subscriptions (created_by);

	CREATE TABLE playlist_subscriptions_new (
		browse_id       TEXT NOT NULL,
		title           TEXT NOT NULL,
		thumbnail       TEXT,
		enabled         INTEGER NOT NULL DEFAULT 1,
		created_by      TEXT NOT NULL,            -- Jellyfin user id; owner of this subscription
		created_at      INTEGER NOT NULL,
		last_checked_at INTEGER,
		PRIMARY KEY (browse_id, created_by)
	) STRICT;
	INSERT INTO playlist_subscriptions_new (browse_id, title, thumbnail, enabled, created_by, created_at, last_checked_at)
		SELECT browse_id, title, thumbnail, enabled, created_by, created_at, last_checked_at FROM playlist_subscriptions;

	CREATE TABLE playlist_seen_new (
		browse_id  TEXT NOT NULL,
		created_by TEXT NOT NULL,
		video_id   TEXT NOT NULL,
		seen_at    INTEGER NOT NULL,
		PRIMARY KEY (browse_id, created_by, video_id),
		FOREIGN KEY (browse_id, created_by)
			REFERENCES playlist_subscriptions_new (browse_id, created_by) ON DELETE CASCADE
	) STRICT;
	INSERT INTO playlist_seen_new (browse_id, created_by, video_id, seen_at)
		SELECT s.browse_id, p.created_by, s.video_id, s.seen_at
		FROM playlist_seen s
		JOIN playlist_subscriptions p ON p.browse_id = s.browse_id;

	DROP TABLE playlist_seen;
	DROP TABLE playlist_subscriptions;
	ALTER TABLE playlist_subscriptions_new RENAME TO playlist_subscriptions;
	ALTER TABLE playlist_seen_new RENAME TO playlist_seen;
	CREATE INDEX idx_playlist_subs_user ON playlist_subscriptions (created_by);
	`
];
