import { getYtMusic, type YtMusicWorker } from './client.ts';

export interface Thumbnail {
	url: string;
	width: number;
	height: number;
}

export interface SongResult {
	kind: 'song';
	videoId: string;
	title: string;
	artists: { name: string; id: string | null }[];
	album: { name: string; id: string | null } | null;
	duration: string | null;
	thumbnails: Thumbnail[];
}

export interface AlbumResult {
	kind: 'album';
	browseId: string;
	title: string;
	albumType: string;
	year: string | null;
	artists: { name: string; id: string | null }[];
	thumbnails: Thumbnail[];
}

export interface ArtistResult {
	kind: 'artist';
	browseId: string;
	name: string;
	thumbnails: Thumbnail[];
}

export interface PlaylistResult {
	kind: 'playlist';
	browseId: string;
	title: string;
	author: string | null;
	itemCount: string | null;
	thumbnails: Thumbnail[];
}

export type SearchResult = SongResult | AlbumResult | ArtistResult | PlaylistResult;

export interface AlbumTrack {
	videoId: string | null;
	title: string;
	artists: { name: string; id: string | null }[];
	duration: string | null;
	trackNumber: number;
	isAvailable: boolean;
}

export interface AlbumDetail {
	browseId: string;
	title: string;
	albumType: string;
	year: string | null;
	artists: { name: string; id: string | null }[];
	trackCount: number;
	duration: string | null;
	thumbnails: Thumbnail[];
	tracks: AlbumTrack[];
	/** Audio playlist id — what yt-dlp downloads when fetching the whole album. */
	audioPlaylistId: string | null;
}

export interface ArtistDetail {
	browseId: string;
	name: string;
	description: string | null;
	thumbnails: Thumbnail[];
	albums: AlbumResult[];
	singles: AlbumResult[];
	/** Browse params for "see all albums", when YT Music paginates. */
	albumsParams: { browseId: string; params: string } | null;
	singlesParams: { browseId: string; params: string } | null;
}

export interface PlaylistDetail {
	browseId: string;
	title: string;
	author: string | null;
	trackCount: number;
	thumbnails: Thumbnail[];
	tracks: SongResult[];
}

/* -------------------------------------------------------------------------- */
/* Raw-shape helpers. ytmusicapi returns loosely-shaped dicts; every accessor  */
/* below tolerates missing fields instead of trusting the upstream schema.     */
/* -------------------------------------------------------------------------- */

type Raw = Record<string, unknown>;

function str(value: unknown): string | null {
	return typeof value === 'string' && value !== '' ? value : null;
}

function arr(value: unknown): Raw[] {
	return Array.isArray(value) ? (value as Raw[]) : [];
}

function thumbnails(value: unknown): Thumbnail[] {
	return arr(value)
		.map((t) => ({
			url: str(t.url) ?? '',
			width: typeof t.width === 'number' ? t.width : 0,
			height: typeof t.height === 'number' ? t.height : 0
		}))
		.filter((t) => t.url !== '');
}

function artists(value: unknown): { name: string; id: string | null }[] {
	return arr(value)
		.map((a) => ({ name: str(a.name) ?? '', id: str(a.id) }))
		.filter((a) => a.name !== '');
}

function mapSearchItem(item: Raw): SearchResult | null {
	switch (item.resultType) {
		case 'song':
		case 'video': {
			const videoId = str(item.videoId);
			if (!videoId) return null;
			const album = item.album as Raw | undefined;
			return {
				kind: 'song',
				videoId,
				title: str(item.title) ?? '(untitled)',
				artists: artists(item.artists),
				album: album ? { name: str(album.name) ?? '', id: str(album.id) } : null,
				duration: str(item.duration),
				thumbnails: thumbnails(item.thumbnails)
			};
		}
		case 'album': {
			const browseId = str(item.browseId);
			if (!browseId) return null;
			return {
				kind: 'album',
				browseId,
				title: str(item.title) ?? '(untitled)',
				albumType: str(item.type) ?? 'Album',
				year: str(item.year),
				artists: artists(item.artists),
				thumbnails: thumbnails(item.thumbnails)
			};
		}
		case 'artist': {
			const browseId = str(item.browseId);
			if (!browseId) return null;
			return {
				kind: 'artist',
				browseId,
				name: str(item.artist) ?? str(item.title) ?? '(unknown)',
				thumbnails: thumbnails(item.thumbnails)
			};
		}
		case 'playlist': {
			const browseId = str(item.browseId);
			if (!browseId) return null;
			return {
				kind: 'playlist',
				browseId,
				title: str(item.title) ?? '(untitled)',
				author: str(item.author),
				itemCount: str(item.itemCount),
				thumbnails: thumbnails(item.thumbnails)
			};
		}
		default:
			return null;
	}
}

export type SearchFilter = 'songs' | 'albums' | 'artists' | 'playlists';

export async function search(
	query: string,
	filter?: SearchFilter,
	worker: YtMusicWorker = getYtMusic()
): Promise<SearchResult[]> {
	const raw = await worker.call<Raw[]>('search', { query, filter, limit: 20 });
	return arr(raw)
		.map(mapSearchItem)
		.filter((r): r is SearchResult => r !== null);
}

function mapAlbumSummary(item: Raw): AlbumResult | null {
	const browseId = str(item.browseId);
	if (!browseId) return null;
	return {
		kind: 'album',
		browseId,
		title: str(item.title) ?? '(untitled)',
		albumType: str(item.type) ?? 'Album',
		year: str(item.year),
		artists: artists(item.artists),
		thumbnails: thumbnails(item.thumbnails)
	};
}

export async function getArtist(
	browseId: string,
	worker: YtMusicWorker = getYtMusic()
): Promise<ArtistDetail> {
	const raw = await worker.call<Raw>('get_artist', { id: browseId });
	const albums = raw.albums as Raw | undefined;
	const singles = raw.singles as Raw | undefined;

	const paramsOf = (section: Raw | undefined) => {
		const sectionBrowseId = str(section?.browseId);
		const params = str(section?.params);
		return sectionBrowseId && params ? { browseId: sectionBrowseId, params } : null;
	};

	return {
		browseId,
		name: str(raw.name) ?? '(unknown)',
		description: str(raw.description),
		thumbnails: thumbnails(raw.thumbnails),
		albums: arr(albums?.results)
			.map(mapAlbumSummary)
			.filter((a): a is AlbumResult => a !== null),
		singles: arr(singles?.results)
			.map(mapAlbumSummary)
			.filter((a): a is AlbumResult => a !== null),
		albumsParams: paramsOf(albums),
		singlesParams: paramsOf(singles)
	};
}

export async function getArtistAlbums(
	browseId: string,
	params: string,
	worker: YtMusicWorker = getYtMusic()
): Promise<AlbumResult[]> {
	const raw = await worker.call<Raw[]>('get_artist_albums', { id: browseId, params });
	return arr(raw)
		.map(mapAlbumSummary)
		.filter((a): a is AlbumResult => a !== null);
}

export async function getAlbum(
	browseId: string,
	worker: YtMusicWorker = getYtMusic()
): Promise<AlbumDetail> {
	const raw = await worker.call<Raw>('get_album', { id: browseId });
	const tracks = arr(raw.tracks).map((t, index) => ({
		videoId: str(t.videoId),
		title: str(t.title) ?? '(untitled)',
		artists: artists(t.artists),
		duration: str(t.duration),
		trackNumber: typeof t.trackNumber === 'number' ? t.trackNumber : index + 1,
		isAvailable: t.isAvailable !== false && str(t.videoId) !== null
	}));
	return {
		browseId,
		title: str(raw.title) ?? '(untitled)',
		albumType: str(raw.type) ?? 'Album',
		year: str(raw.year),
		artists: artists(raw.artists),
		trackCount: typeof raw.trackCount === 'number' ? raw.trackCount : tracks.length,
		duration: str(raw.duration),
		thumbnails: thumbnails(raw.thumbnails),
		tracks,
		audioPlaylistId: str(raw.audioPlaylistId)
	};
}

export interface SongResolution {
	/** Album browseId (MPREb…) the song belongs to, when it has one. */
	albumId: string | null;
	title: string | null;
	artist: string | null;
}

/**
 * Resolve a bare videoId to its album, for navigating a pasted song URL.
 * Songs have no page of their own, so callers redirect to the album (or fall
 * back to a text search using the returned title/artist).
 */
export async function resolveSong(
	videoId: string,
	worker: YtMusicWorker = getYtMusic()
): Promise<SongResolution> {
	const raw = await worker.call<Raw>('resolve_song', { id: videoId });
	return { albumId: str(raw.albumId), title: str(raw.title), artist: str(raw.artist) };
}

export async function getPlaylist(
	browseId: string,
	worker: YtMusicWorker = getYtMusic()
): Promise<PlaylistDetail> {
	const raw = await worker.call<Raw>('get_playlist', { id: browseId, limit: 500 });
	const author = raw.author as Raw | undefined;
	const tracks = arr(raw.tracks)
		.map((t): SongResult | null => {
			const videoId = str(t.videoId);
			if (!videoId) return null;
			const album = t.album as Raw | undefined;
			return {
				kind: 'song',
				videoId,
				title: str(t.title) ?? '(untitled)',
				artists: artists(t.artists),
				album: album ? { name: str(album.name) ?? '', id: str(album.id) } : null,
				duration: str(t.duration),
				thumbnails: thumbnails(t.thumbnails)
			};
		})
		.filter((t): t is SongResult => t !== null);
	return {
		browseId,
		title: str(raw.title) ?? '(untitled)',
		author: str(author?.name),
		trackCount: typeof raw.trackCount === 'number' ? raw.trackCount : tracks.length,
		thumbnails: thumbnails(raw.thumbnails),
		tracks
	};
}
