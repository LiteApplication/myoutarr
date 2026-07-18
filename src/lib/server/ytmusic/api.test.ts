import { describe, expect, it } from 'vitest';
import { getAlbum, getArtist, getPlaylist, getSong, search } from './api.ts';
import type { YtMusicWorker } from './client.ts';

/** Stub worker returning a canned payload for any call. */
function stub(payload: unknown): YtMusicWorker {
	return { call: async () => payload } as unknown as YtMusicWorker;
}

const thumbnail = { url: 'https://img.example/a.jpg', width: 60, height: 60 };

describe('search mapping', () => {
	it('maps songs, albums, artists, and playlists; drops unknown types', async () => {
		const results = await search(
			'x',
			undefined,
			stub([
				{
					resultType: 'song',
					videoId: 'v1',
					title: 'One More Time',
					artists: [{ name: 'Daft Punk', id: 'a1' }],
					album: { name: 'Discovery', id: 'b1' },
					duration: '5:20',
					thumbnails: [thumbnail]
				},
				{
					resultType: 'album',
					browseId: 'MPREb_1',
					title: 'Discovery',
					type: 'Album',
					year: '2001',
					artists: [{ name: 'Daft Punk', id: 'a1' }],
					thumbnails: [thumbnail]
				},
				{ resultType: 'artist', browseId: 'UC1', artist: 'Daft Punk', thumbnails: [thumbnail] },
				{
					resultType: 'playlist',
					browseId: 'VL1',
					title: 'Essentials',
					author: 'YouTube Music',
					itemCount: '50',
					thumbnails: []
				},
				{ resultType: 'podcast', browseId: 'P1' },
				{ resultType: 'song' } // missing videoId → dropped
			])
		);
		expect(results.map((r) => r.kind)).toEqual(['song', 'album', 'artist', 'playlist']);
		const song = results[0];
		expect(song).toMatchObject({
			videoId: 'v1',
			title: 'One More Time',
			album: { name: 'Discovery', id: 'b1' }
		});
	});

	it('tolerates a completely malformed response', async () => {
		expect(await search('x', undefined, stub(null))).toEqual([]);
		expect(await search('x', undefined, stub({ nonsense: true }))).toEqual([]);
	});
});

describe('album mapping', () => {
	it('maps tracks with numbering fallback and availability', async () => {
		const album = await getAlbum(
			'MPREb_1',
			stub({
				title: 'Discovery',
				type: 'Album',
				year: '2001',
				artists: [{ name: 'Daft Punk', id: 'a1' }],
				trackCount: 2,
				duration: '61 minutes',
				audioPlaylistId: 'OLAK5uy_x',
				thumbnails: [thumbnail],
				tracks: [
					{ videoId: 'v1', title: 'One More Time', artists: [], duration: '5:20', trackNumber: 1 },
					{ videoId: null, title: 'Unavailable Track', artists: [], isAvailable: false }
				]
			})
		);
		expect(album.tracks).toHaveLength(2);
		expect(album.tracks[0]).toMatchObject({ videoId: 'v1', trackNumber: 1, isAvailable: true });
		// No trackNumber upstream → positional fallback; no videoId → unavailable.
		expect(album.tracks[1]).toMatchObject({ videoId: null, trackNumber: 2, isAvailable: false });
		expect(album.audioPlaylistId).toBe('OLAK5uy_x');
	});
});

describe('artist mapping', () => {
	it('maps discography sections and pagination params', async () => {
		const artist = await getArtist(
			'UC1',
			stub({
				name: 'Daft Punk',
				description: 'French duo',
				thumbnails: [thumbnail],
				albums: {
					browseId: 'UC1_albums',
					params: 'ggMIegYIARoCAQI',
					results: [
						{ browseId: 'MPREb_1', title: 'Discovery', type: 'Album', year: '2001' },
						{ title: 'No browse id → dropped' }
					]
				},
				singles: { results: [] }
			})
		);
		expect(artist.albums).toHaveLength(1);
		expect(artist.albumsParams).toEqual({ browseId: 'UC1_albums', params: 'ggMIegYIARoCAQI' });
		expect(artist.singlesParams).toBeNull();
	});
});

describe('song mapping', () => {
	it('maps the first watch track as the song and the rest as related', async () => {
		const song = await getSong(
			'v1',
			stub({
				tracks: [
					{
						videoId: 'v1',
						title: 'One More Time',
						artists: [{ name: 'Daft Punk', id: 'a1' }],
						album: { name: 'Discovery', id: 'b1' },
						length: '5:20',
						thumbnail: [thumbnail]
					},
					{
						videoId: 'v2',
						title: 'Aerodynamic',
						artists: [{ name: 'Daft Punk', id: 'a1' }],
						album: { name: 'Discovery', id: 'b1' },
						length: '3:27',
						thumbnail: [thumbnail]
					},
					{ title: 'no video id → dropped' }
				]
			})
		);
		expect(song).toMatchObject({
			videoId: 'v1',
			title: 'One More Time',
			duration: '5:20',
			album: { name: 'Discovery', id: 'b1' }
		});
		expect(song.thumbnails).toEqual([thumbnail]);
		expect(song.related.map((t) => t.videoId)).toEqual(['v2']);
	});

	it('throws when the watch queue is empty', async () => {
		await expect(getSong('v1', stub({ tracks: [] }))).rejects.toThrow('song not found');
	});
});

describe('playlist mapping', () => {
	it('maps tracks and drops entries without video ids', async () => {
		const playlist = await getPlaylist(
			'VL1',
			stub({
				title: 'Mix',
				author: { name: 'someone' },
				trackCount: 2,
				thumbnails: [],
				tracks: [
					{ videoId: 'v1', title: 'A', artists: [{ name: 'X', id: null }] },
					{ videoId: null, title: 'gone' }
				]
			})
		);
		expect(playlist.tracks).toHaveLength(1);
		expect(playlist.author).toBe('someone');
	});
});
