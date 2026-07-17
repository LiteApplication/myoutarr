import http from 'node:http';

/** Minimal Jellyfin impersonation: enough for the setup wizard and login. */
export function startMockJellyfin(port: number): Promise<http.Server> {
	const server = http.createServer((req, res) => {
		const url = req.url ?? '';
		const send = (status: number, body: unknown) => {
			res.writeHead(status, { 'content-type': 'application/json' });
			res.end(JSON.stringify(body));
		};

		if (url.startsWith('/System/Info/Public')) {
			return send(200, { ServerName: 'MockFlix', Version: '10.10.0' });
		}
		if (url.startsWith('/Users/AuthenticateByName')) {
			let raw = '';
			req.on('data', (chunk) => (raw += chunk));
			req.on('end', () => {
				const body = JSON.parse(raw || '{}');
				if (body.Username === 'admin' && body.Pw === 'secret') {
					return send(200, {
						AccessToken: 'mock-token',
						User: { Id: 'user-1', Name: 'admin', Policy: { IsAdministrator: true } }
					});
				}
				return send(401, {});
			});
			return;
		}
		if (url.startsWith('/Library/VirtualFolders')) {
			return send(200, [{ Name: 'Tunes', CollectionType: 'music', Locations: ['/data/music'] }]);
		}
		if (url.startsWith('/Library/Refresh')) {
			res.writeHead(204).end();
			return;
		}
		send(404, {});
	});
	return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
