import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { musicDir } from '../env.ts';
import { safeLibraryPath } from './browse.ts';
import { pruneEmptyDirs } from './edit.ts';
import { albumNfo } from './nfo.ts';
import { assertMounted } from './publish.ts';

const AUDIO_RE = /\.(opus|m4a|mp3|flac|ogg)$/i;

export interface DeleteResult {
	/** What the deleted entry represented, inferred from its depth/kind. */
	kind: 'artist' | 'album' | 'track';
	/** library-relative path that was removed */
	removed: string;
}

/**
 * Delete an artist directory, album directory, or single track from the
 * library. Directories are removed recursively; a track deletion keeps the
 * containing album.nfo tracklist in sync when siblings remain, and otherwise
 * lets pruneEmptyDirs clear the leftover NFO/cover and the empty tree above it.
 *
 * Sentinel- and path-guarded like every other library write.
 */
export function deleteLibraryEntry(
	relative: string,
	options: { root?: string } = {}
): DeleteResult {
	const root = options.root ?? musicDir();
	assertMounted(root);
	const absolute = safeLibraryPath(relative, root);
	if (path.resolve(absolute) === path.resolve(root)) {
		throw new Error('refusing to delete the library root');
	}
	if (!existsSync(absolute)) throw new Error('not found in library');

	const stats = statSync(absolute);
	const parent = path.dirname(absolute);

	if (stats.isDirectory()) {
		// Top-level directory is an artist; anything nested is an album.
		const isTopLevel = path.resolve(parent) === path.resolve(root);
		rmSync(absolute, { recursive: true, force: true });
		pruneEmptyDirs(parent, root);
		return { kind: isTopLevel ? 'artist' : 'album', removed: relative };
	}

	if (!AUDIO_RE.test(absolute)) {
		throw new Error('refusing to delete a non-audio file');
	}
	rmSync(absolute, { force: true });
	// If music remains in the album, refresh its tracklist; if it is now only
	// sidecars (or empty), pruneEmptyDirs clears the whole directory below.
	if (existsSync(parent) && readdirSync(parent).some((n) => AUDIO_RE.test(n))) {
		try {
			refreshAlbumNfoTracklist(parent);
		} catch {
			// Best effort: the file is already gone; a stale NFO is harmless and
			// gets rebuilt on the next edit/download into this album.
		}
	}
	pruneEmptyDirs(parent, root);
	return { kind: 'track', removed: relative };
}

/** Reverse the XML escaping applied by nfo.ts. */
function unesc(value: string): string {
	return value
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replaceAll('&quot;', '"')
		.replaceAll('&apos;', "'")
		.replaceAll('&amp;', '&');
}

/**
 * Rebuild album.nfo's <track> list from the files actually present, preserving
 * the album-level metadata already written in the sidecar. Mirrors the tracklist
 * derivation in edit.ts so both paths stay consistent.
 */
function refreshAlbumNfoTracklist(albumDir: string): void {
	const nfoPath = path.join(albumDir, 'album.nfo');
	if (!existsSync(nfoPath)) return;
	const xml = readFileSync(nfoPath, 'utf8');
	// Strip <track> blocks before picking album-level scalars so a track's own
	// <title> can't shadow the album title.
	const head = xml.replace(/<track>[\s\S]*?<\/track>/g, '');
	const pick = (name: string): string | undefined => {
		const m = head.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
		return m ? unesc(m[1]) : undefined;
	};
	const genres = [...head.matchAll(/<genre>([\s\S]*?)<\/genre>/g)].map((m) => unesc(m[1]));

	const tracks = readdirSync(albumDir)
		.filter((name) => AUDIO_RE.test(name))
		.sort()
		.map((name, index) => {
			const match = name.match(/^(\d+)\s*-\s*(.+)\.\w+$/);
			return {
				position: match ? Number(match[1]) : index + 1,
				title: match ? match[2] : name.replace(/\.\w+$/, '')
			};
		});

	writeFileSync(
		nfoPath,
		albumNfo({
			title: pick('title') ?? path.basename(albumDir),
			albumArtist: pick('albumartist') ?? pick('artist') ?? '',
			year: pick('year'),
			genres,
			mbAlbumId: pick('musicbrainzalbumid'),
			mbReleaseGroupId: pick('musicbrainzreleasegroupid'),
			tracks
		})
	);
}
