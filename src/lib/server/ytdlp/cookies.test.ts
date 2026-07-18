import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	cookiesPath,
	deleteCookies,
	hasCookies,
	looksLikeCookiesFile,
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

	it('falls back to the legacy shared cookies.txt', () => {
		writeFileSync(path.join(root, 'cookies.txt'), NETSCAPE);
		expect(resolveCookiesFile('nobody', root)).toBe(path.join(root, 'cookies.txt'));
		// An account's own file wins over the legacy one.
		saveCookies('nobody', NETSCAPE, root);
		expect(resolveCookiesFile('nobody', root)).toBe(cookiesPath('nobody', root));
	});

	it('returns undefined when there is no owner and no legacy file', () => {
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
