import { existsSync } from 'node:fs';
import type { DB } from '../db/index.ts';
import { getDb } from '../db/index.ts';
import { publish } from '../events.ts';
import { assertMounted } from '../library/publish.ts';
import { getSettings } from '../settings.ts';
import { getUserSettings, usersWithDownloadsPlaylist } from '../userSettings.ts';
import { JellyfinClient } from './client.ts';
import { tokenFor, toJellyfinPath } from './sync.ts';

const SCAN_POLL_INTERVAL_MS = 10_000;
const SCAN_POLL_ATTEMPTS = 18; // up to 3 minutes for the scan to surface new items

export interface DownloadsSyncResult {
	playlistId: string;
	/** Tracks placed in the playlist by this run. */
	added: number;
	/** Tracks known to be in the playlist afterwards. */
	total: number;
	/** Completed jobs whose file has since disappeared, reverted to 'cancelled'. */
	cancelled: number;
}

interface CandidateRow {
	id: string;
	meta: string;
	output_path: string;
}

/**
 * The playlist name for a user: their explicit choice, else "<name>'s downloads"
 * derived from the most recent session, else a generic fallback.
 */
export function downloadsPlaylistName(userId: string, db: DB = getDb()): string {
	const configured = getUserSettings(userId, db).downloadsPlaylistName.trim();
	if (configured) return configured;
	const row = db
		.prepare('SELECT user_name FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
		.get(userId) as { user_name: string } | undefined;
	return row?.user_name ? `${row.user_name}'s downloads` : 'myoutarr downloads';
}

/**
 * Revert completed jobs whose published file no longer exists to 'cancelled'.
 * Deleting a track in Jellyfin removes the file from the library, so a vanished
 * file is how a Jellyfin-side deletion reaches us. The job goes back to a
 * non-terminal-success state, which both keeps the queue honest and lets the
 * user retry it; the stale playlist membership row is dropped with it, so a
 * later re-download is resolved and re-added from scratch.
 */
function cancelVanished(userId: string, jobs: { id: string; path: string }[], db: DB): number {
	if (jobs.length === 0) return 0;
	const cancel = db.prepare(
		`UPDATE jobs SET status = 'cancelled', finished_at = ?, error = ?
		 WHERE id = ? AND status = 'completed'`
	);
	const forget = db.prepare('DELETE FROM downloads_playlist_items WHERE user_id = ? AND path = ?');
	const now = Date.now();
	const cancelled: string[] = [];
	db.transaction(() => {
		for (const job of jobs) {
			const changed = cancel.run(now, 'File is no longer in the library', job.id).changes > 0;
			forget.run(userId, job.path);
			if (changed) cancelled.push(job.id);
		}
	})();
	for (const id of cancelled) {
		publish({ type: 'job', payload: { id, status: 'cancelled' } });
	}
	return cancelled.length;
}

/**
 * Mirror everything a user has added into one Jellyfin playlist, in the order it
 * was downloaded. Idempotent and additive, and safe to run against a library
 * that has been edited from the Jellyfin side:
 *
 * - tracks whose file has been deleted are dropped and their job reverted to
 *   'cancelled' (see `cancelVanished`);
 * - a playlist deleted out from under us is recreated from the tracks we already
 *   resolved, with no re-search;
 * - tracks Jellyfin has not indexed yet are simply left for the next run.
 *
 * Only paths not already recorded as playlist members are looked up in Jellyfin,
 * so a steady-state run costs no searches at all. `poll` (default true) waits for
 * a running scan to surface newly-published files.
 */
export async function syncDownloadsPlaylist(
	userId: string,
	db: DB = getDb(),
	options: { pollIntervalMs?: number; client?: JellyfinClient; poll?: boolean } = {}
): Promise<DownloadsSyncResult | null> {
	const settings = getSettings(db);
	if (!settings.jellyfinUrl) return null;
	if (!getUserSettings(userId, db).downloadsPlaylist) return null;

	// A dropped library mount makes every file look deleted; refuse to interpret
	// that as "the user deleted their music".
	try {
		assertMounted();
	} catch (cause) {
		console.error('downloads playlist sync skipped:', (cause as Error).message);
		return null;
	}

	// Every track this user has added, oldest first. The same file can back more
	// than one job (a re-request is inserted pre-completed); the first wins.
	const rows = db
		.prepare(
			`SELECT j.id, j.meta, j.output_path
			 FROM jobs j JOIN batches b ON b.id = j.batch_id
			 WHERE b.created_by = ? AND j.status = 'completed' AND j.output_path IS NOT NULL
			 ORDER BY j.finished_at, j.position`
		)
		.all(userId) as CandidateRow[];

	const alive: { id: string; path: string; title: string }[] = [];
	const vanished: { id: string; path: string }[] = [];
	const seenPaths = new Set<string>();
	for (const row of rows) {
		if (!existsSync(row.output_path)) {
			vanished.push({ id: row.id, path: row.output_path });
			continue;
		}
		if (seenPaths.has(row.output_path)) continue;
		seenPaths.add(row.output_path);
		const meta = JSON.parse(row.meta) as { title: string };
		alive.push({ id: row.id, path: row.output_path, title: meta.title });
	}
	const cancelled = cancelVanished(userId, vanished, db);
	if (alive.length === 0) return null;

	const auth = tokenFor(userId, db);
	if (!auth) {
		console.error(`downloads playlist sync: no valid session for user ${userId}`);
		return null;
	}
	const client = options.client ?? new JellyfinClient(settings.jellyfinUrl);
	const interval = options.pollIntervalMs ?? SCAN_POLL_INTERVAL_MS;
	const attempts = options.poll === false ? 1 : SCAN_POLL_ATTEMPTS;

	// Item ids resolved on an earlier run; only the rest need a Jellyfin search.
	const known = new Map(
		(
			db
				.prepare('SELECT path, item_id FROM downloads_playlist_items WHERE user_id = ?')
				.all(userId) as { path: string; item_id: string }[]
		).map((row) => [row.path, row.item_id])
	);
	const remember = db.prepare(
		`INSERT INTO downloads_playlist_items (user_id, path, item_id, added_at) VALUES (?, ?, ?, ?)
		 ON CONFLICT (user_id, path) DO UPDATE SET item_id = excluded.item_id`
	);

	const libraryPath = settings.jellyfinLibraryPath || '/music';
	let unresolved = alive.filter((track) => !known.has(track.path));
	for (let attempt = 0; attempt < attempts && unresolved.length > 0; attempt++) {
		for (const track of unresolved) {
			const id = await client
				.findAudioByPath(auth.token, track.title, toJellyfinPath(track.path, libraryPath))
				.catch(() => null);
			if (!id) continue;
			known.set(track.path, id);
			remember.run(userId, track.path, id, Date.now());
		}
		unresolved = unresolved.filter((track) => !known.has(track.path));
		if (unresolved.length === 0 || attempt === attempts - 1) break;
		await new Promise((r) => setTimeout(r, interval));
	}

	const itemIds = alive
		.map((track) => known.get(track.path))
		.filter((id): id is string => id !== undefined);
	if (itemIds.length === 0) return null;

	const state = db
		.prepare('SELECT playlist_id FROM downloads_playlist WHERE user_id = ?')
		.get(userId) as { playlist_id: string | null } | undefined;
	const name = downloadsPlaylistName(userId, db);

	let playlistId = state?.playlist_id ?? null;
	let present = new Set<string>();
	if (playlistId) {
		// Guard against a playlist deleted out from under us since we recorded it.
		const items = await client.playlistItemIds(auth.token, playlistId, userId).catch(() => null);
		if (items) present = new Set(items);
		else playlistId = null;
	}
	if (!playlistId) {
		playlistId = await client.findPlaylist(auth.token, name).catch(() => null);
		if (playlistId) {
			present = new Set(
				await client.playlistItemIds(auth.token, playlistId, userId).catch(() => [])
			);
		}
	}

	let added: number;
	if (playlistId) {
		const toAdd = itemIds.filter((id) => !present.has(id));
		await client.addToPlaylist(auth.token, playlistId, userId, toAdd);
		added = toAdd.length;
	} else {
		playlistId = await client.createPlaylist(auth.token, userId, name, itemIds);
		added = itemIds.length;
	}

	db.prepare(
		`INSERT INTO downloads_playlist (user_id, playlist_id, last_synced_at) VALUES (?, ?, ?)
		 ON CONFLICT (user_id) DO UPDATE SET playlist_id = excluded.playlist_id, last_synced_at = excluded.last_synced_at`
	).run(userId, playlistId, Date.now());

	publish({
		type: 'queue',
		payload: { downloadsPlaylist: { userId, id: playlistId, added, total: itemIds.length } }
	});
	return { playlistId, added, total: itemIds.length, cancelled };
}

/** Coalesce bursts of drained batches into at most one running sync per user. */
const DEBOUNCE_MS = 8_000;
const timers = new Map<string, NodeJS.Timeout>();
const running = new Set<string>();
const dirty = new Set<string>();

/**
 * Debounced downloads-playlist sync, fired when one of the user's batches
 * drains. Never overlaps itself per user; a drain arriving mid-run schedules
 * exactly one follow-up pass.
 */
export function scheduleDownloadsPlaylistSync(userId: string, db: DB = getDb()): void {
	if (running.has(userId)) {
		dirty.add(userId);
		return;
	}
	const existing = timers.get(userId);
	if (existing) clearTimeout(existing);
	const timer = setTimeout(() => {
		timers.delete(userId);
		void runDownloadsPlaylistSync(userId, db);
	}, DEBOUNCE_MS);
	timer.unref?.();
	timers.set(userId, timer);
}

async function runDownloadsPlaylistSync(userId: string, db: DB): Promise<void> {
	running.add(userId);
	try {
		await syncDownloadsPlaylist(userId, db);
	} catch (cause) {
		console.error('downloads playlist sync failed:', (cause as Error).message);
	} finally {
		running.delete(userId);
		if (dirty.delete(userId)) scheduleDownloadsPlaylistSync(userId, db);
	}
}

/**
 * Reconcile every user's downloads playlist. Runs on the shared subscription
 * cadence so tracks deleted in Jellyfin are noticed (and their jobs cancelled)
 * even when the user queues nothing new. Single-pass: nothing is being scanned.
 */
export async function reconcileDownloadsPlaylists(db: DB = getDb()): Promise<void> {
	for (const userId of usersWithDownloadsPlaylist(db)) {
		try {
			await syncDownloadsPlaylist(userId, db, { poll: false });
		} catch (cause) {
			console.error('downloads playlist reconcile failed:', (cause as Error).message);
		}
	}
}
