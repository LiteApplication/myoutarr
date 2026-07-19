import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DB } from '../db/index.ts';
import { buildPlaylistTracks } from '../queue/enqueue.ts';
import { createBatch } from '../queue/store.ts';
import type { SongResult } from '../ytmusic/api.ts';
import { expandDuePlaylists, expandPlaylist, type CheckDeps } from './check.ts';
import {
	createPlaylist,
	deletePlaylist,
	duePlaylists,
	getPlaylist,
	listPlaylists,
	markChecked,
	playlistTrackVideoIds,
	trackCount
} from './store.ts';

let dir: string;
let db: DB;

beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'myoutarr-recs-'));
	db = openDatabase(path.join(dir, 'test.db'));
});

afterEach(() => {
	db.close();
	rmSync(dir, { recursive: true, force: true });
});

function song(videoId: string): SongResult {
	return {
		kind: 'song',
		videoId,
		title: `Title ${videoId}`,
		artists: [{ name: 'Radio Artist', id: null }],
		album: null,
		duration: '3:00',
		thumbnails: []
	};
}

/** Real buildTracks/createBatch; only radio is faked so the test runs offline. */
function deps(radio: SongResult[], onRadio?: (id: string) => void): CheckDeps {
	return {
		getRadio: async (videoId: string) => {
			onRadio?.(videoId);
			return radio;
		},
		buildTracks: buildPlaylistTracks,
		createBatch
	};
}

function playlist(dailyCount = 1) {
	return createPlaylist(
		{ name: 'My Vibe', dailyCount, createdBy: 'user1' },
		[
			{ videoId: 'seedA', title: 'Seed A', artist: 'X' },
			{ videoId: 'seedB', title: 'Seed B', artist: 'Y' }
		],
		db
	);
}

describe('recommendation store', () => {
	it('creates a playlist, seeds the track pool, and reports it', () => {
		const pl = playlist();
		expect(listPlaylists(db)).toHaveLength(1);
		expect(trackCount(pl.id, db)).toBe(2);
		expect(playlistTrackVideoIds(pl.id, db)).toEqual(new Set(['seedA', 'seedB']));
	});

	it('deletePlaylist cascades the track pool away', () => {
		const pl = playlist();
		expect(deletePlaylist(pl.id, db)).toBe(true);
		expect(getPlaylist(pl.id, db)).toBeNull();
		expect(playlistTrackVideoIds(pl.id, db).size).toBe(0);
	});

	it('due list respects the interval and last-run time', () => {
		const pl = playlist(); // last_checked_at null → always due
		expect(duePlaylists(24 * 3600_000, db)).toHaveLength(1);
		markChecked(pl.id, db);
		expect(duePlaylists(24 * 3600_000, db)).toHaveLength(0);
	});
});

describe('expandPlaylist', () => {
	it('picks dailyCount new songs, records them, and creates a prepend batch', async () => {
		const pl = playlist(1);
		const result = await expandPlaylist(pl, db, deps([song('c'), song('d'), song('e')]));

		expect(result.enqueued).toBe(1);
		expect(result.batchIds).toHaveLength(1);
		// One new song added to the pool (seeds + 1).
		expect(trackCount(pl.id, db)).toBe(3);
		expect(getPlaylist(pl.id, db)!.lastCheckedAt).not.toBeNull();

		const batch = db
			.prepare('SELECT prepend, title, kind FROM batches WHERE id = ?')
			.get(result.batchIds[0]) as { prepend: number; title: string; kind: string };
		expect(batch).toMatchObject({ prepend: 1, title: 'My Vibe', kind: 'playlist' });
	});

	it('does not re-pick songs already in the playlist on a later run', async () => {
		const pl = playlist(1);
		await expandPlaylist(pl, db, deps([song('c'), song('d'), song('e')]));
		const picked1 = [...playlistTrackVideoIds(pl.id, db)].filter((v) => !v.startsWith('seed'));

		await expandPlaylist(getPlaylist(pl.id, db)!, db, deps([song('c'), song('d'), song('e')]));
		const all = playlistTrackVideoIds(pl.id, db);
		const picked2 = [...all].filter((v) => !v.startsWith('seed'));

		expect(picked1).toHaveLength(1);
		expect(picked2).toHaveLength(2); // one more, different song
		expect(new Set(picked2).size).toBe(2);
	});

	it('marks checked and enqueues nothing when there are no new candidates', async () => {
		const pl = playlist(1);
		// Radio only returns songs already in the pool.
		const result = await expandPlaylist(pl, db, deps([song('seedA'), song('seedB')]));
		expect(result.enqueued).toBe(0);
		expect(result.batchIds).toEqual([]);
		expect(trackCount(pl.id, db)).toBe(2);
		expect(getPlaylist(pl.id, db)!.lastCheckedAt).not.toBeNull();
	});

	it('tolerates a per-seed radio failure without aborting the run', async () => {
		const pl = playlist(1);
		let calls = 0;
		const flaky: CheckDeps = {
			getRadio: async () => {
				calls++;
				if (calls === 1) throw new Error('transient');
				return [song('c')];
			},
			buildTracks: buildPlaylistTracks,
			createBatch
		};
		const result = await expandPlaylist(pl, db, flaky);
		// The surviving seed still yields a recommendation.
		expect(result.enqueued).toBe(1);
		expect(playlistTrackVideoIds(pl.id, db).has('c')).toBe(true);
	});
});

describe('expandDuePlaylists', () => {
	it('expands every due playlist and aggregates enqueued batches', async () => {
		playlist(1);
		const result = await expandDuePlaylists(0, db, deps([song('c')]));
		expect(result.enqueued).toBe(1);
		expect(result.batchIds).toHaveLength(1);
	});
});
