import type { DB } from '../db/index.ts';
import { getDb } from '../db/index.ts';
import { publish } from '../events.ts';
import {
	getAlbum,
	getArtistReleases,
	getPlaylist,
	getSong,
	type AlbumDetail,
	type SongResult
} from '../ytmusic/api.ts';
import type { Batch, JobMeta, NewTrack } from './store.ts';
import { createBatch, findCompletedDownload } from './store.ts';

export type EnqueueRequest =
	| { kind: 'song'; videoId: string; albumBrowseId?: string }
	| { kind: 'album'; browseId: string }
	| { kind: 'playlist'; browseId: string; syncJellyfin?: boolean }
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
 * Map playlist tracks to jobs, flagging any already in the library so they are
 * skipped rather than re-downloaded (`NewTrack.existingPath`). Shared by the
 * manual playlist download and the recommendation expansion.
 *
 * A track keeps its own album; one that belongs to no album files under its own
 * title (a single is its own album), never under the playlist name - bundling
 * unrelated tracks into a fake playlist-named album is exactly what we avoid.
 * Callers that source album-less tracks (recommendations) should run them
 * through `resolveAlbums` first so real albums survive this mapping.
 */
export function buildPlaylistTracks(tracks: SongResult[], db: DB = getDb()): NewTrack[] {
	return tracks.map((t, index) => ({
		videoId: t.videoId,
		existingPath: findCompletedDownload(t.videoId, db) ?? undefined,
		meta: {
			title: t.title,
			artist: t.artists.map((a) => a.name).join(', ') || 'Unknown Artist',
			album: t.album?.name || t.title,
			albumArtist: t.artists[0]?.name,
			thumbnail: t.thumbnails.at(-1)?.url,
			trackNumber: index + 1,
			albumBrowseId: t.album?.id ?? undefined
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
			// Prefer the album context (gives real track numbers / total). Fall back to
			// the song's own metadata for standalone tracks that belong to no album.
			let track: NewTrack | undefined;
			if (request.albumBrowseId) {
				const album = await getAlbum(request.albumBrowseId);
				track = albumTrackMeta(album).find((t) => t.videoId === request.videoId);
				if (!track) throw new Error('track not found on its album (may be unavailable)');
			} else {
				const song = await getSong(request.videoId);
				if (song.album?.id) {
					const album = await getAlbum(song.album.id);
					track = albumTrackMeta(album).find((t) => t.videoId === request.videoId);
				}
				track ??= {
					videoId: request.videoId,
					meta: {
						title: song.title,
						artist: song.artists.map((a) => a.name).join(', ') || 'Unknown Artist',
						album: song.album?.name || song.title,
						albumArtist: song.artists[0]?.name,
						thumbnail: song.thumbnails.at(-1)?.url
					}
				};
			}
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
			const tracks = buildPlaylistTracks(playlist.tracks, db);
			const { batch } = createBatch(
				{
					kind: 'playlist',
					sourceId: request.browseId,
					title: playlist.title,
					artist: playlist.author ?? undefined,
					thumbnail: playlist.thumbnails.at(-1)?.url,
					createdBy: userId,
					syncJellyfin: request.syncJellyfin !== false
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
