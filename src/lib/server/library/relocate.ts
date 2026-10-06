import type { DB } from '../db/index.ts';

/**
 * A library file is about to stop existing at `from` (replaced by an upgrade or
 * moved by a reconcile). Repoint completed jobs at `to` so they are not mistaken
 * for a Jellyfin-side deletion, and forget the playlist item ids resolved for the
 * old path - Jellyfin gives the new file a new id.
 */
export function relocateOutput(db: DB, from: string, to: string): void {
	db.prepare('UPDATE jobs SET output_path = ? WHERE output_path = ?').run(to, from);
	db.prepare('DELETE FROM downloads_playlist_items WHERE path = ?').run(from);
}
