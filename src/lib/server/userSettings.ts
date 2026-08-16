import type { DB } from './db/index.ts';
import { getDb } from './db/index.ts';

/**
 * Settings that belong to one Jellyfin account rather than the whole instance.
 * Same contract as the global `settings.ts`: every key has a typed default, and
 * an unknown or mistyped stored value falls back to it.
 */
export interface UserSettings {
	/** Maintain a Jellyfin playlist holding every track this user has added. */
	downloadsPlaylist: boolean;
	/** Playlist name; empty means "<user name>'s downloads". */
	downloadsPlaylistName: string;
}

export const userDefaults: UserSettings = {
	downloadsPlaylist: false,
	downloadsPlaylistName: ''
};

export function getUserSettings(userId: string, db: DB = getDb()): UserSettings {
	const rows = db.prepare('SELECT key, value FROM user_settings WHERE user_id = ?').all(userId) as {
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
	const merged = { ...userDefaults };
	for (const key of Object.keys(userDefaults) as (keyof UserSettings)[]) {
		if (key in stored && typeof stored[key] === typeof userDefaults[key]) {
			(merged as Record<string, unknown>)[key] = stored[key];
		}
	}
	return merged;
}

export function updateUserSettings(
	userId: string,
	patch: Partial<UserSettings>,
	db: DB = getDb()
): UserSettings {
	const upsert = db.prepare(
		`INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
		 ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value`
	);
	db.transaction(() => {
		for (const [key, value] of Object.entries(patch)) {
			if (!(key in userDefaults)) continue; // ignore unknown keys from stale clients
			upsert.run(userId, key, JSON.stringify(value));
		}
	})();
	return getUserSettings(userId, db);
}

/** Every user who has switched the downloads playlist on. */
export function usersWithDownloadsPlaylist(db: DB = getDb()): string[] {
	const rows = db
		.prepare("SELECT user_id FROM user_settings WHERE key = 'downloadsPlaylist' AND value = 'true'")
		.all() as { user_id: string }[];
	return rows.map((row) => row.user_id);
}
