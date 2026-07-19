import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { configDir } from '../env.ts';
import { migrations } from './migrations.ts';

export type DB = Database.Database;

let instance: DB | null = null;

/**
 * Open (or create) a database, apply pragmas and pending migrations.
 * Exported separately from the singleton so tests can use temp files.
 */
export function openDatabase(file: string): DB {
	mkdirSync(path.dirname(file), { recursive: true });
	const db = new Database(file);
	// EXCLUSIVE locking must be set BEFORE the first WAL operation: it makes
	// SQLite keep the wal-index in heap memory instead of an mmap'd -shm file.
	// That is what lets WAL run safely on GlusterFS/NFS, where shared-memory
	// mmap is not coherent - and it lines up with the single-owner invariant
	// (replicas: 1). The exclusive lock means only this one process can open
	// the DB; a stray second instance fails to open rather than racing the
	// job queue. /config is still best kept node-local for latency/mount safety.
	db.pragma('locking_mode = EXCLUSIVE');
	db.pragma('journal_mode = WAL');
	db.pragma('synchronous = NORMAL');
	db.pragma('foreign_keys = ON');
	db.pragma('busy_timeout = 5000');
	migrate(db);
	return db;
}

export function migrate(db: DB): void {
	const current = db.pragma('user_version', { simple: true }) as number;
	for (let v = current; v < migrations.length; v++) {
		db.transaction(() => {
			db.exec(migrations[v]);
			db.pragma(`user_version = ${v + 1}`);
		})();
	}
}

export function getDb(): DB {
	if (!instance) {
		instance = openDatabase(path.join(configDir(), 'myoutarr.db'));
	}
	return instance;
}

/** Test hook: close and forget the singleton. */
export function closeDb(): void {
	instance?.close();
	instance = null;
}
