import path from 'node:path';
import type { JobMeta } from '../queue/store.ts';

const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

/** Make a single path segment safe on Linux and on SMB-mounted Windows clients. */
export function sanitizeSegment(input: string): string {
	let segment = input
		.normalize('NFC')
		// eslint-disable-next-line no-control-regex
		.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
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
 * Render the naming template into a library-relative file path (no extension).
 * Placeholders: {albumartist} {artist} {album} {year} {title} {track:02} {disc}
 */
export function renderTemplate(template: string, meta: JobMeta): string {
	const fields: Record<string, string> = {
		albumartist: meta.albumArtist || meta.artist || 'Unknown Artist',
		artist: meta.artist || 'Unknown Artist',
		album: meta.album || 'Unknown Album',
		year: meta.year ?? '',
		title: meta.title || 'Untitled',
		disc: meta.discNumber ? String(meta.discNumber) : ''
	};
	const rendered = template.replace(
		/\{(\w+)(?::(\d+))?\}/g,
		(_match, name: string, pad?: string) => {
			if (name === 'track') {
				const track = meta.trackNumber ?? 0;
				return pad ? String(track).padStart(Number(pad), '0') : String(track);
			}
			return fields[name] ?? '';
		}
	);
	return rendered
		.split('/')
		.map((segment) => sanitizeSegment(segment))
		.filter((segment) => segment !== '')
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
