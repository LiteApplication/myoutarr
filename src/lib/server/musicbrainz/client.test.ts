import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, type DB } from '../db/index.ts';
import { enrichMeta, findRelease, lookupAlbumArtists, lookupSongArtists } from './client.ts';

let dir: string;
let db: DB;

beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'myoutarr-mb-'));
	db = openDatabase(path.join(dir, 'test.db'));
});

afterEach(() => {
	db.close();
	rmSync(dir, { recursive: true, force: true });
});

const rgSearch = {
	'release-groups': [
		{
			id: 'rg-1',
			score: 100,
			title: 'Discovery',
			'first-release-date': '2001-03-12',
			'artist-credit': [{ name: 'Daft Punk', artist: { id: 'ar-1', name: 'Daft Punk' } }]
		}
	]
};
const rgLookup = {
	genres: [
		{ name: 'house', count: 10 },
		{ name: 'french house', count: 7 },
		{ name: 'electronic', count: 12 }
	]
};

function fetchStub(routes: Record<string, unknown>): typeof fetch {
	return vi.fn(async (url: RequestInfo | URL) => {
		const href = String(url);
		for (const [fragment, body] of Object.entries(routes)) {
			if (href.includes(fragment)) return Response.json(body);
		}
		return new Response('not found', { status: 404 });
	}) as unknown as typeof fetch;
}

describe('findRelease', () => {
	it('matches, fetches genres, and caches', async () => {
		const fetchImpl = fetchStub({
			'/release-group/?query=': rgSearch,
			'/release-group/rg-1': rgLookup
		});
		const match = await findRelease('Daft Punk', 'Discovery', db, fetchImpl);
		expect(match).toMatchObject({
			releaseGroupId: 'rg-1',
			artistId: 'ar-1',
			year: '2001',
			genres: ['Electronic', 'House', 'French House']
		});
		// Second call must be served from cache: no further HTTP.
		const before = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls.length;
		await findRelease('Daft Punk', 'Discovery', db, fetchImpl);
		expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before);
	});

	it('returns null (and caches the miss) when nothing scores high enough', async () => {
		const weak = {
			'release-groups': [{ id: 'rg-2', score: 60, title: 'Other', 'artist-credit': [] }]
		};
		const fetchImpl = fetchStub({ '/release-group/?query=': weak });
		expect(await findRelease('Nobody', 'Nothing', db, fetchImpl)).toBeNull();
		const before = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls.length;
		expect(await findRelease('Nobody', 'Nothing', db, fetchImpl)).toBeNull();
		expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before);
	});

	it('rejects title matches from the wrong artist', async () => {
		const wrongArtist = {
			'release-groups': [
				{
					id: 'rg-3',
					score: 95,
					title: 'Discovery',
					'artist-credit': [
						{ name: 'Mike Oldfield', artist: { id: 'ar-9', name: 'Mike Oldfield' } }
					]
				}
			]
		};
		const fetchImpl = fetchStub({ '/release-group/?query=': wrongArtist });
		expect(await findRelease('Daft Punk', 'Discovery', db, fetchImpl)).toBeNull();
	});
});

describe('artist credits', () => {
	/** MusicBrainz renders a collaboration as several credits joined by phrases. */
	const recording = (title: string, credits: { name: string; joinphrase?: string }[]) => ({
		recordings: [
			{
				score: 100,
				title,
				'artist-credit': credits.map((c) => ({
					name: c.name,
					joinphrase: c.joinphrase,
					artist: { id: `ar-${c.name}`, name: c.name }
				}))
			}
		]
	});

	it('splits a combined credit into the artists MusicBrainz credits', async () => {
		const fetchImpl = fetchStub({
			'/recording/?query=': recording('Get Lucky', [
				{ name: 'Daft Punk', joinphrase: ' feat. ' },
				{ name: 'Pharrell Williams' }
			])
		});
		expect(
			await lookupSongArtists('Get Lucky', 'Random Access Memories', 'Daft Punk', db, fetchImpl)
		).toEqual(['Daft Punk', 'Pharrell Williams']);
	});

	it('prefers MusicBrainz spelling over the combined string', async () => {
		const fetchImpl = fetchStub({
			'/recording/?query=': recording('Sunday', [
				{ name: 'Beyoncé', joinphrase: ' & ' },
				{ name: 'Jay-Z' }
			])
		});
		expect(await lookupSongArtists('Sunday', 'Live', 'Beyonce, Jay Z', db, fetchImpl)).toEqual([
			'Beyoncé',
			'Jay-Z'
		]);
	});

	it('keeps a one-artist act whole even though its name reads like a list', async () => {
		// "Earth, Wind & Fire" is one artist in MusicBrainz - the naive split of
		// the string would invent two artists that never existed.
		const fetchImpl = fetchStub({
			'/recording/?query=': recording('September', [{ name: 'Earth, Wind & Fire' }])
		});
		expect(
			await lookupSongArtists('September', 'The Best Of', 'Earth, Wind & Fire', db, fetchImpl)
		).toEqual(['Earth, Wind & Fire']);
	});

	it('refuses a same-titled song by unrelated artists', async () => {
		const fetchImpl = fetchStub({
			'/recording/?query=': recording('Alive', [{ name: 'Pearl Jam' }])
		});
		expect(await lookupSongArtists('Alive', 'Alive', 'Sia, Adele', db, fetchImpl)).toBeNull();
	});

	it('returns null and caches the miss when nothing matches', async () => {
		const fetchImpl = fetchStub({ '/recording/?query=': { recordings: [] } });
		expect(await lookupSongArtists('Nothing', 'Nowhere', 'A, B', db, fetchImpl)).toBeNull();
		const before = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls.length;
		expect(await lookupSongArtists('Nothing', 'Nowhere', 'A, B', db, fetchImpl)).toBeNull();
		expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before);
	});

	it('reads album credits from the release group', async () => {
		const fetchImpl = fetchStub({
			'/release-group/?query=': {
				'release-groups': [
					{
						id: 'rg-2',
						score: 100,
						title: 'Watch the Throne',
						'artist-credit': [
							{ name: 'Jay-Z', joinphrase: ' & ', artist: { id: 'ar-2', name: 'Jay-Z' } },
							{ name: 'Kanye West', artist: { id: 'ar-3', name: 'Kanye West' } }
						]
					}
				]
			}
		});
		expect(
			await lookupAlbumArtists('Watch the Throne', 'Jay-Z, Kanye West', db, fetchImpl)
		).toEqual(['Jay-Z', 'Kanye West']);
	});
});

describe('enrichMeta', () => {
	const meta = {
		title: 'One More Time',
		artist: 'Daft Punk',
		album: 'Discovery',
		albumArtist: 'Daft Punk',
		trackNumber: 1
	};

	it('fills genre, year, and MBIDs without overwriting existing values', async () => {
		const fetchImpl = fetchStub({
			'/release-group/?query=': rgSearch,
			'/release-group/rg-1': rgLookup
		});
		const enriched = await enrichMeta({ ...meta, year: '1999' }, db, fetchImpl);
		expect(enriched.genre).toBe('Electronic');
		expect(enriched.year).toBe('1999'); // pre-existing year wins
		expect(enriched.mbReleaseGroupId).toBe('rg-1');
		expect(enriched.mbArtistId).toBe('ar-1');
	});

	it('degrades to the original metadata on network failure', async () => {
		const failing = vi.fn(async () => {
			throw new Error('offline');
		}) as unknown as typeof fetch;
		// Unreachable MusicBrainz leaves every field as it was; the credit lists
		// simply restate the combined credit rather than guessing at a split.
		expect(await enrichMeta(meta, db, failing)).toEqual({
			...meta,
			artists: ['Daft Punk'],
			albumArtists: ['Daft Punk']
		});
	});
});
