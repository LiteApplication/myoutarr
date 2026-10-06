import path from 'node:path';
import type { JobMeta } from '../queue/store.ts';

const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

/** Make a single path segment safe on Linux and on SMB-mounted Windows clients. */
export function sanitizeSegment(input: string): string {
	let segment = input
		.normalize('NFC')
		// Lidarr's substitutions: "Title: Sub" -> "Title - Sub", "?" -> "!"
		.replace(/:\s+/g, ' - ')
		.replace(/:/g, '-')
		.replace(/\?/g, '!')
		// eslint-disable-next-line no-control-regex
		.replace(/[<>"/\\|*\u0000-\u001f]/g, '_')
		.replace(/^\.+/, '_') // no dot-prefixed segments: hidden files / '..' traversal
		.replace(/[. ]+$/, '') // Windows rejects trailing dots and spaces
		.trim();
	if (segment === '' || WINDOWS_RESERVED.test(segment)) {
		segment = `_${segment}`;
	}
	// Cap byte length so segment + extension stays under common FS limits.
	while (Buffer.byteLength(segment, 'utf8') > 200) {
		segment = segment.slice(0, -1);
	}
	return segment;
}

/**
 * Lidarr's standard track format, so a library written by myoutarr and one
 * written by Lidarr are indistinguishable (and Lidarr can adopt either).
 * `{discdir}` collapses to nothing on single-disc releases.
 */
export const LIDARR_TEMPLATE =
	'{albumartist}/{album} ({year})/{discdir}/{albumartist} - {album} - {track:02} - {title}';

/** Medium name Lidarr uses for digital releases; there is no physical medium here. */
const MEDIUM_FORMAT = 'Digital Media';

/** Lidarr's token names (`{Artist Name}`, `{Release Year}`...) map onto ours. */
const TOKEN_ALIASES: Record<string, string> = {
	artistname: 'albumartist',
	albumtitle: 'album',
	releaseyear: 'year',
	tracktitle: 'title',
	trackartist: 'artist'
};

/** `{track:02}` pads to 2; Lidarr's `{track:00}` means the same (digits, not a width). */
function padWidth(spec: string): number {
	return /^0+$/.test(spec) ? spec.length : Number(spec);
}

/** Per-disc folder for multi-disc releases, e.g. "Digital Media 01"; '' otherwise. */
export function discFolder(meta: JobMeta): string {
	const multi = (meta.totalDiscs ?? 1) > 1 || (meta.discNumber ?? 1) > 1;
	if (!multi) return '';
	return `${MEDIUM_FORMAT} ${String(meta.discNumber ?? 1).padStart(2, '0')}`;
}

/**
 * Render the naming template into a library-relative file path (no extension).
 * Placeholders: {albumartist} {artist} {album} {year} {title} {track:02} {disc}
 * {medium:02} {mediumformat} {discdir}, plus Lidarr's {Artist Name} {Album Title}
 * {Release Year} {Track Title} {Track Artist}.
 */
export function renderTemplate(template: string, meta: JobMeta): string {
	const fields: Record<string, string> = {
		albumartist: meta.albumArtist || meta.artist || 'Unknown Artist',
		artist: meta.artist || 'Unknown Artist',
		album: meta.album || 'Unknown Album',
		year: meta.year ?? '',
		title: meta.title || 'Untitled',
		disc: meta.discNumber ? String(meta.discNumber) : '',
		mediumformat: MEDIUM_FORMAT,
		discdir: discFolder(meta)
	};
	const rendered = template.replace(
		/\{([\w ]+?)(?::(\d+))?\}/g,
		(_match, rawName: string, pad?: string) => {
			let name = rawName.replace(/ /g, '').toLowerCase();
			name = TOKEN_ALIASES[name] ?? name;
			if (name === 'track' || name === 'medium') {
				const value = name === 'track' ? (meta.trackNumber ?? 0) : (meta.discNumber ?? 1);
				return pad ? String(value).padStart(padWidth(pad), '0') : String(value);
			}
			return fields[name] ?? '';
		}
	);
	return rendered
		.split('/')
		.filter((segment) => segment.trim() !== '') // {discdir} on a single-disc release
		.map((segment) => sanitizeSegment(segment))
		.join('/')
		.replace(/\s*\(\)\s*/g, ''); // drop empty "( )" left by missing years
}

/**
 * Resolve the final absolute path and assert it stays inside the library root.
 * An artist named "../.." must never become a write outside /music.
 */
export function resolveLibraryPath(libraryRoot: string, relative: string, ext: string): string {
	const absolute = path.resolve(libraryRoot, `${relative}.${ext}`);
	const root = path.resolve(libraryRoot) + path.sep;
	if (!absolute.startsWith(root)) {
		throw new Error(`path escapes library root: ${JSON.stringify(relative)}`);
	}
	return absolute;
}
