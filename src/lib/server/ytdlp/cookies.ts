import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { configDir } from '../env.ts';

/**
 * Per-account yt-dlp cookies. Each Jellyfin user supplies their own
 * Netscape-format cookies.txt (exported from a browser signed in to YouTube),
 * stored at `$CONFIG_DIR/cookies/<userId>.txt`. A legacy shared file at
 * `$CONFIG_DIR/cookies.txt` is still honoured as a fallback so existing
 * single-cookie deployments keep working.
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
 * account has none and no legacy shared file exists.
 */
export function resolveCookiesFile(
	userId: string | null,
	root: string = configDir()
): string | undefined {
	if (userId) {
		const own = cookiesPath(userId, root);
		if (existsSync(own)) return own;
	}
	const legacy = legacyCookiesPath(root);
	return existsSync(legacy) ? legacy : undefined;
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
 * We don't fully parse it — yt-dlp does — but we reject obviously wrong input
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
