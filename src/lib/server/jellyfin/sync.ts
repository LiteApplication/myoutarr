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

/**
 * After a playlist batch drains: wait for Jellyfin's scan to pick the files
 * up, resolve each completed track to an item id, and create (or extend) the
 * playlist under the requesting user's account. Tracks that already existed
 * in the library resolve the same way — by path — so they are included too.
 */
export async function syncPlaylistBatch(
	batchId: string,
	db: DB = getDb(),
	options: { pollIntervalMs?: number; client?: JellyfinClient } = {}
): Promise<{ playlistId: string; matched: number; total: number } | null> {
	const settings = getSettings(db);
	if (!settings.jellyfinUrl) return null;

	const batch = db
		.prepare("SELECT * FROM batches WHERE id = ? AND kind = 'playlist'")
		.get(batchId) as { id: string; title: string; created_by: string } | undefined;
	if (!batch) return null;

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

	const wanted = jobs.map((job) => {
		const meta = JSON.parse(job.meta) as { title: string };
		return {
			title: meta.title,
			jellyfinPath: toJellyfinPath(job.output_path, settings.jellyfinLibraryPath || '/music')
		};
	});

	// Poll until the scan has surfaced every track (or we run out of patience).
	const found = new Map<string, string>();
	for (let attempt = 0; attempt < SCAN_POLL_ATTEMPTS; attempt++) {
		for (const track of wanted) {
			if (found.has(track.jellyfinPath)) continue;
			const id = await client
				.findAudioByPath(session.token, track.title, track.jellyfinPath)
				.catch(() => null);
			if (id) found.set(track.jellyfinPath, id);
		}
		if (found.size === wanted.length) break;
		await new Promise((r) => setTimeout(r, interval));
	}

	if (found.size === 0) {
		console.error(`playlist sync: Jellyfin never surfaced any track of "${batch.title}"`);
		return null;
	}

	const itemIds = wanted
		.map((track) => found.get(track.jellyfinPath))
		.filter((id): id is string => id !== undefined);

	const existing = await client.findPlaylist(session.token, batch.title).catch(() => null);
	let playlistId: string;
	if (existing) {
		await client.addToPlaylist(session.token, existing, session.userId, itemIds);
		playlistId = existing;
	} else {
		playlistId = await client.createPlaylist(session.token, session.userId, batch.title, itemIds);
	}
	publish({
		type: 'batch',
		payload: {
			id: batchId,
			playlist: { id: playlistId, matched: itemIds.length, total: wanted.length }
		}
	});
	return { playlistId, matched: itemIds.length, total: wanted.length };
}
