/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

declare const self: ServiceWorkerGlobalScope;

const CACHE = `cache-${version}`;
const ASSETS = [
	...build, // compiled JS/CSS files
	...files  // static files
];

self.addEventListener('install', (event) => {
	async function addFilesToCache() {
		const cache = await caches.open(CACHE);
		await cache.addAll(ASSETS);
	}

	event.waitUntil(addFilesToCache());
});

self.addEventListener('activate', (event) => {
	async function deleteOldCaches() {
		for (const key of await caches.keys()) {
			if (key !== CACHE) {
				await caches.delete(key);
			}
		}
	}

	event.waitUntil(deleteOldCaches());
});

self.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') return;

	async function respond() {
		const url = new URL(event.request.url);
		const cache = await caches.open(CACHE);

		// Always try network first for API routes and dynamically fetched data
		if (url.pathname.startsWith('/api') || url.searchParams.has('__data')) {
			try {
				return await fetch(event.request);
			} catch (err) {
				const cachedResponse = await cache.match(event.request);
				if (cachedResponse) return cachedResponse;
				throw err;
			}
		}

		// For build assets / static files, try cache first, fall back to network
		if (ASSETS.includes(url.pathname)) {
			const cachedResponse = await cache.match(url.pathname);
			if (cachedResponse) return cachedResponse;
		}

		// For other navigation and normal files, try network first, then cache, then offline fallback
		try {
			const response = await fetch(event.request);
			if (response.status === 200) {
				cache.put(event.request, response.clone());
			}
			return response;
		} catch {
			const cachedResponse = await cache.match(event.request);
			if (cachedResponse) return cachedResponse;
			
			// Offline fallback for navigation requests
			if (event.request.headers.get('accept')?.includes('text/html')) {
				return (await cache.match('/')) || Response.error();
			}
			return Response.error();
		}
	}

	event.respondWith(respond());
});
