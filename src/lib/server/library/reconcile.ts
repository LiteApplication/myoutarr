import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { DB } from '../db/index.ts';
import {
	albumDirKey,
	audioFilesIn,
	normalizeName,
	normalizeTitle,
	probeFiles,
	subdirs,
	type LibraryTrack,
	type ProbeOptions
} from './existing.ts';
import { renderTemplate } from './naming.ts';
import { qualityScore } from './quality.ts';
import { relocateOutput } from './relocate.ts';

export interface Move {
	from: string;
	to: string;
}

export interface Removal {
	path: string;
	/** The copy that stays. */
	keeper: string;
}

export interface ReconcilePlan {
	scanned: number;
	moves: Move[];
	removals: Removal[];
	/** Destination already taken by a different file: left alone, reported. */
	conflicts: Move[];
	/** Folders that differ only by case/quoting - the same album split in two. */
	splitFolders: string[][];
}

function metaOf(track: LibraryTrack) {
	return {
		title: track.title ?? path.parse(track.path).name,
		artist: track.artist ?? track.albumartist ?? '',
		album: track.album ?? '',
		albumArtist: track.albumartist ?? track.artist ?? undefined,
		trackNumber: track.trackNumber ?? undefined,
		discNumber: track.discNumber ?? undefined,
		totalDiscs: track.totalDiscs ?? undefined
	};
}

/**
 * Where a file belongs under `template`, keeping the artist/album folders it is
 * already in - reconcile fixes file names and disc folders, it does not
 * re-shelve albums (merging "PORCELAIN" into "Porcelain" is a judgement call, so
 * those are only reported).
 */
export function expectedPath(track: LibraryTrack, template: string, albumDir: string): string {
	const parts = renderTemplate(template, metaOf(track)).split('/');
	const tail = parts.length >= 3 ? parts.slice(2) : parts.slice(-1);
	const ext = path.extname(track.path);
	tail[tail.length - 1] += ext;
	return path.join(albumDir, ...tail);
}

function identityKey(track: LibraryTrack): string {
	return [
		normalizeName(track.albumartist ?? track.artist ?? ''),
		albumDirKey(track.album ?? ''),
		track.discNumber ?? 1,
		track.trackNumber ?? 0,
		normalizeTitle(track.title ?? '')
	].join('|');
}

/**
 * Compare the library with the Lidarr conventions without touching it:
 * duplicates of one track are collapsed onto the best-quality copy, and each
 * survivor is renamed to the template.
 */
export async function planReconcile(
	libraryRoot: string,
	template: string,
	options: ProbeOptions = {}
): Promise<ReconcilePlan> {
	const plan: ReconcilePlan = {
		scanned: 0,
		moves: [],
		removals: [],
		conflicts: [],
		splitFolders: []
	};
	const albumDirOf = new Map<string, string>();
	const files: string[] = [];
	for (const artist of subdirs(libraryRoot)) {
		const artistDir = path.join(libraryRoot, artist);
		const byKey = new Map<string, string[]>();
		for (const album of subdirs(artistDir)) {
			const albumDir = path.join(artistDir, album);
			const key = albumDirKey(album);
			byKey.set(key, [...(byKey.get(key) ?? []), albumDir]);
			for (const file of audioFilesIn(albumDir)) {
				albumDirOf.set(file, albumDir);
				files.push(file);
			}
		}
		for (const dirs of byKey.values()) if (dirs.length > 1) plan.splitFolders.push(dirs);
	}

	const tracks = await probeFiles(files, options);
	plan.scanned = tracks.length;

	const groups = new Map<string, LibraryTrack[]>();
	for (const track of tracks) {
		const key = identityKey(track);
		groups.set(key, [...(groups.get(key) ?? []), track]);
	}

	const taken = new Set<string>();
	for (const group of groups.values()) {
		// Best quality wins; between equals prefer the copy already well named.
		const ranked = [...group].sort(
			(a, b) =>
				qualityScore(b.quality) - qualityScore(a.quality) ||
				Number(expectedPath(b, template, albumDirOf.get(b.path)!) === b.path) -
					Number(expectedPath(a, template, albumDirOf.get(a.path)!) === a.path)
		);
		const keeper = ranked[0];
		for (const extra of ranked.slice(1))
			plan.removals.push({ path: extra.path, keeper: keeper.path });

		const target = expectedPath(keeper, template, albumDirOf.get(keeper.path)!);
		if (target === keeper.path) continue;
		const move = { from: keeper.path, to: target };
		const clash =
			(existsSync(target) && !ranked.some((t) => t.path === target)) || taken.has(target);
		(clash ? plan.conflicts : plan.moves).push(move);
		taken.add(target);
	}
	return plan;
}

/** Sidecars that follow an album when its last track leaves a folder. */
const SIDECARS = ['album.nfo', 'folder.jpg', 'cover.jpg'];

/** Apply a plan. Moves are intra-volume renames; removals only ever delete a lower-or-equal copy. */
export function applyPlan(plan: ReconcilePlan, db?: DB): void {
	for (const { path: gone, keeper } of plan.removals) {
		rmSync(gone, { force: true });
		if (db) relocateOutput(db, gone, keeper);
	}
	for (const { from, to } of plan.moves) {
		mkdirSync(path.dirname(to), { recursive: true });
		renameSync(from, to);
		if (db) relocateOutput(db, from, to);
	}
	// Folders left without audio hand over their sidecars (if the destination has
	// none) and are removed once empty.
	const touched = new Set([...plan.removals.map((r) => r.path), ...plan.moves.map((m) => m.from)]);
	for (const file of touched) {
		const dir = path.dirname(file);
		if (!existsSync(dir) || audioFilesIn(dir).length > 0) continue;
		const heir = plan.moves.find((m) => m.from.startsWith(dir + path.sep));
		for (const name of SIDECARS) {
			const source = path.join(dir, name);
			if (heir && existsSync(source) && !existsSync(path.join(path.dirname(heir.to), name))) {
				renameSync(source, path.join(path.dirname(heir.to), name));
			}
		}
		if (readdirSync(dir).length === 0) rmSync(dir, { recursive: true });
	}
}
