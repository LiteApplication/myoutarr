import type { DB } from './db/index.ts';
import { getDb } from './db/index.ts';

export interface Settings {
	/** Audio container/codec passed to yt-dlp --audio-format. */
	audioFormat: 'opus' | 'm4a' | 'mp3' | 'flac';
	/** yt-dlp --audio-quality (0 best … 10 worst; VBR scale for mp3). */
	audioQuality: number;
	/** Parallel downloads. */
	concurrency: number;
	/** Retry attempts per job before it is marked failed. */
	maxRetries: number;
	/** Path template inside the music library. */
	namingTemplate: string;
	/** Remove non-music segments via SponsorBlock. */
	sponsorBlock: boolean;
	/** Enrich tags via MusicBrainz. */
	musicBrainz: boolean;
	/** Trigger a Jellyfin library refresh when a batch completes. */
	jellyfinRefresh: boolean;
	/** Optional yt-dlp rate limit, e.g. "4M". Empty = unlimited. */
	rateLimit: string;
	/** Jellyfin server URL, set during the setup wizard. */
	jellyfinUrl: string;
	/** Jellyfin library path for music, chosen during setup. */
	jellyfinLibraryPath: string;
}

export const defaults: Settings = {
	audioFormat: 'opus',
	audioQuality: 0,
	concurrency: 2,
	maxRetries: 3,
	namingTemplate: '{albumartist}/{album} ({year})/{track:02} - {title}',
	sponsorBlock: true,
	musicBrainz: true,
	jellyfinRefresh: true,
	rateLimit: '',
	jellyfinUrl: '',
	jellyfinLibraryPath: ''
};

export function getSettings(db: DB = getDb()): Settings {
	const rows = db.prepare('SELECT key, value FROM settings').all() as {
		key: string;
		value: string;
	}[];
	const stored: Record<string, unknown> = {};
	for (const row of rows) {
		try {
			stored[row.key] = JSON.parse(row.value);
		} catch {
			// Corrupt row: fall back to the default rather than crash the app.
		}
	}
	const merged = { ...defaults };
	for (const key of Object.keys(defaults) as (keyof Settings)[]) {
		if (key in stored && typeof stored[key] === typeof defaults[key]) {
			// Type-compatible stored value wins; anything else keeps the default.
			(merged as Record<string, unknown>)[key] = stored[key];
		}
	}
	return merged;
}

export function updateSettings(patch: Partial<Settings>, db: DB = getDb()): Settings {
	const upsert = db.prepare(
		'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
	);
	db.transaction(() => {
		for (const [key, value] of Object.entries(patch)) {
			if (!(key in defaults)) continue; // ignore unknown keys from stale clients
			upsert.run(key, JSON.stringify(value));
		}
	})();
	return getSettings(db);
}
