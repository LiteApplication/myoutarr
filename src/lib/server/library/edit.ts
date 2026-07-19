import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { musicDir } from '../env.ts';
import type { JobMeta } from '../queue/store.ts';
import { getSettings } from '../settings.ts';
import { renderTemplate, resolveLibraryPath } from './naming.ts';
import { albumNfo, artistNfo } from './nfo.ts';
import { assertMounted } from './publish.ts';
import { safeLibraryPath } from './browse.ts';

const execFileAsync = promisify(execFile);

export interface EditableTags {
	title: string;
	artist: string;
	album: string;
	albumArtist?: string;
	year?: string;
	genre?: string;
	trackNumber?: number;
}

/**
 * Retag a library file in place, move it to where the naming template now
 * says it belongs, and rewrite the album/artist NFOs. Used by both the manual
 * metadata editor and the upload flow.
 */
export async function applyTags(
	relative: string,
	tags: EditableTags,
	options: { root?: string; pythonBin?: string; tagScript?: string } = {}
): Promise<{ newPath: string }> {
	const root = options.root ?? musicDir();
	assertMounted(root);
	const absolute = safeLibraryPath(relative, root);
	if (!existsSync(absolute)) throw new Error('file not found in library');

	// 1. Retag in place via mutagen.
	const metaFile = path.join(tmpdir(), `myoutarr-edit-${Date.now()}.json`);
	writeFileSync(
		metaFile,
		JSON.stringify({
			title: tags.title,
			artist: tags.artist,
			album: tags.album,
			albumartist: tags.albumArtist ?? tags.artist,
			date: tags.year,
			genre: tags.genre,
			tracknumber: tags.trackNumber
		})
	);
	await execFileAsync(
		options.pythonBin ?? process.env.YTM_PYTHON ?? 'python3',
		[options.tagScript ?? process.env.TAG_SCRIPT ?? 'python/tag.py', absolute, metaFile],
		{ timeout: 30_000 }
	);

	// 2. Compute where the file belongs under the (possibly new) metadata.
	const meta: JobMeta = {
		title: tags.title,
		artist: tags.artist,
		album: tags.album,
		albumArtist: tags.albumArtist,
		year: tags.year,
		genre: tags.genre,
		trackNumber: tags.trackNumber
	};
	const template = getSettings().namingTemplate;
	const ext = path.extname(absolute).slice(1);
	const targetPath = resolveLibraryPath(root, renderTemplate(template, meta), ext);

	// 3. Move if the location changed (intra-volume, atomic), pruning what empties.
	if (targetPath !== absolute) {
		mkdirSync(path.dirname(targetPath), { recursive: true });
		renameSync(absolute, targetPath);
		pruneEmptyDirs(path.dirname(absolute), root);
	}

	// 4. Refresh the sidecars at the destination. The NFO tracklist reflects
	// what is actually in the album directory, not just the edited file.
	const albumDir = path.dirname(targetPath);
	const siblingTracks = readdirSync(albumDir)
		.filter((name) => /\.(opus|m4a|mp3|flac|ogg)$/i.test(name))
		.sort()
		.map((name, index) => {
			const match = name.match(/^(\d+)\s*-\s*(.+)\.\w+$/);
			return {
				position: match ? Number(match[1]) : index + 1,
				title: match ? match[2] : name.replace(/\.\w+$/, '')
			};
		});
	writeFileSync(
		path.join(albumDir, 'album.nfo'),
		albumNfo({
			title: tags.album,
			albumArtist: tags.albumArtist ?? tags.artist,
			year: tags.year,
			genres: tags.genre ? [tags.genre] : [],
			tracks: siblingTracks
		})
	);
	const artistDir = path.dirname(albumDir);
	if (path.resolve(artistDir) !== path.resolve(root)) {
		writeFileSync(
			path.join(artistDir, 'artist.nfo'),
			artistNfo({
				name: tags.albumArtist ?? tags.artist,
				genres: tags.genre ? [tags.genre] : []
			})
		);
	}

	return { newPath: path.relative(root, targetPath) };
}

/** Remove now-empty directories up to (but never including) the library root. */
export function pruneEmptyDirs(from: string, root: string): void {
	let current = path.resolve(from);
	const stop = path.resolve(root);
	while (current !== stop && current.startsWith(stop)) {
		const entries = readdirSync(current).filter((n) => !n.endsWith('.nfo') && n !== 'folder.jpg');
		if (entries.length > 0) break;
		try {
			// Only NFOs/cover remain (or nothing): the music is gone, clear it out.
			for (const leftover of readdirSync(current)) {
				const p = path.join(current, leftover);
				try {
					renameSync(p, path.join(tmpdir(), `myoutarr-prune-${Date.now()}-${leftover}`));
				} catch {
					/* best effort */
				}
			}
			rmdirSync(current);
		} catch {
			break;
		}
		current = path.dirname(current);
	}
}

const UPLOAD_EXTENSIONS = new Set(['opus', 'm4a', 'mp3', 'flac', 'ogg']);

/**
 * Ingest an uploaded file: park it in the library under its metadata-derived
 * path via the same retag+move machinery the editor uses.
 */
export async function ingestUpload(
	fileName: string,
	data: Buffer,
	tags: EditableTags,
	options: { root?: string; pythonBin?: string; tagScript?: string } = {}
): Promise<{ newPath: string }> {
	const root = options.root ?? musicDir();
	assertMounted(root);
	const ext = path.extname(fileName).slice(1).toLowerCase();
	if (!UPLOAD_EXTENSIONS.has(ext)) {
		throw new Error(`unsupported audio format .${ext} - use opus, m4a, mp3, flac, or ogg`);
	}
	// Land it in a dotted (scanner-invisible) intake dir on the library volume,
	// so the applyTags move stays intra-filesystem and atomic.
	const intake = path.join(root, '.myoutarr-intake');
	mkdirSync(intake, { recursive: true });
	const parked = path.join(intake, `upload-${Date.now()}.${ext}`);
	writeFileSync(parked, data);
	try {
		return await applyTags(path.relative(root, parked), tags, options);
	} finally {
		if (existsSync(parked)) {
			try {
				renameSync(parked, path.join(tmpdir(), `myoutarr-failed-upload-${Date.now()}.${ext}`));
			} catch {
				/* best effort */
			}
		}
	}
}
