/**
 * Recognise a pasted YouTube / YouTube Music URL and classify what it points
 * at, so the search bar can jump straight to the album / artist / playlist /
 * song instead of running a text search. Works for unlisted playlists too:
 * the id is taken from the URL, never from search results.
 *
 * Pure and API-free — songs are classified by videoId only; resolving a song
 * to its album (the app has no song page) happens in the caller.
 */

export type YtTarget =
	| { kind: 'album'; id: string }
	| { kind: 'artist'; id: string }
	| { kind: 'playlist'; id: string }
	| { kind: 'song'; videoId: string };

const YT_HOSTS = new Set([
	'music.youtube.com',
	'www.youtube.com',
	'youtube.com',
	'm.youtube.com',
	'youtu.be'
]);

/** YouTube ids are word chars and dashes; reject anything else outright. */
const ID = /^[\w-]+$/;

function id(value: string | null | undefined): string | null {
	return value && ID.test(value) ? value : null;
}

/** Classify a `browse/<id>` or `channel/<id>` id by its prefix. */
function classifyBrowseId(raw: string): YtTarget | null {
	const value = id(raw);
	if (!value) return null;
	if (value.startsWith('MPRE')) return { kind: 'album', id: value };
	if (value.startsWith('UC')) return { kind: 'artist', id: value };
	// PL…, VL…, OLAK5uy…, RD… all render fine on the playlist page.
	return { kind: 'playlist', id: value };
}

/**
 * Parse a pasted URL into a navigation target, or `null` when it is not a
 * recognised YouTube URL (the caller then treats the input as a text query).
 */
export function parseYtUrl(input: string): YtTarget | null {
	let url: URL;
	try {
		url = new URL(input.trim());
	} catch {
		return null;
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
	if (!YT_HOSTS.has(url.hostname.toLowerCase())) return null;

	const segments = url.pathname.split('/').filter(Boolean);
	const first = segments[0];

	// Short links: youtu.be/<videoId>
	if (url.hostname.toLowerCase() === 'youtu.be') {
		const videoId = id(first);
		return videoId ? { kind: 'song', videoId } : null;
	}

	const v = url.searchParams.get('v');
	const list = url.searchParams.get('list');

	// A watch link is a song, even when it carries a &list= context.
	if (first === 'watch' && id(v)) return { kind: 'song', videoId: v as string };
	// A playlist link (or any bare ?list=) is a playlist.
	if (id(list)) return { kind: 'playlist', id: list as string };
	// browse/<id> and channel/<id> cover album, artist and playlist browse ids.
	if ((first === 'browse' || first === 'channel') && segments[1]) {
		return classifyBrowseId(segments[1]);
	}
	// Last resort: a stray v= anywhere still identifies a song.
	if (id(v)) return { kind: 'song', videoId: v as string };
	return null;
}
