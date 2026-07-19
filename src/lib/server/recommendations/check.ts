import type { DB } from '../db/index.ts';
import { getDb } from '../db/index.ts';
import { publish } from '../events.ts';
import { buildPlaylistTracks } from '../queue/enqueue.ts';
import { createBatch } from '../queue/store.ts';
import { getRadio, resolveAlbums } from '../ytmusic/api.ts';
import type { SongResult } from '../ytmusic/api.ts';
import {
	addTracks,
	duePlaylists,
	markChecked,
	playlistTrackVideoIds,
	sampleSeedTracks,
	type RecommendationPlaylist
} from './store.ts';

/** How many current tracks to seed the day's radio from. */
const RADIO_SEED_SAMPLE = 3;

export interface ExpandResult {
	/** Number of recommendation batches enqueued (0 or 1 per playlist). */
	enqueued: number;
	/** Batch ids created, for the caller to poke the worker pool. */
	batchIds: string[];
}

/**
 * The external operations an expansion performs, injected so tests run fully
 * offline (matching the repo's dependency-injection convention over mocking).
 */
export interface CheckDeps {
	getRadio: typeof getRadio;
	resolveAlbums: typeof resolveAlbums;
	buildTracks: typeof buildPlaylistTracks;
	createBatch: typeof createBatch;
}

const defaultDeps: CheckDeps = {
	getRadio,
	resolveAlbums,
	buildTracks: buildPlaylistTracks,
	createBatch
};

/** Round-robin interleave of per-seed candidate lists, for vibe diversity. */
function interleave(lists: SongResult[][]): SongResult[] {
	const out: SongResult[] = [];
	const max = Math.max(0, ...lists.map((l) => l.length));
	for (let i = 0; i < max; i++) {
		for (const list of lists) {
			if (i < list.length) out.push(list[i]);
		}
	}
	return out;
}

/**
 * Expand one recommendation playlist by one run: sample a few of its current
 * tracks, fetch radio recommendations for each, pick `dailyCount` songs not
 * already in the playlist, record them, and enqueue a prepend batch so they land
 * at the top of the matching Jellyfin playlist. A failure fetching radio for one
 * seed is tolerated so a single bad seed doesn't abort the run.
 */
export async function expandPlaylist(
	pl: RecommendationPlaylist,
	db: DB = getDb(),
	deps: CheckDeps = defaultDeps
): Promise<ExpandResult> {
	const seeds = sampleSeedTracks(pl.id, RADIO_SEED_SAMPLE, db);
	const seen = playlistTrackVideoIds(pl.id, db);

	const candidateLists: SongResult[][] = [];
	for (const seed of seeds) {
		try {
			candidateLists.push(await deps.getRadio(seed.videoId));
		} catch (cause) {
			console.error(
				`recommendations: radio failed for seed ${seed.videoId} in "${pl.name}":`,
				(cause as Error).message
			);
		}
	}

	// Interleave for diversity, then take the first `dailyCount` genuinely new songs.
	const chosen: SongResult[] = [];
	const chosenIds = new Set<string>();
	for (const track of interleave(candidateLists)) {
		if (chosen.length >= pl.dailyCount) break;
		if (seen.has(track.videoId) || chosenIds.has(track.videoId)) continue;
		chosen.push(track);
		chosenIds.add(track.videoId);
	}

	if (chosen.length === 0) {
		markChecked(pl.id, db);
		return { enqueued: 0, batchIds: [] };
	}

	addTracks(
		pl.id,
		chosen.map((t) => ({
			videoId: t.videoId,
			title: t.title,
			artist: t.artists.map((a) => a.name).join(', ') || 'Unknown Artist'
		})),
		false,
		db
	);

	// Radio picks arrive without album info; resolve real albums so tracks file
	// under them rather than as loose singles or a fake playlist-named album.
	const resolved = await deps.resolveAlbums(chosen);
	const tracks = deps.buildTracks(resolved, db);
	const { batch } = deps.createBatch(
		{
			kind: 'playlist',
			sourceId: pl.id,
			title: pl.name,
			createdBy: pl.createdBy,
			prepend: true
		},
		tracks,
		db
	);
	markChecked(pl.id, db);
	console.log(`recommendations: prepended ${chosen.length} song(s) to "${pl.name}"`);
	return { enqueued: 1, batchIds: [batch.id] };
}

/**
 * Expand every recommendation playlist due for a run. A failure on one playlist
 * doesn't abort the rest. Returns the batches enqueued across all playlists.
 */
export async function expandDuePlaylists(
	intervalMs: number,
	db: DB = getDb(),
	deps: CheckDeps = defaultDeps
): Promise<ExpandResult> {
	const playlists = duePlaylists(intervalMs, db);
	const batchIds: string[] = [];
	for (const pl of playlists) {
		try {
			const result = await expandPlaylist(pl, db, deps);
			batchIds.push(...result.batchIds);
		} catch (cause) {
			console.error(
				`recommendations: expansion failed for "${pl.name}":`,
				(cause as Error).message
			);
		}
	}
	if (batchIds.length > 0) {
		publish({ type: 'queue', payload: { enqueued: batchIds } });
	}
	return { enqueued: batchIds.length, batchIds };
}
