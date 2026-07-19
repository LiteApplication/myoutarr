import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DB } from '../db/index.ts';
import { getDb } from '../db/index.ts';
import { configDir } from '../env.ts';

/**
 * Per-account yt-dlp cookies. Each Jellyfin user supplies their own
 * Netscape-format cookies.txt (exported from a browser signed in to YouTube),
 * stored at `$CONFIG_DIR/cookies/<userId>.txt`. Cookies are private to each
 * account: a user without their own file simply has none. A legacy shared file
 * at `$CONFIG_DIR/cookies.txt` (from single-user deployments) is migrated to the
 * first user's own file on boot - see `migrateLegacyCookies`.
 */

/** Directory holding one cookies file per account. */
export function cookiesDir(root: string = configDir()): string {
	return path.join(root, 'cookies');
}

/**
 * User ids come from Jellyfin (GUIDs), but never trust them for a filesystem
 * path: collapse to a safe slug so a hostile id can't escape the directory.
 */
function accountSlug(userId: string): string {
	const slug = userId.replace(/[^a-zA-Z0-9_-]/g, '');
	return slug.length > 0 ? slug : 'unknown';
}

/** Absolute path of a given account's cookies file (may not exist). */
export function cookiesPath(userId: string, root: string = configDir()): string {
	return path.join(cookiesDir(root), `${accountSlug(userId)}.txt`);
}

/** Legacy single shared cookies file. */
function legacyCookiesPath(root: string = configDir()): string {
	return path.join(root, 'cookies.txt');
}

/**
 * The cookies file yt-dlp should use for this account, or `undefined` when the
 * account has none. Cookies are not shared between users, so there is no
 * cross-account fallback: the legacy shared file is migrated to a single owner
 * on boot (see `migrateLegacyCookies`) rather than borrowed by everyone.
 */
export function resolveCookiesFile(
	userId: string | null,
	root: string = configDir()
): string | undefined {
	if (!userId) return undefined;
	const own = cookiesPath(userId, root);
	return existsSync(own) ? own : undefined;
}

/**
 * One-time migration for deployments that used the single shared cookies file:
 * hand it to the first user that ever signed in (earliest session) so their
 * downloads keep working, then remove the shared file so it can't leak to other
 * accounts. No-op when there is no legacy file, no users yet, or that user
 * already has their own cookies.
 */
export function migrateLegacyCookies(db: DB = getDb(), root: string = configDir()): void {
	const legacy = legacyCookiesPath(root);
	if (!existsSync(legacy)) return;
	const row = db.prepare('SELECT user_id FROM sessions ORDER BY created_at ASC LIMIT 1').get() as
		{ user_id: string } | undefined;
	if (!row) return; // no user to assign it to yet; try again next boot
	const dest = cookiesPath(row.user_id, root);
	if (existsSync(dest)) {
		rmSync(legacy, { force: true }); // owner already has their own cookies
		return;
	}
	mkdirSync(cookiesDir(root), { recursive: true });
	renameSync(legacy, dest);
}

/** Whether this account has its own cookies file. */
export function hasCookies(userId: string, root: string = configDir()): boolean {
	return existsSync(cookiesPath(userId, root));
}

/** Persist an account's cookies file (creates the directory as needed). */
export function saveCookies(userId: string, contents: string, root: string = configDir()): void {
	const dir = cookiesDir(root);
	mkdirSync(dir, { recursive: true });
	writeFileSync(cookiesPath(userId, root), contents, { mode: 0o600 });
}

/** Remove an account's cookies file if present. */
export function deleteCookies(userId: string, root: string = configDir()): void {
	rmSync(cookiesPath(userId, root), { force: true });
}

/**
 * Cheap sanity check that pasted text looks like a Netscape cookies.txt export.
 * We don't fully parse it - yt-dlp does - but we reject obviously wrong input
 * (e.g. an HTML page or JSON) so users get feedback before a download fails.
 */
export function looksLikeCookiesFile(contents: string): boolean {
	const text = contents.trim();
	if (text.length === 0) return false;
	if (/^#\s*Netscape HTTP Cookie File/i.test(text)) return true;
	// Otherwise require at least one tab-separated line with the 7 Netscape fields.
	return text.split(/\r?\n/).some((line) => !line.startsWith('#') && line.split('\t').length >= 7);
}

/** Read an account's cookies file, or `null` when absent. */
export function readCookies(userId: string, root: string = configDir()): string | null {
	const file = cookiesPath(userId, root);
	return existsSync(file) ? readFileSync(file, 'utf8') : null;
}
