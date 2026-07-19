import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DB } from '../db/index.ts';
import type { PlaylistDetail, SongResult } from '../ytmusic/api.ts';
import { checkPlaylistSubscription, type PlaylistCheckDeps } from './check.ts';
import {
	duePlaylistSubscriptions,
	isPlaylistSubscribed,
	listPlaylistSubscriptions,
	seenVideoIds,
	setPlaylistEnabled,
	subscribePlaylist,
	unsubscribePlaylist
} from './store.ts';

let dir: string;
let db: DB;

beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'myoutarr-plsync-'));
	db = openDatabase(path.join(dir, 'test.db'));
});

afterEach(() => {
	db.close();
	rmSync(dir, { recursive: true, force: true });
});

const PLAYLIST = 'VLPL0000000000';

function song(videoId: string): SongResult {
	return {
		kind: 'song',
		videoId,
		title: videoId,
		artists: [{ name: 'Test Artist', id: null }],
		album: null,
		duration: '3:00',
		thumbnails: []
	};
}

/** Injectable check deps that serve the given tracklist for the playlist. */
function deps(videoIds: string[]): PlaylistCheckDeps {
	return {
		getPlaylist: async (): Promise<PlaylistDetail> => ({
			browseId: PLAYLIST,
			title: 'My Mix',
			author: 'Test Artist',
			trackCount: videoIds.length,
			thumbnails: [],
			tracks: videoIds.map(song)
		})
	};
}

function sub() {
	return subscribePlaylist(
		{ browseId: PLAYLIST, title: 'My Mix', thumbnail: null, createdBy: 'user1' },
		['a', 'b'], // baseline tracklist seeded
		db
	);
}

describe('playlist subscription store', () => {
	it('subscribes, seeds the seen-set, and reports membership', () => {
		sub();
		expect(isPlaylistSubscribed(PLAYLIST, db)).toBe(true);
		expect(listPlaylistSubscriptions(db)).toHaveLength(1);
		expect(seenVideoIds(PLAYLIST, db)).toEqual(new Set(['a', 'b']));
	});

	it('re-subscribing tops up the seen-set and re-enables', () => {
		sub();
		setPlaylistEnabled(PLAYLIST, false, db);
		subscribePlaylist(
			{ browseId: PLAYLIST, title: 'Renamed', thumbnail: 'x', createdBy: 'user1' },
			['b', 'c'],
			db
		);
		expect(listPlaylistSubscriptions(db)).toHaveLength(1);
		expect(listPlaylistSubscriptions(db)[0].title).toBe('Renamed');
		expect(listPlaylistSubscriptions(db)[0].enabled).toBe(true);
		expect(seenVideoIds(PLAYLIST, db)).toEqual(new Set(['a', 'b', 'c']));
	});

	it('unsubscribe cascades the seen-set away', () => {
		sub();
		expect(unsubscribePlaylist(PLAYLIST, db)).toBe(true);
		expect(isPlaylistSubscribed(PLAYLIST, db)).toBe(false);
		expect(seenVideoIds(PLAYLIST, db).size).toBe(0);
	});

	it('a disabled playlist is not due for a check', () => {
		sub();
		expect(duePlaylistSubscriptions(24 * 3600_000, db)).toHaveLength(1);
		setPlaylistEnabled(PLAYLIST, false, db);
		expect(duePlaylistSubscriptions(24 * 3600_000, db)).toHaveLength(0);
	});
});

describe('checkPlaylistSubscription', () => {
	it('enqueues only songs added since following, then marks them seen', async () => {
		sub(); // seen: a, b
		const result = await checkPlaylistSubscription(
			listPlaylistSubscriptions(db)[0],
			db,
			deps(['a', 'b', 'c'])
		);

		expect(result.enqueued).toBe(1);
		expect(seenVideoIds(PLAYLIST, db).has('c')).toBe(true);
		expect(listPlaylistSubscriptions(db)[0].lastCheckedAt).not.toBeNull();

		// The new song became a playlist batch with one queued job for 'c'.
		const batch = db.prepare("SELECT id, title FROM batches WHERE kind = 'playlist'").get() as {
			id: string;
			title: string;
		};
		expect(batch.title).toBe('My Mix');
		const jobs = db.prepare('SELECT video_id FROM jobs WHERE batch_id = ?').all(batch.id) as {
			video_id: string;
		}[];
		expect(jobs.map((j) => j.video_id)).toEqual(['c']);
	});

	it('is a no-op on the second run when nothing new appeared', async () => {
		sub();
		await checkPlaylistSubscription(listPlaylistSubscriptions(db)[0], db, deps(['a', 'b', 'c']));
		const result = await checkPlaylistSubscription(
			listPlaylistSubscriptions(db)[0],
			db,
			deps(['a', 'b', 'c'])
		);
		expect(result.enqueued).toBe(0);
	});
});
