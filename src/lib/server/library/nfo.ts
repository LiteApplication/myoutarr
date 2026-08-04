/** Jellyfin-compatible NFO sidecars. Values are always XML-escaped. */

function esc(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

function tag(name: string, value: string | undefined | null): string {
	return value ? `  <${name}>${esc(value)}</${name}>\n` : '';
}

export interface AlbumNfoInput {
	title: string;
	albumArtist: string;
	/** Credited artists individually, when they are known separately. */
	albumArtists?: string[];
	year?: string;
	genres?: string[];
	mbAlbumId?: string;
	mbReleaseGroupId?: string;
	tracks: { position: number; title: string; duration?: string }[];
}

export function albumNfo(input: AlbumNfoInput): string {
	let xml = '<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<album>\n';
	xml += tag('title', input.title);
	// One element per credited artist so Jellyfin links each of them.
	const albumArtists = input.albumArtists?.length ? input.albumArtists : [input.albumArtist];
	for (const artist of albumArtists) xml += tag('artist', artist);
	for (const artist of albumArtists) xml += tag('albumartist', artist);
	xml += tag('year', input.year);
	for (const genre of input.genres ?? []) xml += tag('genre', genre);
	xml += tag('musicbrainzalbumid', input.mbAlbumId);
	xml += tag('musicbrainzreleasegroupid', input.mbReleaseGroupId);
	for (const track of input.tracks) {
		xml += '  <track>\n';
		xml += `    <position>${track.position}</position>\n`;
		xml += `    <title>${esc(track.title)}</title>\n`;
		if (track.duration) xml += `    <duration>${esc(track.duration)}</duration>\n`;
		xml += '  </track>\n';
	}
	xml += '</album>\n';
	return xml;
}

export interface ArtistNfoInput {
	name: string;
	sortName?: string;
	mbArtistId?: string;
	genres?: string[];
	biography?: string;
}

export function artistNfo(input: ArtistNfoInput): string {
	let xml = '<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<artist>\n';
	xml += tag('name', input.name);
	xml += tag('sortname', input.sortName ?? input.name);
	xml += tag('musicbrainzartistid', input.mbArtistId);
	for (const genre of input.genres ?? []) xml += tag('genre', genre);
	xml += tag('biography', input.biography);
	xml += '</artist>\n';
	return xml;
}
