import { execFile } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { musicDir } from '../env.ts';

const execFileAsync = promisify(execFile);
const AUDIO_EXTENSIONS = new Set(['.opus', '.m4a', '.mp3', '.flac', '.ogg']);

/**
 * Resolve a library-relative path from the client and refuse anything that
 * escapes the music root. All /api/library and editor input goes through this.
 */
export function safeLibraryPath(relative: string, root: string = musicDir()): string {
	const absolute = path.resolve(root, relative);
	const rootPrefix = path.resolve(root) + path.sep;
	if (absolute !== path.resolve(root) && !absolute.startsWith(rootPrefix)) {
		throw new Error('path escapes the library');
	}
	return absolute;
}

export interface LibraryEntry {
	name: string;
	/** library-relative path */
	path: string;
	kind: 'directory' | 'audio';
	sizeBytes?: number;
}

/** One directory level of the library, directories first. */
export function listLibrary(relative = '', root: string = musicDir()): LibraryEntry[] {
	const absolute = safeLibraryPath(relative, root);
	let names: string[];
	try {
		names = readdirSync(absolute);
	} catch {
		return [];
	}
	const entries: LibraryEntry[] = [];
	for (const name of names) {
		if (name.startsWith('.')) continue; // staging, sentinel, hidden files
		const child = path.join(absolute, name);
		let stats;
		try {
			stats = statSync(child);
		} catch {
			continue;
		}
		if (stats.isDirectory()) {
			entries.push({ name, path: path.join(relative, name), kind: 'directory' });
		} else if (AUDIO_EXTENSIONS.has(path.extname(name).toLowerCase())) {
			entries.push({
				name,
				path: path.join(relative, name),
				kind: 'audio',
				sizeBytes: stats.size
			});
		}
	}
	return entries.sort((a, b) =>
		a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1
	);
}

export interface FileTags {
	title: string | null;
	artist: string | null;
	albumartist: string | null;
	album: string | null;
	date: string | null;
	genre: string | null;
	tracknumber: string | null;
	length_seconds?: number;
}

export async function readTags(
	relative: string,
	options: { root?: string; pythonBin?: string; script?: string } = {}
): Promise<FileTags> {
	const absolute = safeLibraryPath(relative, options.root ?? musicDir());
	const { stdout } = await execFileAsync(
		options.pythonBin ?? process.env.YTM_PYTHON ?? 'python3',
		[options.script ?? process.env.READ_TAGS_SCRIPT ?? 'python/read_tags.py', absolute],
		{ timeout: 15_000 }
	);
	return JSON.parse(stdout) as FileTags;
}
