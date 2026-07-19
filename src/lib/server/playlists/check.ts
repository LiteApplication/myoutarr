import type { DB } from '../db/index.ts';
import { getDb } from '../db/index.ts';
import { publish } from '../events.ts';
import { buildPlaylistTracks } from '../queue/enqueue.ts';
import { createBatch } from '../queue/store.ts';
import { getPlaylist } from '../ytmusic/api.ts';
import {
	duePlaylistSubscriptions,
	markPlaylistChecked,
	markVideosSeen,
	seenVideoIds,
	type PlaylistSubscription
} from './store.ts';

export interface PlaylistCheckResult {
	/** Number of batches enqueued (one per playlist that gained new songs). */
	enqueued: number;
	/** Batch ids created, for the caller to poke the worker pool and reconcile drains. */
	batchIds: string[];
}

/**
 * The external operation a check performs, injectable so tests run fully offline
 * (matching the repo's dependency-injection convention over module mocking).
 */
export interface PlaylistCheckDeps {
	getPlaylist: typeof getPlaylist;
}

const defaultDeps: PlaylistCheckDeps = { getPlaylist };

/**
 * Check one followed playlist for songs added since it was followed and enqueue
 * the new ones as a playlist batch (already-downloaded tracks are skipped inside
 * `buildPlaylistTracks`, so a re-added song already in the library is not fetched
 * again). The new batch flows through the normal drain/incremental sync and lands
 * in the same Jellyfin playlist. Every new video is marked seen so it isn't
 * reconsidered next time.
 */
export async function checkPlaylistSubscription(
	sub: PlaylistSubscription,
	db: DB = getDb(),
	deps: PlaylistCheckDeps = defaultDeps
): Promise<PlaylistCheckResult> {
	const playlist = await deps.getPlaylist(sub.browseId);
	const seen = seenVideoIds(sub.browseId, sub.createdBy, db);
	const newTracks = playlist.tracks.filter((t) => t.videoId && !seen.has(t.videoId));

	const batchIds: string[] = [];
	if (newTracks.length > 0) {
		const tracks = buildPlaylistTracks(newTracks, db);
		const { batch } = createBatch(
			{
				kind: 'playlist',
				sourceId: sub.browseId,
				title: playlist.title,
				artist: playlist.author ?? undefined,
				thumbnail: playlist.thumbnails.at(-1)?.url,
				createdBy: sub.createdBy
			},
			tracks,
			db
		);
		markVideosSeen(sub.browseId, sub.createdBy, newTracks.map((t) => t.videoId) as string[], db);
		batchIds.push(batch.id);
		console.log(`playlist sync: enqueued ${newTracks.length} new song(s) from "${playlist.title}"`);
	}

	markPlaylistChecked(sub.browseId, sub.createdBy, db);
	return { enqueued: batchIds.length, batchIds };
}

/**
 * Check every enabled playlist due for a refresh. A failure on one playlist
 * doesn't abort the rest. Returns the batches enqueued across all playlists.
 */
export async function checkDuePlaylistSubscriptions(
	intervalMs: number,
	db: DB = getDb(),
	deps: PlaylistCheckDeps = defaultDeps
): Promise<PlaylistCheckResult> {
	const subs = duePlaylistSubscriptions(intervalMs, db);
	const batchIds: string[] = [];
	for (const sub of subs) {
		try {
			const result = await checkPlaylistSubscription(sub, db, deps);
			batchIds.push(...result.batchIds);
		} catch (cause) {
			console.error(`playlist sync: check failed for "${sub.title}":`, (cause as Error).message);
		}
	}
	if (batchIds.length > 0) {
		publish({ type: 'queue', payload: { enqueued: batchIds } });
	}
	return { enqueued: batchIds.length, batchIds };
}
