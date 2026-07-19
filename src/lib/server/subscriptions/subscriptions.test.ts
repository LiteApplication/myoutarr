import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DB } from '../db/index.ts';
import type { Batch } from '../queue/store.ts';
import type { AlbumResult, ArtistReleases } from '../ytmusic/api.ts';
import { checkDueSubscriptions, checkSubscription, type CheckDeps } from './check.ts';
import {
	dueSubscriptions,
	isSubscribed,
	listSubscriptions,
	seenReleaseIds,
	subscribe,
	unsubscribe
} from './store.ts';

let dir: string;
let db: DB;

beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'myoutarr-subs-'));
	db = openDatabase(path.join(dir, 'test.db'));
});

afterEach(() => {
	db.close();
	rmSync(dir, { recursive: true, force: true });
});

const ARTIST = 'UCartist000000000000000';

function release(id: string): AlbumResult {
	return {
		kind: 'album',
		browseId: id,
		title: id,
		albumType: 'Album',
		year: '2026',
		artists: [{ name: 'Test Artist', id: ARTIST }],
		thumbnails: []
	};
}

/** Build injectable check deps from a release list, recording enqueue calls. */
function deps(releaseIds: string[]): { deps: CheckDeps; enqueued: string[] } {
	const enqueued: string[] = [];
	return {
		enqueued,
		deps: {
			getReleases: async (): Promise<ArtistReleases> => ({
				browseId: ARTIST,
				name: 'Test Artist',
				thumbnail: null,
				releases: releaseIds.map(release)
			}),
			enqueueAlbum: async (browseId): Promise<Batch | null> => {
				enqueued.push(browseId);
				return { id: `batch-${browseId}` } as Batch;
			}
		}
	};
}

function sub() {
	return subscribe(
		{ browseId: ARTIST, name: 'Test Artist', thumbnail: null, createdBy: 'user1' },
		['MPRE_a', 'MPRE_b'], // baseline discography seeded
		db
	);
}

describe('subscription store', () => {
	it('subscribes, seeds the seen-set, and reports membership', () => {
		sub();
		expect(isSubscribed(ARTIST, 'user1', db)).toBe(true);
		expect(listSubscriptions('user1', db)).toHaveLength(1);
		expect(seenReleaseIds(ARTIST, 'user1', db)).toEqual(new Set(['MPRE_a', 'MPRE_b']));
	});

	it('re-subscribing tops up the seen-set without duplicating', () => {
		sub();
		subscribe(
			{ browseId: ARTIST, name: 'Renamed', thumbnail: 'x', createdBy: 'user1' },
			['MPRE_b', 'MPRE_c'],
			db
		);
		expect(listSubscriptions('user1', db)).toHaveLength(1);
		expect(listSubscriptions('user1', db)[0].name).toBe('Renamed');
		expect(seenReleaseIds(ARTIST, 'user1', db)).toEqual(new Set(['MPRE_a', 'MPRE_b', 'MPRE_c']));
	});

	it('unsubscribe cascades the seen-set away', () => {
		sub();
		expect(unsubscribe(ARTIST, 'user1', db)).toBe(true);
		expect(isSubscribed(ARTIST, 'user1', db)).toBe(false);
		expect(seenReleaseIds(ARTIST, 'user1', db).size).toBe(0);
	});

	it('due list respects the interval and last-checked time', () => {
		sub(); // last_checked_at is null → always due
		expect(dueSubscriptions(24 * 3600_000, db)).toHaveLength(1);
	});

	it('keeps two users following the same artist independent', () => {
		subscribe(
			{ browseId: ARTIST, name: 'Test Artist', thumbnail: null, createdBy: 'user1' },
			['MPRE_a'],
			db
		);
		subscribe(
			{ browseId: ARTIST, name: 'Test Artist', thumbnail: null, createdBy: 'user2' },
			['MPRE_z'],
			db
		);
		// Each user sees only their own subscription with their own seen-set.
		expect(listSubscriptions('user1', db)).toHaveLength(1);
		expect(listSubscriptions('user2', db)).toHaveLength(1);
		expect(seenReleaseIds(ARTIST, 'user1', db)).toEqual(new Set(['MPRE_a']));
		expect(seenReleaseIds(ARTIST, 'user2', db)).toEqual(new Set(['MPRE_z']));
		// One unsubscribing leaves the other intact.
		unsubscribe(ARTIST, 'user1', db);
		expect(isSubscribed(ARTIST, 'user1', db)).toBe(false);
		expect(isSubscribed(ARTIST, 'user2', db)).toBe(true);
		expect(seenReleaseIds(ARTIST, 'user2', db)).toEqual(new Set(['MPRE_z']));
	});
});

describe('checkSubscription', () => {
	it('enqueues only releases not already seen, then marks them seen', async () => {
		sub(); // seen: MPRE_a, MPRE_b
		const { deps: d, enqueued } = deps(['MPRE_a', 'MPRE_b', 'MPRE_new']);
		const result = await checkSubscription(listSubscriptions('user1', db)[0], db, d);

		expect(enqueued).toEqual(['MPRE_new']);
		expect(result.enqueued).toBe(1);
		expect(seenReleaseIds(ARTIST, 'user1', db).has('MPRE_new')).toBe(true);
		// last_checked_at is now set.
		expect(listSubscriptions('user1', db)[0].lastCheckedAt).not.toBeNull();
	});

	it('is a no-op on the second run when nothing new appeared', async () => {
		sub();
		const first = deps(['MPRE_a', 'MPRE_b', 'MPRE_new']);
		await checkSubscription(listSubscriptions('user1', db)[0], db, first.deps);

		const second = deps(['MPRE_a', 'MPRE_b', 'MPRE_new']);
		const result = await checkSubscription(listSubscriptions('user1', db)[0], db, second.deps);
		expect(second.enqueued).toEqual([]);
		expect(result.enqueued).toBe(0);
	});

	it('leaves a release unseen when enqueue throws, so it retries next time', async () => {
		sub();
		const failing: CheckDeps = {
			getReleases: deps([]).deps.getReleases,
			enqueueAlbum: async () => {
				throw new Error('transient');
			}
		};
		// Point getReleases at a new release that will fail to enqueue.
		failing.getReleases = deps(['MPRE_a', 'MPRE_b', 'MPRE_flaky']).deps.getReleases;
		const result = await checkSubscription(listSubscriptions('user1', db)[0], db, failing);
		expect(result.enqueued).toBe(0);
		expect(seenReleaseIds(ARTIST, 'user1', db).has('MPRE_flaky')).toBe(false);
	});
});

describe('checkDueSubscriptions', () => {
	it('checks every due subscription and aggregates enqueued batches', async () => {
		sub();
		const { deps: d } = deps(['MPRE_a', 'MPRE_b', 'MPRE_new']);
		const result = await checkDueSubscriptions(0, db, d);
		expect(result.enqueued).toBe(1);
		expect(result.batchIds).toEqual(['batch-MPRE_new']);
	});
});
