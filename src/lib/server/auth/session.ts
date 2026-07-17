import { randomBytes } from 'node:crypto';
import type { DB } from '../db/index.ts';
import { getDb } from '../db/index.ts';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SESSION_COOKIE = 'myoutarr_session';

export interface Session {
	id: string;
	jellyfinToken: string;
	userId: string;
	userName: string;
	isAdmin: boolean;
	expiresAt: number;
}

export function createSession(
	user: { id: string; name: string; isAdmin: boolean },
	jellyfinToken: string,
	db: DB = getDb()
): Session {
	const id = randomBytes(32).toString('base64url');
	const now = Date.now();
	const expiresAt = now + SESSION_TTL_MS;
	db.prepare(
		`INSERT INTO sessions (id, jellyfin_token, user_id, user_name, is_admin, created_at, expires_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`
	).run(id, jellyfinToken, user.id, user.name, user.isAdmin ? 1 : 0, now, expiresAt);
	return {
		id,
		jellyfinToken,
		userId: user.id,
		userName: user.name,
		isAdmin: user.isAdmin,
		expiresAt
	};
}

export function getSession(id: string | undefined, db: DB = getDb()): Session | null {
	if (!id) return null;
	const row = db
		.prepare(
			`SELECT id, jellyfin_token, user_id, user_name, is_admin, expires_at
			 FROM sessions WHERE id = ? AND expires_at > ?`
		)
		.get(id, Date.now()) as
		| {
				id: string;
				jellyfin_token: string;
				user_id: string;
				user_name: string;
				is_admin: number;
				expires_at: number;
		  }
		| undefined;
	if (!row) return null;
	return {
		id: row.id,
		jellyfinToken: row.jellyfin_token,
		userId: row.user_id,
		userName: row.user_name,
		isAdmin: row.is_admin === 1,
		expiresAt: row.expires_at
	};
}

export function deleteSession(id: string, db: DB = getDb()): void {
	db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

export function pruneExpiredSessions(db: DB = getDb()): number {
	return db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now()).changes;
}

/**
 * Fixed-window login rate limiter, keyed by client address.
 * In-memory is fine: a single replica owns all traffic (see deployment notes).
 */
const attempts = new Map<string, { count: number; windowStart: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export function loginAllowed(clientAddr: string, now: number = Date.now()): boolean {
	const entry = attempts.get(clientAddr);
	if (!entry || now - entry.windowStart > WINDOW_MS) {
		attempts.set(clientAddr, { count: 1, windowStart: now });
		return true;
	}
	entry.count += 1;
	return entry.count <= MAX_ATTEMPTS;
}

export function resetLoginAttempts(clientAddr: string): void {
	attempts.delete(clientAddr);
}
