const APP_VERSION = '0.1.0';

export interface JellyfinUser {
	id: string;
	name: string;
	isAdmin: boolean;
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
			User?: { Id?: string; Name?: string; Policy?: { IsAdministrator?: boolean } };
		}>('POST', '/Users/AuthenticateByName', { body: { Username: username, Pw: password } });
		if (!result.AccessToken || !result.User?.Id) {
			throw new JellyfinError('Authentication response missing token or user');
		}
		return {
			accessToken: result.AccessToken,
			id: result.User.Id,
			name: result.User.Name ?? username,
			isAdmin: result.User.Policy?.IsAdministrator ?? false
		};
	}

	/** Validates a stored token; returns null when it has been revoked. */
	async me(token: string): Promise<JellyfinUser | null> {
		try {
			const user = await this.request<{
				Id: string;
				Name?: string;
				Policy?: { IsAdministrator?: boolean };
			}>('GET', '/Users/Me', { token });
			return {
				id: user.Id,
				name: user.Name ?? '',
				isAdmin: user.Policy?.IsAdministrator ?? false
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
}
