import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, type DB } from '../db/index.ts';
import { enrichMeta, findRelease } from './client.ts';

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
		expect(await enrichMeta(meta, db, failing)).toEqual(meta);
	});
});
