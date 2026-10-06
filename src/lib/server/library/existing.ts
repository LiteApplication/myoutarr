import { execFile } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { JobMeta } from '../queue/store.ts';
import { qualityScore, type AudioQuality } from './quality.ts';

const execFileAsync = promisify(execFile);

export const AUDIO_EXT = /\.(opus|m4a|mp3|flac|ogg)$/i;

/** One audio file already in the library, as read from its own tags and stream. */
export interface LibraryTrack {
	path: string;
	title: string | null;
	artist: string | null;
	albumartist: string | null;
	album: string | null;
	trackNumber: number | null;
	discNumber: number | null;
	totalDiscs: number | null;
	mbTrackId: string | null;
	quality: AudioQuality;
}

export interface ProbeOptions {
	pythonBin?: string;
	script?: string;
}

/**
 * Comparison key for names: folds case, accents, curly quotes and the `_` that
 * sanitising leaves for ":" - so "Hunger Games_ Catching Fire", a curly-apostrophe
 * title and a straight one all meet. Lidarr-written and myoutarr-written trees
 * disagree on exactly these.
 */
export function normalizeName(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Same, with "(feat. X)" / "[with X]" credits removed - they come and go between releases. */
export function normalizeTitle(value: string): string {
	return normalizeName(value.replace(/[([]\s*(?:feat|ft|with)\b[^)\]]*[)\]]/gi, ''));
}

/** Album folders end in " (YYYY)"; the year is not part of the album's identity. */
export function albumDirKey(name: string): string {
	return normalizeName(name.replace(/\s*\(\d{4}\)\s*$/, ''));
}

export function subdirs(dir: string): string[] {
	try {
		return readdirSync(dir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
			.map((entry) => entry.name);
	} catch {
		return [];
	}
}

/** Audio files in an album folder, including one level of per-disc subfolders. */
export function audioFilesIn(albumDir: string): string[] {
	const files: string[] = [];
	const collect = (dir: string) => {
		try {
			for (const entry of readdirSync(dir, { withFileTypes: true })) {
				if (entry.isFile() && AUDIO_EXT.test(entry.name)) files.push(path.join(dir, entry.name));
			}
		} catch {
			// unreadable directory: nothing to match against
		}
	};
	collect(albumDir);
	for (const sub of subdirs(albumDir)) collect(path.join(albumDir, sub));
	return files;
}

/**
 * Every directory that could hold this album: artist folders whose name matches
 * either credit, then album folders matching the title, ignoring case, quoting
 * and the year suffix. More than one can match (e.g. "PORCELAIN (2025)" next to
 * "Porcelain (2025)"); they are all searched.
 */
export function candidateAlbumDirs(libraryRoot: string, meta: JobMeta): string[] {
	const artistKeys = new Set(
		[meta.albumArtist, meta.artist].filter(Boolean).map((name) => normalizeName(name as string))
	);
	const albumKey = normalizeName(meta.album);
	if (albumKey === '') return [];
	const found: string[] = [];
	for (const artistName of subdirs(libraryRoot)) {
		if (!artistKeys.has(normalizeName(artistName))) continue;
		const artistDir = path.join(libraryRoot, artistName);
		for (const albumName of subdirs(artistDir)) {
			if (albumDirKey(albumName) === albumKey) found.push(path.join(artistDir, albumName));
		}
	}
	return found;
}

const PROBE_CHUNK = 40;

/** One element of probe_tracks.py's JSON output. */
interface ProbeRow {
	path: string;
	error?: string;
	title?: string | null;
	artist?: string | null;
	albumartist?: string | null;
	album?: string | null;
	tracknumber?: number | null;
	discnumber?: number | null;
	totaldiscs?: number | null;
	mb_trackid?: string | null;
	quality: { codec: string; lossless: boolean; bitrate_kbps: number; bit_depth?: number | null };
}

/** Read tags + quality for files, through one python process per chunk (argv only). */
export async function probeFiles(
	files: string[],
	options: ProbeOptions = {}
): Promise<LibraryTrack[]> {
	const python = options.pythonBin ?? process.env.YTM_PYTHON ?? 'python3';
	const script = options.script ?? process.env.PROBE_SCRIPT ?? 'python/probe_tracks.py';
	const tracks: LibraryTrack[] = [];
	for (let i = 0; i < files.length; i += PROBE_CHUNK) {
		const { stdout } = await execFileAsync(python, [script, ...files.slice(i, i + PROBE_CHUNK)], {
			timeout: 60_000,
			maxBuffer: 16 * 1024 * 1024
		});
		for (const row of JSON.parse(stdout) as ProbeRow[]) {
			if (row.error) continue; // an unreadable file can neither block nor satisfy a download
			tracks.push({
				path: row.path,
				title: row.title ?? null,
				artist: row.artist ?? null,
				albumartist: row.albumartist ?? null,
				album: row.album ?? null,
				trackNumber: row.tracknumber ?? null,
				discNumber: row.discnumber ?? null,
				totalDiscs: row.totaldiscs ?? null,
				mbTrackId: row.mb_trackid ?? null,
				quality: {
					codec: row.quality.codec,
					lossless: row.quality.lossless,
					bitrateKbps: row.quality.bitrate_kbps,
					bitDepth: row.quality.bit_depth ?? undefined
				}
			});
		}
	}
	return tracks;
}

/**
 * Library copies of the track described by `meta`: same album, same title.
 * Matching is per album (Lidarr's model) - the same recording on a compilation
 * is a different track and is not treated as already present.
 */
export async function findExistingTracks(
	libraryRoot: string,
	meta: JobMeta,
	options: ProbeOptions = {}
): Promise<LibraryTrack[]> {
	const dirs = candidateAlbumDirs(libraryRoot, meta);
	if (dirs.length === 0) return [];
	const want = normalizeTitle(meta.title);
	const probed = await probeFiles(dirs.flatMap(audioFilesIn), options);
	return probed.filter((track) => track.title !== null && normalizeTitle(track.title) === want);
}

/** The highest-quality copy among `tracks`, if any. */
export function bestTrack(tracks: LibraryTrack[]): LibraryTrack | undefined {
	return tracks.reduce<LibraryTrack | undefined>(
		(best, track) =>
			!best || qualityScore(track.quality) > qualityScore(best.quality) ? track : best,
		undefined
	);
}
