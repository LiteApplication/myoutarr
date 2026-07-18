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
	// WAL is safe here because /config is documented as node-local storage -
	// it must never live on GlusterFS/NFS (shared-memory mmap breaks there).
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
