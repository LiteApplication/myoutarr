import type { DB } from '../db/index.ts';
import { getDb } from '../db/index.ts';
import { publish } from '../events.ts';
import { getAlbum, getArtistReleases, getPlaylist, type AlbumDetail } from '../ytmusic/api.ts';
import type { Batch, JobMeta, NewTrack } from './store.ts';
import { createBatch } from './store.ts';

export type EnqueueRequest =
	| { kind: 'song'; videoId: string; albumBrowseId?: string }
	| { kind: 'album'; browseId: string }
	| { kind: 'playlist'; browseId: string }
	| { kind: 'artist'; browseId: string };

function albumTrackMeta(album: AlbumDetail): NewTrack[] {
	const albumArtist = album.artists[0]?.name ?? 'Unknown Artist';
	const thumbnail = album.thumbnails.at(-1)?.url;
	return album.tracks
		.filter((t) => t.isAvailable && t.videoId)
		.map((t) => ({
			videoId: t.videoId as string,
			meta: {
				title: t.title,
				artist: t.artists.map((a) => a.name).join(', ') || albumArtist,
				album: album.title,
				albumArtist,
				year: album.year ?? undefined,
				trackNumber: t.trackNumber,
				totalTracks: album.trackCount,
				thumbnail,
				albumBrowseId: album.browseId
			} satisfies JobMeta
		}));
}

/**
 * Enqueue a single album by its browseId as one batch. Returns the batch, or
 * `null` when the album resolves but has no downloadable tracks. Throws when the
 * album itself can't be fetched, so callers can distinguish a transient failure
 * (retry later) from an empty release (skip permanently).
 */
export async function enqueueAlbumById(
	browseId: string,
	userId: string,
	fallbackArtist: string | undefined,
	db: DB = getDb()
): Promise<Batch | null> {
	const album = await getAlbum(browseId);
	const tracks = albumTrackMeta(album);
	if (tracks.length === 0) return null;
	const { batch } = createBatch(
		{
			kind: 'album',
			sourceId: album.browseId,
			title: album.title,
			artist: album.artists[0]?.name ?? fallbackArtist,
			thumbnail: album.thumbnails.at(-1)?.url,
			createdBy: userId
		},
		tracks,
		db
	);
	return batch;
}

/**
 * Expand a user request into one or more batches of per-track jobs.
 * Artist requests become one batch per release so progress reads naturally.
 */
export async function enqueue(
	request: EnqueueRequest,
	userId: string,
	db: DB = getDb()
): Promise<Batch[]> {
	const batches: Batch[] = [];

	switch (request.kind) {
		case 'song': {
			if (!request.albumBrowseId) {
				throw new Error('song downloads need their album context (albumBrowseId)');
			}
			const album = await getAlbum(request.albumBrowseId);
			const track = albumTrackMeta(album).find((t) => t.videoId === request.videoId);
			if (!track) throw new Error('track not found on its album (may be unavailable)');
			const { batch } = createBatch(
				{
					kind: 'song',
					sourceId: request.videoId,
					title: track.meta.title,
					artist: track.meta.artist,
					thumbnail: track.meta.thumbnail,
					createdBy: userId
				},
				[track],
				db
			);
			batches.push(batch);
			break;
		}

		case 'album': {
			const album = await getAlbum(request.browseId);
			const tracks = albumTrackMeta(album);
			const { batch } = createBatch(
				{
					kind: 'album',
					sourceId: request.browseId,
					title: album.title,
					artist: album.artists[0]?.name,
					thumbnail: album.thumbnails.at(-1)?.url,
					createdBy: userId
				},
				tracks,
				db
			);
			batches.push(batch);
			break;
		}

		case 'playlist': {
			const playlist = await getPlaylist(request.browseId);
			const tracks: NewTrack[] = playlist.tracks.map((t, index) => ({
				videoId: t.videoId,
				meta: {
					title: t.title,
					artist: t.artists.map((a) => a.name).join(', ') || 'Unknown Artist',
					// Real album metadata is resolved per-track at download time via
					// the song's album id when present; playlist name is the fallback.
					album: t.album?.name ?? playlist.title,
					albumArtist: t.artists[0]?.name,
					thumbnail: t.thumbnails.at(-1)?.url,
					trackNumber: index + 1,
					albumBrowseId: t.album?.id ?? undefined
				} satisfies JobMeta
			}));
			const { batch } = createBatch(
				{
					kind: 'playlist',
					sourceId: request.browseId,
					title: playlist.title,
					artist: playlist.author ?? undefined,
					thumbnail: playlist.thumbnails.at(-1)?.url,
					createdBy: userId
				},
				tracks,
				db
			);
			batches.push(batch);
			break;
		}

		case 'artist': {
			const artist = await getArtistReleases(request.browseId);
			if (artist.releases.length === 0) throw new Error('artist has no downloadable releases');
			// Fetch album details with modest parallelism; skip releases that 404.
			const CHUNK = 4;
			for (let i = 0; i < artist.releases.length; i += CHUNK) {
				const details = await Promise.all(
					artist.releases
						.slice(i, i + CHUNK)
						.map((release) =>
							enqueueAlbumById(release.browseId, userId, artist.name, db).catch(() => null)
						)
				);
				for (const batch of details) {
					if (batch) batches.push(batch);
				}
			}
			break;
		}
	}

	publish({ type: 'queue', payload: { enqueued: batches.map((b) => b.id) } });
	return batches;
}
