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

/**
 * Base URL of the bgutil PO Token provider HTTP server, if one is deployed
 * (see docker-compose.yml). Empty/unset means no provider - yt-dlp falls back
 * to whatever player client works without a token.
 */
export function potProviderBaseUrl(): string | undefined {
	const url = process.env.POT_PROVIDER_BASE_URL?.trim();
	return url ? url : undefined;
}

/**
 * yt-dlp `--js-runtimes` value (e.g. "node"). Selects the JavaScript runtime
 * yt-dlp uses for YouTube's signature/n-challenge solver. Unset means yt-dlp's
 * default (Deno).
 */
export function ytdlpJsRuntimes(): string | undefined {
	const value = process.env.YTDLP_JS_RUNTIMES?.trim();
	return value ? value : undefined;
}

export function requireAdmin(): boolean {
	return (process.env.REQUIRE_ADMIN ?? 'true').toLowerCase() !== 'false';
}
