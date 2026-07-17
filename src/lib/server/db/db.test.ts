import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaults, getSettings, updateSettings, type Settings } from '../settings.ts';
import { migrate, openDatabase, type DB } from './index.ts';

let dir: string;
let db: DB;

beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'myoutarr-db-'));
	db = openDatabase(path.join(dir, 'test.db'));
});

afterEach(() => {
	db.close();
	rmSync(dir, { recursive: true, force: true });
});

describe('database', () => {
	it('applies all migrations and records the version', () => {
		const version = db.pragma('user_version', { simple: true });
		expect(version).toBeGreaterThanOrEqual(1);
		const tables = db
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
			.all() as { name: string }[];
		const names = tables.map((t) => t.name);
		for (const expected of ['settings', 'sessions', 'batches', 'jobs', 'mb_cache']) {
			expect(names).toContain(expected);
		}
	});

	it('is idempotent: re-running migrate is a no-op', () => {
		expect(() => migrate(db)).not.toThrow();
	});

	it('runs in WAL mode with foreign keys on', () => {
		expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
		expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
	});

	it('cascades job deletion when a batch is removed', () => {
		db.prepare(
			"INSERT INTO batches (id, kind, source_id, title, created_at, created_by) VALUES ('b1', 'album', 's1', 'T', 0, 'u')"
		).run();
		db.prepare(
			"INSERT INTO jobs (id, batch_id, video_id, position) VALUES ('j1', 'b1', 'v1', 0)"
		).run();
		db.prepare("DELETE FROM batches WHERE id = 'b1'").run();
		expect(db.prepare('SELECT COUNT(*) AS n FROM jobs').get()).toEqual({ n: 0 });
	});

	it('rejects invalid job status via CHECK constraint', () => {
		db.prepare(
			"INSERT INTO batches (id, kind, source_id, title, created_at, created_by) VALUES ('b1', 'album', 's1', 'T', 0, 'u')"
		).run();
		expect(() =>
			db
				.prepare(
					"INSERT INTO jobs (id, batch_id, video_id, position, status) VALUES ('j1', 'b1', 'v1', 0, 'bogus')"
				)
				.run()
		).toThrow(/CHECK/);
	});
});

describe('settings', () => {
	it('returns defaults on an empty database', () => {
		expect(getSettings(db)).toEqual(defaults);
	});

	it('round-trips a partial update', () => {
		const updated = updateSettings({ audioFormat: 'mp3', concurrency: 4 }, db);
		expect(updated.audioFormat).toBe('mp3');
		expect(updated.concurrency).toBe(4);
		expect(updated.sponsorBlock).toBe(defaults.sponsorBlock);
		// A fresh read sees the persisted values.
		expect(getSettings(db).audioFormat).toBe('mp3');
	});

	it('ignores unknown keys from stale clients', () => {
		updateSettings({ nonsense: true } as unknown as Partial<Settings>, db);
		expect(getSettings(db)).toEqual(defaults);
	});

	it('falls back to defaults for corrupt or type-mismatched rows', () => {
		db.prepare("INSERT INTO settings (key, value) VALUES ('concurrency', 'not json')").run();
		db.prepare("INSERT INTO settings (key, value) VALUES ('audioFormat', '123')").run();
		const s = getSettings(db);
		expect(s.concurrency).toBe(defaults.concurrency);
		expect(s.audioFormat).toBe(defaults.audioFormat);
	});
});
