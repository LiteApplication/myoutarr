import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appVersion, readSecret, requireAdmin, stagingDir } from './env.ts';

const saved: Record<string, string | undefined> = {};

function setEnv(key: string, value: string | undefined) {
	if (!(key in saved)) saved[key] = process.env[key];
	if (value === undefined) delete process.env[key];
	else process.env[key] = value;
}

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'myoutarr-env-'));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
	for (const [key, value] of Object.entries(saved)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

describe('readSecret', () => {
	it('prefers a *_FILE indirection over the plain env var', () => {
		const file = path.join(dir, 'secret');
		writeFileSync(file, 'from-file\n');
		setEnv('MY_SECRET_FILE', file);
		setEnv('MY_SECRET', 'from-env');
		expect(readSecret('MY_SECRET')).toBe('from-file');
	});

	it('falls back to the env var and trims whitespace from files', () => {
		setEnv('MY_SECRET_FILE', undefined);
		setEnv('MY_SECRET', 'plain');
		expect(readSecret('MY_SECRET')).toBe('plain');
	});

	it('returns undefined when nothing is set', () => {
		setEnv('MISSING_SECRET', undefined);
		expect(readSecret('MISSING_SECRET')).toBeUndefined();
	});
});

describe('paths and flags', () => {
	it('staging lives inside the music volume (atomic-rename requirement)', () => {
		setEnv('MUSIC_DIR', '/mnt/gluster/music');
		expect(stagingDir()).toBe('/mnt/gluster/music/.myoutarr-staging');
	});

	it('REQUIRE_ADMIN defaults to true and only "false" disables it', () => {
		setEnv('REQUIRE_ADMIN', undefined);
		expect(requireAdmin()).toBe(true);
		setEnv('REQUIRE_ADMIN', 'FALSE');
		expect(requireAdmin()).toBe(false);
		setEnv('REQUIRE_ADMIN', '0');
		expect(requireAdmin()).toBe(true); // only the literal string "false" disables
	});
});

describe('appVersion', () => {
	it('returns undefined when unset (local/dev builds)', () => {
		setEnv('APP_VERSION', undefined);
		expect(appVersion()).toBeUndefined();
	});

	it('returns the trimmed tag baked in at Docker build time', () => {
		setEnv('APP_VERSION', ' v1.2.3 ');
		expect(appVersion()).toBe('v1.2.3');
	});
});
