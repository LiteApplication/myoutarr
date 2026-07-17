import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DB } from '../db/index.ts';
import {
	createSession,
	deleteSession,
	getSession,
	loginAllowed,
	pruneExpiredSessions,
	resetLoginAttempts
} from './session.ts';

let dir: string;
let db: DB;

beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'myoutarr-auth-'));
	db = openDatabase(path.join(dir, 'test.db'));
});

afterEach(() => {
	db.close();
	rmSync(dir, { recursive: true, force: true });
});

const user = { id: 'u1', name: 'alexis', isAdmin: true };

describe('sessions', () => {
	it('creates and retrieves a session', () => {
		const created = createSession(user, 'jf-token', db);
		expect(created.id).toHaveLength(43); // 32 bytes base64url
		const found = getSession(created.id, db);
		expect(found).toMatchObject({
			userId: 'u1',
			userName: 'alexis',
			isAdmin: true,
			jellyfinToken: 'jf-token'
		});
	});

	it('returns null for unknown or missing ids', () => {
		expect(getSession('nope', db)).toBeNull();
		expect(getSession(undefined, db)).toBeNull();
	});

	it('does not return expired sessions and prunes them', () => {
		const created = createSession(user, 't', db);
		db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(Date.now() - 1, created.id);
		expect(getSession(created.id, db)).toBeNull();
		expect(pruneExpiredSessions(db)).toBe(1);
	});

	it('deletes a session on logout', () => {
		const created = createSession(user, 't', db);
		deleteSession(created.id, db);
		expect(getSession(created.id, db)).toBeNull();
	});
});

describe('login rate limiter', () => {
	it('allows up to the cap inside a window, then blocks', () => {
		resetLoginAttempts('10.0.0.1');
		for (let i = 0; i < 10; i++) {
			expect(loginAllowed('10.0.0.1', 1000)).toBe(true);
		}
		expect(loginAllowed('10.0.0.1', 1000)).toBe(false);
	});

	it('resets after the window elapses', () => {
		resetLoginAttempts('10.0.0.2');
		for (let i = 0; i < 11; i++) loginAllowed('10.0.0.2', 1000);
		expect(loginAllowed('10.0.0.2', 1000 + 16 * 60 * 1000)).toBe(true);
	});

	it('tracks addresses independently', () => {
		resetLoginAttempts('10.0.0.3');
		resetLoginAttempts('10.0.0.4');
		for (let i = 0; i < 11; i++) loginAllowed('10.0.0.3', 1000);
		expect(loginAllowed('10.0.0.3', 1000)).toBe(false);
		expect(loginAllowed('10.0.0.4', 1000)).toBe(true);
	});
});
