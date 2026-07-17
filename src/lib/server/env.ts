import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Resolve a secret value: Docker secret file first (/run/secrets/<name>),
 * then SECRET_<NAME>_FILE indirection, then plain env var.
 */
export function readSecret(name: string): string | undefined {
	const secretPath = `/run/secrets/${name.toLowerCase()}`;
	if (existsSync(secretPath)) {
		return readFileSync(secretPath, 'utf8').trim();
	}
	const filePath = process.env[`${name}_FILE`];
	if (filePath && existsSync(filePath)) {
		return readFileSync(filePath, 'utf8').trim();
	}
	return process.env[name];
}

export function configDir(): string {
	return path.resolve(process.env.CONFIG_DIR ?? '/config');
}

export function musicDir(): string {
	return path.resolve(process.env.MUSIC_DIR ?? '/music');
}

export function scratchDir(): string {
	return path.join(configDir(), 'scratch');
}

/** Staging lives inside the music volume so the final rename is intra-filesystem (atomic). */
export function stagingDir(): string {
	return path.join(musicDir(), '.myoutarr-staging');
}

export function requireAdmin(): boolean {
	return (process.env.REQUIRE_ADMIN ?? 'true').toLowerCase() !== 'false';
}
