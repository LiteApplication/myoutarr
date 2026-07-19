import path from 'node:path';
import type { DB } from '../db/index.ts';
import { getDb } from '../db/index.ts';
import { musicDir } from '../env.ts';
import { publish } from '../events.ts';
import { getSettings } from '../settings.ts';
import { JellyfinClient } from './client.ts';

const REFRESH_DEBOUNCE_MS = 5_000;
const SCAN_POLL_INTERVAL_MS = 10_000;
const SCAN_POLL_ATTEMPTS = 18; // up to 3 minutes for the scan to surface items

let refreshTimer: NodeJS.Timeout | null = null;

/** Most recent valid session token for the user who queued the batch. */
function tokenFor(userId: string, db: DB): { token: string } | null {
	const row = db
		.prepare(
			`SELECT jellyfin_token FROM sessions
			 WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1`
		)
		.get(userId, Date.now()) as { jellyfin_token: string } | undefined;
	return row ? { token: row.jellyfin_token } : null;
}

/**
 * Translate a path on myoutarr's /music mount into the path Jellyfin sees
 * for the same file (they mount the same volume at different points).
 */
export function toJellyfinPath(
	outputPath: string,
	libraryPath: string,
	musicRoot?: string
): string {
	const relative = path.relative(musicRoot ?? musicDir(), outputPath);
	return path.posix.join(libraryPath, ...relative.split(path.sep));
}

/** Debounced library refresh once downloads settle. */
export function scheduleRefresh(db: DB = getDb()): void {
	const settings = getSettings(db);
	if (!settings.jellyfinRefresh || !settings.jellyfinUrl) return;
	if (refreshTimer) clearTimeout(refreshTimer);
	refreshTimer = setTimeout(() => {
		refreshTimer = null;
		const row = db
			.prepare(
				'SELECT jellyfin_token FROM sessions WHERE expires_at > ? ORDER BY created_at DESC LIMIT 1'
			)
			.get(Date.now()) as { jellyfin_token: string } | undefined;
		if (!row) return;
		new JellyfinClient(settings.jellyfinUrl)
			.refreshLibrary(row.jellyfin_token)
			.then(() => publish({ type: 'queue', payload: { jellyfinRefresh: 'triggered' } }))
			.catch((cause) => console.error('Jellyfin refresh failed:', cause.message));
	}, REFRESH_DEBOUNCE_MS);
	refreshTimer.unref?.();
}

/** Remember which Jellyfin playlist a batch materialised into. */
export function setBatchPlaylistId(batchId: string, playlistId: string, db: DB = getDb()): void {
	db.prepare('UPDATE batches SET jellyfin_playlist_id = ? WHERE id = ?').run(playlistId, batchId);
}

/**
 * Materialise a playlist batch into a Jellyfin playlist under the requesting
 * user's account. Idempotent and additive: it resolves each completed track to
 * an item id and adds only the ones not already in the playlist, so it can be
 * called repeatedly as a batch downloads (progressive) and again on drain.
 *
 * Tracks already in the library are completed jobs with an output_path, so they
 * resolve by path and are included too. With `poll` (default), it waits for the
 * scan to surface every track; with `poll: false` it does a single pass and adds
 * whatever Jellyfin has already indexed - used for mid-batch incremental syncs.
 */
export async function syncPlaylistBatch(
	batchId: string,
	db: DB = getDb(),
	options: { pollIntervalMs?: number; client?: JellyfinClient; poll?: boolean } = {}
): Promise<{ playlistId: string; matched: number; total: number } | null> {
	const settings = getSettings(db);
	if (!settings.jellyfinUrl) return null;

	const batch = db
		.prepare("SELECT * FROM batches WHERE id = ? AND kind = 'playlist'")
		.get(batchId) as
		| {
				id: string;
				title: string;
				created_by: string;
				jellyfin_playlist_id: string | null;
				prepend: number;
				sync_jellyfin: number;
		  }
		| undefined;
	if (!batch) return null;
	if (batch.sync_jellyfin === 0) return null;

	const jobs = db
		.prepare(
			`SELECT meta, output_path FROM jobs
			 WHERE batch_id = ? AND status = 'completed' AND output_path IS NOT NULL
			 ORDER BY position`
		)
		.all(batchId) as { meta: string; output_path: string }[];
	if (jobs.length === 0) return null;

	const auth = tokenFor(batch.created_by, db);
	if (!auth) {
		console.error(`playlist sync: no valid session for user ${batch.created_by}`);
		return null;
	}
	const client = options.client ?? new JellyfinClient(settings.jellyfinUrl);
	const session = { token: auth.token, userId: batch.created_by };
	const interval = options.pollIntervalMs ?? SCAN_POLL_INTERVAL_MS;
	const attempts = options.poll === false ? 1 : SCAN_POLL_ATTEMPTS;

	const wanted = jobs.map((job) => {
		const meta = JSON.parse(job.meta) as { title: string };
		return {
			title: meta.title,
			jellyfinPath: toJellyfinPath(job.output_path, settings.jellyfinLibraryPath || '/music')
		};
	});

	// Resolve tracks to item ids, waiting for the scan when polling is enabled.
	const found = new Map<string, string>();
	for (let attempt = 0; attempt < attempts; attempt++) {
		for (const track of wanted) {
			if (found.has(track.jellyfinPath)) continue;
			const id = await client
				.findAudioByPath(session.token, track.title, track.jellyfinPath)
				.catch(() => null);
			if (id) found.set(track.jellyfinPath, id);
		}
		if (found.size === wanted.length || attempt === attempts - 1) break;
		await new Promise((r) => setTimeout(r, interval));
	}

	if (found.size === 0) {
		// Expected mid-download (nothing scanned yet); only noise-worthy on a full pass.
		if (options.poll !== false) {
			console.error(`playlist sync: Jellyfin never surfaced any track of "${batch.title}"`);
		}
		return null;
	}

	const itemIds = wanted
		.map((track) => found.get(track.jellyfinPath))
		.filter((id): id is string => id !== undefined);

	// Resolve the target playlist: the one we recorded earlier, else by name.
	let playlistId = batch.jellyfin_playlist_id;
	if (playlistId) {
		// Guard against a playlist deleted out from under us since we recorded it.
		const stillThere = await client
			.playlistItemIds(session.token, playlistId, session.userId)
			.then(() => true)
			.catch(() => false);
		if (!stillThere) playlistId = null;
	}
	playlistId ??= await client.findPlaylist(session.token, batch.title).catch(() => null);

	if (playlistId) {
		const present = new Set(
			await client.playlistItemIds(session.token, playlistId, session.userId).catch(() => [])
		);
		const toAdd = itemIds.filter((id) => !present.has(id));
		// Recommendation batches prepend new tracks to the top of the playlist;
		// everything else appends. New-playlist creation preserves order either way.
		if (batch.prepend) {
			await client.prependToPlaylist(session.token, playlistId, session.userId, toAdd);
		} else {
			await client.addToPlaylist(session.token, playlistId, session.userId, toAdd);
		}
	} else {
		playlistId = await client.createPlaylist(session.token, session.userId, batch.title, itemIds);
	}
	setBatchPlaylistId(batchId, playlistId, db);

	publish({
		type: 'batch',
		payload: {
			id: batchId,
			playlist: { id: playlistId, matched: itemIds.length, total: wanted.length }
		}
	});
	return { playlistId, matched: itemIds.length, total: wanted.length };
}

/** Coalesce bursts of per-track completions into at most one running sync per batch. */
const INCREMENTAL_DEBOUNCE_MS = 8_000;
const incrementalTimers = new Map<string, NodeJS.Timeout>();
const incrementalRunning = new Set<string>();
const incrementalDirty = new Set<string>();

/**
 * Debounced, single-pass playlist sync fired as tracks of a playlist land, so
 * the Jellyfin playlist grows progressively. Never overlaps itself per batch; a
 * completion arriving during a run schedules exactly one follow-up pass.
 */
export function scheduleIncrementalPlaylistSync(batchId: string, db: DB = getDb()): void {
	if (incrementalRunning.has(batchId)) {
		incrementalDirty.add(batchId);
		return;
	}
	const existing = incrementalTimers.get(batchId);
	if (existing) clearTimeout(existing);
	const timer = setTimeout(() => {
		incrementalTimers.delete(batchId);
		void runIncrementalPlaylistSync(batchId, db);
	}, INCREMENTAL_DEBOUNCE_MS);
	timer.unref?.();
	incrementalTimers.set(batchId, timer);
}

async function runIncrementalPlaylistSync(batchId: string, db: DB): Promise<void> {
	incrementalRunning.add(batchId);
	try {
		await syncPlaylistBatch(batchId, db, { poll: false });
	} catch (cause) {
		console.error('incremental playlist sync failed:', (cause as Error).message);
	} finally {
		incrementalRunning.delete(batchId);
		if (incrementalDirty.delete(batchId)) scheduleIncrementalPlaylistSync(batchId, db);
	}
}
