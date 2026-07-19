import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DB } from '../db/index.ts';
import {
	cookiesPath,
	deleteCookies,
	hasCookies,
	looksLikeCookiesFile,
	migrateLegacyCookies,
	readCookies,
	resolveCookiesFile,
	saveCookies
} from './cookies.ts';

const NETSCAPE = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t9999999999\tSID\tabc\n';

describe('per-account cookies', () => {
	let root: string;
	beforeEach(() => {
		root = mkdtempSync(path.join(tmpdir(), 'cookies-'));
	});
	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it('saves and reads an account file', () => {
		expect(hasCookies('user-1', root)).toBe(false);
		saveCookies('user-1', NETSCAPE, root);
		expect(hasCookies('user-1', root)).toBe(true);
		expect(readCookies('user-1', root)).toBe(NETSCAPE);
	});

	it('keeps each account separate', () => {
		saveCookies('alice', NETSCAPE, root);
		expect(resolveCookiesFile('alice', root)).toBe(cookiesPath('alice', root));
		expect(resolveCookiesFile('bob', root)).toBeUndefined();
	});

	it('does not share the legacy cookies.txt across accounts', () => {
		// The legacy shared file is not a cross-account fallback: an account
		// without its own file gets nothing until the file is migrated to it.
		writeFileSync(path.join(root, 'cookies.txt'), NETSCAPE);
		expect(resolveCookiesFile('nobody', root)).toBeUndefined();
	});

	it('returns undefined when there is no owner', () => {
		expect(resolveCookiesFile(null, root)).toBeUndefined();
	});

	it('deletes an account file', () => {
		saveCookies('user-1', NETSCAPE, root);
		deleteCookies('user-1', root);
		expect(hasCookies('user-1', root)).toBe(false);
		// Deleting an absent file is a no-op.
		expect(() => deleteCookies('user-1', root)).not.toThrow();
	});

	it('sanitises hostile ids so they cannot escape the cookies dir', () => {
		const p = cookiesPath('../../etc/passwd', root);
		expect(path.dirname(p)).toBe(path.join(root, 'cookies'));
		expect(path.basename(p)).toBe('etcpasswd.txt');
	});

	it('validates the cookies file shape', () => {
		expect(looksLikeCookiesFile(NETSCAPE)).toBe(true);
		expect(looksLikeCookiesFile('.youtube.com\tTRUE\t/\tTRUE\t99\tSID\tabc')).toBe(true);
		expect(looksLikeCookiesFile('<html>not cookies</html>')).toBe(false);
		expect(looksLikeCookiesFile('')).toBe(false);
	});
});

describe('legacy cookie migration', () => {
	let root: string;
	let db: DB;

	beforeEach(() => {
		root = mkdtempSync(path.join(tmpdir(), 'cookies-mig-'));
		db = openDatabase(path.join(root, 'test.db'));
	});
	afterEach(() => {
		db.close();
		rmSync(root, { recursive: true, force: true });
	});

	function addSession(userId: string, createdAt: number): void {
		db.prepare(
			`INSERT INTO sessions (id, jellyfin_token, user_id, user_name, is_admin, created_at, expires_at)
			 VALUES (?, ?, ?, ?, 0, ?, ?)`
		).run(`s-${userId}`, 'tok', userId, userId, createdAt, createdAt + 1_000_000);
	}

	it('hands the legacy file to the earliest user and removes it', () => {
		writeFileSync(path.join(root, 'cookies.txt'), NETSCAPE);
		addSession('second', 2000);
		addSession('first', 1000);
		migrateLegacyCookies(db, root);
		expect(existsSync(path.join(root, 'cookies.txt'))).toBe(false);
		expect(readCookies('first', root)).toBe(NETSCAPE);
		expect(hasCookies('second', root)).toBe(false);
		expect(resolveCookiesFile('first', root)).toBe(cookiesPath('first', root));
	});

	it('is a no-op when there are no users yet', () => {
		writeFileSync(path.join(root, 'cookies.txt'), NETSCAPE);
		migrateLegacyCookies(db, root);
		expect(existsSync(path.join(root, 'cookies.txt'))).toBe(true);
	});

	it('drops the legacy file when the owner already has their own', () => {
		writeFileSync(path.join(root, 'cookies.txt'), NETSCAPE);
		addSession('first', 1000);
		saveCookies('first', 'OWN\n', root);
		migrateLegacyCookies(db, root);
		expect(existsSync(path.join(root, 'cookies.txt'))).toBe(false);
		expect(readCookies('first', root)).toBe('OWN\n'); // own file untouched
	});
});
