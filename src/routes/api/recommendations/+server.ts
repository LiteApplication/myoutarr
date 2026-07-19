import { getPool, reconcileDrainedBatches } from '$lib/server/app';
import { publish } from '$lib/server/events';
import { buildPlaylistTracks } from '$lib/server/queue/enqueue';
import { createBatch } from '$lib/server/queue/store';
import {
	createPlaylist,
	deletePlaylist,
	listPlaylists,
	trackCount
} from '$lib/server/recommendations/store';
import type { SongResult } from '$lib/server/ytmusic/api';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** YT Music video ids are word-safe; accept the usual 11-char form and longer. */
const VIDEO_ID = /^[A-Za-z0-9_-]{6,}$/;

interface SeedInput {
	videoId: string;
	title: string;
	artist: string;
}

/** Parse and validate the seed array from the request body. */
function parseSeeds(raw: unknown): SeedInput[] | null {
	if (!Array.isArray(raw) || raw.length === 0) return null;
	const seeds: SeedInput[] = [];
	const seen = new Set<string>();
	for (const item of raw) {
		if (typeof item !== 'object' || item === null) return null;
		const rec = item as Record<string, unknown>;
		const videoId = typeof rec.videoId === 'string' ? rec.videoId : '';
		if (!VIDEO_ID.test(videoId) || seen.has(videoId)) continue;
		seen.add(videoId);
		seeds.push({
			videoId,
			title: typeof rec.title === 'string' && rec.title ? rec.title : '(untitled)',
			artist: typeof rec.artist === 'string' && rec.artist ? rec.artist : 'Unknown Artist'
		});
	}
	return seeds.length > 0 ? seeds : null;
}

/** Minimal SongResult for `buildPlaylistTracks` from a stored seed. */
function seedToSong(seed: SeedInput): SongResult {
	return {
		kind: 'song',
		videoId: seed.videoId,
		title: seed.title,
		artists: [{ name: seed.artist, id: null }],
		album: null,
		duration: null,
		thumbnails: []
	};
}

export const GET: RequestHandler = () => {
	const playlists = listPlaylists().map((pl) => ({ ...pl, trackCount: trackCount(pl.id) }));
	return json({ playlists });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	let body: { name?: unknown; dailyCount?: unknown; seeds?: unknown };
	try {
		body = (await request.json()) as typeof body;
	} catch {
		return json({ error: 'invalid JSON body' }, { status: 400 });
	}

	const name = typeof body.name === 'string' ? body.name.trim() : '';
	if (!name) return json({ error: 'name is required' }, { status: 400 });

	const dailyCount = Number(body.dailyCount);
	if (!Number.isInteger(dailyCount) || dailyCount < 1 || dailyCount > 50) {
		return json({ error: 'dailyCount must be an integer between 1 and 50' }, { status: 400 });
	}

	const seeds = parseSeeds(body.seeds);
	if (!seeds) return json({ error: 'at least one valid seed song is required' }, { status: 400 });

	const createdBy = locals.session!.userId;
	const playlist = createPlaylist({ name, dailyCount, createdBy }, seeds);

	// Materialise the Jellyfin playlist immediately from the seed songs (a normal
	// append batch - order is preserved for a fresh playlist).
	try {
		const tracks = buildPlaylistTracks(name, seeds.map(seedToSong));
		const { batch } = createBatch(
			{ kind: 'playlist', sourceId: playlist.id, title: name, createdBy },
			tracks
		);
		publish({ type: 'queue', payload: { enqueued: [batch.id] } });
		getPool().poke();
		reconcileDrainedBatches([batch.id]);
	} catch (cause) {
		console.error('recommendations: seed batch enqueue failed:', (cause as Error).message);
	}

	return json({ playlist }, { status: 201 });
};

export const DELETE: RequestHandler = async ({ request }) => {
	let body: { id?: unknown };
	try {
		body = (await request.json()) as { id?: unknown };
	} catch {
		return json({ error: 'invalid JSON body' }, { status: 400 });
	}
	const id = typeof body.id === 'string' ? body.id : '';
	if (!id) return json({ error: 'id is required' }, { status: 400 });
	const removed = deletePlaylist(id);
	return json({ removed });
};
