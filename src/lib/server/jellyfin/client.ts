const APP_VERSION = '0.1.0';

export interface JellyfinUser {
	id: string;
	name: string;
	isAdmin: boolean;
	/** Jellyfin `Policy.EnableCollectionManagement`: allowed to manage collections. */
	canManageCollections: boolean;
}

/**
 * Whether a Jellyfin user may use myoutarr: administrators always may, plus any
 * user granted collection-management rights (our proxy for "can manage the music
 * library"). myoutarr writes to the library filesystem itself, so this gate is a
 * policy choice about who to admit, not a permission it enforces per request.
 */
export function canUseMyoutarr(user: { isAdmin: boolean; canManageCollections: boolean }): boolean {
	return user.isAdmin || user.canManageCollections;
}

export interface JellyfinAuthResult extends JellyfinUser {
	accessToken: string;
}

export interface JellyfinLibrary {
	name: string;
	collectionType: string | null;
	locations: string[];
}

export class JellyfinError extends Error {
	constructor(
		message: string,
		public readonly status?: number
	) {
		super(message);
		this.name = 'JellyfinError';
	}
}

function authHeader(token?: string): string {
	const parts = [
		'MediaBrowser Client="myoutarr"',
		'Device="myoutarr"',
		'DeviceId="myoutarr-server"',
		`Version="${APP_VERSION}"`
	];
	if (token) parts.push(`Token="${token}"`);
	return parts.join(', ');
}

function normalizeUrl(serverUrl: string): string {
	const url = new URL(serverUrl); // throws on garbage input
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new JellyfinError(`Unsupported protocol: ${url.protocol}`);
	}
	return url.origin + url.pathname.replace(/\/+$/, '');
}

/**
 * Minimal Jellyfin REST client. `fetchImpl` is injectable for tests.
 */
export class JellyfinClient {
	private readonly base: string;

	constructor(
		serverUrl: string,
		private readonly fetchImpl: typeof fetch = fetch
	) {
		this.base = normalizeUrl(serverUrl);
	}

	private async request<T>(
		method: string,
		path: string,
		options: { token?: string; body?: unknown } = {}
	): Promise<T> {
		let response: Response;
		try {
			response = await this.fetchImpl(`${this.base}${path}`, {
				method,
				headers: {
					Authorization: authHeader(options.token),
					'Content-Type': 'application/json'
				},
				body: options.body === undefined ? undefined : JSON.stringify(options.body),
				signal: AbortSignal.timeout(15_000)
			});
		} catch (cause) {
			throw new JellyfinError(`Cannot reach Jellyfin at ${this.base}: ${(cause as Error).message}`);
		}
		if (!response.ok) {
			throw new JellyfinError(`Jellyfin responded ${response.status} for ${path}`, response.status);
		}
		if (response.status === 204) return undefined as T;
		return (await response.json()) as T;
	}

	/** Connectivity probe; also validates the URL points at a Jellyfin server. */
	async ping(): Promise<{ serverName: string; version: string }> {
		const info = await this.request<{ ServerName?: string; Version?: string }>(
			'GET',
			'/System/Info/Public'
		);
		if (typeof info?.Version !== 'string') {
			throw new JellyfinError('Endpoint did not identify as a Jellyfin server');
		}
		return { serverName: info.ServerName ?? 'Jellyfin', version: info.Version };
	}

	async authenticateByName(username: string, password: string): Promise<JellyfinAuthResult> {
		const result = await this.request<{
			AccessToken?: string;
			User?: {
				Id?: string;
				Name?: string;
				Policy?: { IsAdministrator?: boolean; EnableCollectionManagement?: boolean };
			};
		}>('POST', '/Users/AuthenticateByName', { body: { Username: username, Pw: password } });
		if (!result.AccessToken || !result.User?.Id) {
			throw new JellyfinError('Authentication response missing token or user');
		}
		return {
			accessToken: result.AccessToken,
			id: result.User.Id,
			name: result.User.Name ?? username,
			isAdmin: result.User.Policy?.IsAdministrator ?? false,
			canManageCollections: result.User.Policy?.EnableCollectionManagement ?? false
		};
	}

	/** Validates a stored token; returns null when it has been revoked. */
	async me(token: string): Promise<JellyfinUser | null> {
		try {
			const user = await this.request<{
				Id: string;
				Name?: string;
				Policy?: { IsAdministrator?: boolean; EnableCollectionManagement?: boolean };
			}>('GET', '/Users/Me', { token });
			return {
				id: user.Id,
				name: user.Name ?? '',
				isAdmin: user.Policy?.IsAdministrator ?? false,
				canManageCollections: user.Policy?.EnableCollectionManagement ?? false
			};
		} catch (error) {
			if (error instanceof JellyfinError && (error.status === 401 || error.status === 403)) {
				return null;
			}
			throw error;
		}
	}

	async musicLibraries(token: string): Promise<JellyfinLibrary[]> {
		const folders = await this.request<
			{ Name?: string; CollectionType?: string; Locations?: string[] }[]
		>('GET', '/Library/VirtualFolders', { token });
		return (folders ?? [])
			.map((f) => ({
				name: f.Name ?? '(unnamed)',
				collectionType: f.CollectionType ?? null,
				locations: f.Locations ?? []
			}))
			.filter((f) => f.collectionType === 'music' || f.collectionType === null);
	}

	async refreshLibrary(token: string): Promise<void> {
		await this.request<void>('POST', '/Library/Refresh', { token });
	}

	/** Find an audio item by title, then match on its filesystem path. */
	async findAudioByPath(token: string, title: string, path: string): Promise<string | null> {
		const result = await this.request<{
			Items?: { Id: string; Path?: string }[];
		}>(
			'GET',
			`/Items?recursive=true&includeItemTypes=Audio&fields=Path&limit=20&searchTerm=${encodeURIComponent(title)}`,
			{ token }
		);
		return result.Items?.find((item) => item.Path === path)?.Id ?? null;
	}

	/** Locate an existing audio playlist by exact name, if any. */
	async findPlaylist(token: string, name: string): Promise<string | null> {
		const result = await this.request<{ Items?: { Id: string; Name?: string }[] }>(
			'GET',
			`/Items?recursive=true&includeItemTypes=Playlist&searchTerm=${encodeURIComponent(name)}`,
			{ token }
		);
		return result.Items?.find((item) => item.Name === name)?.Id ?? null;
	}

	async createPlaylist(
		token: string,
		userId: string,
		name: string,
		itemIds: string[]
	): Promise<string> {
		const result = await this.request<{ Id?: string }>('POST', '/Playlists', {
			token,
			body: { Name: name, UserId: userId, Ids: itemIds, MediaType: 'Audio' }
		});
		if (!result.Id) throw new JellyfinError('playlist creation returned no id');
		return result.Id;
	}

	/** The item ids currently in a playlist, in order. Used to dedup adds. */
	async playlistItemIds(token: string, playlistId: string, userId: string): Promise<string[]> {
		const result = await this.request<{ Items?: { Id: string }[] }>(
			'GET',
			`/Playlists/${playlistId}/Items?userId=${encodeURIComponent(userId)}`,
			{ token }
		);
		return (result.Items ?? []).map((item) => item.Id);
	}

	async addToPlaylist(
		token: string,
		playlistId: string,
		userId: string,
		itemIds: string[]
	): Promise<void> {
		if (itemIds.length === 0) return;
		await this.request<void>(
			'POST',
			`/Playlists/${playlistId}/Items?ids=${itemIds.join(',')}&userId=${encodeURIComponent(userId)}`,
			{ token }
		);
	}

	/**
	 * The playlist's entries, in order, each carrying both the media item id
	 * (`itemId`) and the per-playlist entry id (`playlistItemId`) needed to move
	 * or remove that specific entry.
	 */
	async playlistItems(
		token: string,
		playlistId: string,
		userId: string
	): Promise<{ itemId: string; playlistItemId: string }[]> {
		const result = await this.request<{ Items?: { Id: string; PlaylistItemId?: string }[] }>(
			'GET',
			`/Playlists/${playlistId}/Items?userId=${encodeURIComponent(userId)}&fields=Path`,
			{ token }
		);
		return (result.Items ?? [])
			.filter((item): item is { Id: string; PlaylistItemId: string } =>
				Boolean(item.PlaylistItemId)
			)
			.map((item) => ({ itemId: item.Id, playlistItemId: item.PlaylistItemId }));
	}

	/** Move one playlist entry to a new 0-based index within the playlist. */
	async movePlaylistItem(
		token: string,
		playlistId: string,
		playlistItemId: string,
		newIndex: number
	): Promise<void> {
		await this.request<void>(
			'POST',
			`/Playlists/${playlistId}/Items/${playlistItemId}/Move/${newIndex}`,
			{ token }
		);
	}

	/**
	 * Add items to a playlist and move them to the front, preserving their given
	 * order (item 0 ends up first). Jellyfin has no "insert at index" endpoint, so
	 * this appends then re-fetches to learn the new entries' playlistItemIds and
	 * moves each into place. Newly-added items not already present are prepended;
	 * items already in the playlist are left where they are.
	 */
	async prependToPlaylist(
		token: string,
		playlistId: string,
		userId: string,
		itemIds: string[]
	): Promise<void> {
		if (itemIds.length === 0) return;
		const before = await this.playlistItems(token, playlistId, userId);
		const present = new Set(before.map((e) => e.itemId));
		const toAdd = itemIds.filter((id) => !present.has(id));
		if (toAdd.length === 0) return;
		await this.addToPlaylist(token, playlistId, userId, toAdd);

		// Re-fetch to discover the appended entries' per-playlist ids, then move
		// each to the front in order so `toAdd[0]` becomes index 0.
		const after = await this.playlistItems(token, playlistId, userId);
		const beforeEntryIds = new Set(before.map((e) => e.playlistItemId));
		const newEntryByItem = new Map<string, string>();
		for (const entry of after) {
			if (!beforeEntryIds.has(entry.playlistItemId) && !newEntryByItem.has(entry.itemId)) {
				newEntryByItem.set(entry.itemId, entry.playlistItemId);
			}
		}
		let index = 0;
		for (const itemId of toAdd) {
			const playlistItemId = newEntryByItem.get(itemId);
			if (!playlistItemId) continue;
			await this.movePlaylistItem(token, playlistId, playlistItemId, index);
			index++;
		}
	}
}
