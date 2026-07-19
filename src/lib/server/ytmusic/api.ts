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
	/** Audio playlist id - what yt-dlp downloads when fetching the whole album. */
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

export interface SongDetail {
	videoId: string;
	title: string;
	artists: { name: string; id: string | null }[];
	album: { name: string; id: string | null } | null;
	duration: string | null;
	thumbnails: Thumbnail[];
	/** Up-next tracks from the watch queue, shown as "related songs". */
	related: SongResult[];
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

export interface ArtistReleases {
	browseId: string;
	name: string;
	thumbnail: string | null;
	/** Albums + singles/EPs, de-duplicated by browseId. */
	releases: AlbumResult[];
}

/**
 * The full discography of an artist as a flat, de-duplicated release list -
 * the shape subscriptions diff against to find genuinely new releases.
 * Paginated sections ("see all albums/singles") are expanded when present,
 * falling back to the inline preview if the follow-up request fails.
 */
export async function getArtistReleases(
	browseId: string,
	worker: YtMusicWorker = getYtMusic()
): Promise<ArtistReleases> {
	const artist = await getArtist(browseId, worker);
	const albums = artist.albumsParams
		? await getArtistAlbums(artist.albumsParams.browseId, artist.albumsParams.params, worker).catch(
				() => artist.albums
			)
		: artist.albums;
	const singles = artist.singlesParams
		? await getArtistAlbums(
				artist.singlesParams.browseId,
				artist.singlesParams.params,
				worker
			).catch(() => artist.singles)
		: artist.singles;
	const seen = new Set<string>();
	const releases: AlbumResult[] = [];
	for (const release of [...albums, ...singles]) {
		if (seen.has(release.browseId)) continue;
		seen.add(release.browseId);
		releases.push(release);
	}
	return {
		browseId,
		name: artist.name,
		thumbnail: artist.thumbnails.at(-1)?.url ?? null,
		releases
	};
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

/** Map a watch-playlist track (shape differs from search: `length`, `thumbnail`). */
function mapWatchTrack(t: Raw): SongResult | null {
	const videoId = str(t.videoId);
	if (!videoId) return null;
	const album = t.album as Raw | undefined;
	return {
		kind: 'song',
		videoId,
		title: str(t.title) ?? '(untitled)',
		artists: artists(t.artists),
		album: album ? { name: str(album.name) ?? '', id: str(album.id) } : null,
		duration: str(t.length) ?? str(t.duration),
		thumbnails: thumbnails(t.thumbnail ?? t.thumbnails)
	};
}

/**
 * Full detail for a single song's page. Songs have no page of their own in
 * YT Music, so the watch queue stands in: its first track is the song, the rest
 * are shown as related tracks.
 */
export async function getSong(
	videoId: string,
	worker: YtMusicWorker = getYtMusic()
): Promise<SongDetail> {
	const raw = await worker.call<Raw>('song_page', { id: videoId });
	const tracks = arr(raw.tracks);
	const self = tracks.length > 0 ? mapWatchTrack(tracks[0]) : null;
	if (!self) throw new Error('song not found');
	return {
		videoId: self.videoId,
		title: self.title,
		artists: self.artists,
		album: self.album,
		duration: self.duration,
		thumbnails: self.thumbnails,
		related: tracks
			.slice(1)
			.map(mapWatchTrack)
			.filter((t): t is SongResult => t !== null && t.videoId !== self.videoId)
	};
}

/**
 * Radio recommendations for a seed video: songs YT Music considers a vibe match
 * for it. Backs the recommendation-playlist feature. The seed's own track is
 * dropped so callers only ever see genuinely new suggestions.
 */
export async function getRadio(
	videoId: string,
	limit = 50,
	worker: YtMusicWorker = getYtMusic()
): Promise<SongResult[]> {
	const raw = await worker.call<Raw>('song_radio', { id: videoId, limit });
	return arr(raw?.tracks)
		.map(mapWatchTrack)
		.filter((t): t is SongResult => t !== null && t.videoId !== videoId);
}

/**
 * Fill in each song's real album via its song page when it's missing. Radio and
 * hand-built seed songs arrive without album info, which would otherwise make
 * them file under a fake album; resolving here lets tracks land under their real
 * album. Best-effort and concurrency-limited: a lookup that fails leaves the
 * song's album untouched (it then files as its own single). Songs that already
 * carry an album are left as-is (no wasted round trip).
 */
export async function resolveAlbums(
	songs: SongResult[],
	worker: YtMusicWorker = getYtMusic()
): Promise<SongResult[]> {
	const CHUNK = 4;
	const out = [...songs];
	for (let i = 0; i < out.length; i += CHUNK) {
		await Promise.all(
			out.slice(i, i + CHUNK).map(async (song, j) => {
				if (song.album?.name) return;
				try {
					const detail = await getSong(song.videoId, worker);
					if (detail.album?.name) out[i + j] = { ...song, album: detail.album };
				} catch {
					// leave album unresolved; the track files as its own single
				}
			})
		);
	}
	return out;
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
