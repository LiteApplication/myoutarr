import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
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

/**
 * Ephemeral download scratch. Deliberately NOT under CONFIG_DIR: it must stay
 * off network storage (NFS/Gluster) - it is throwaway, high-churn I/O and only
 * ever touched by this single process. Defaults to a per-boot dir under the OS
 * temp dir (honours TMPDIR, so a tmpfs mount just works); override with
 * SCRATCH_DIR. publish.ts copies out of here into staging, so scratch living on
 * a different filesystem than /music is expected and safe.
 */
export function scratchDir(): string {
	const override = process.env.SCRATCH_DIR?.trim();
	return override ? path.resolve(override) : path.join(os.tmpdir(), 'myoutarr-scratch');
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

/**
 * Git tag this build was released from (e.g. "v1.2.3"), baked into the image
 * as APP_VERSION at Docker build time (see release.yml). Empty for local/dev
 * runs, where there's no tag to show.
 */
export function appVersion(): string | undefined {
	const value = process.env.APP_VERSION?.trim();
	return value ? value : undefined;
}
