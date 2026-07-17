import { subscribe, type QueueEvent } from '$lib/server/events';
import type { RequestHandler } from './$types';

/** Server-sent events: queue/job updates pushed to the UI. */
export const GET: RequestHandler = ({ request }) => {
	let unsubscribe: (() => void) | null = null;
	let heartbeat: ReturnType<typeof setInterval> | null = null;

	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();
			const send = (event: QueueEvent) => {
				try {
					controller.enqueue(
						encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`)
					);
				} catch {
					// Consumer already gone; abort handler below cleans up.
				}
			};
			controller.enqueue(encoder.encode(': connected\n\n'));
			unsubscribe = subscribe(send);
			// Keep intermediaries (reverse proxies) from timing the stream out.
			heartbeat = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(': ping\n\n'));
				} catch {
					/* closed */
				}
			}, 25_000);

			request.signal.addEventListener('abort', () => {
				unsubscribe?.();
				if (heartbeat) clearInterval(heartbeat);
				try {
					controller.close();
				} catch {
					/* already closed */
				}
			});
		},
		cancel() {
			unsubscribe?.();
			if (heartbeat) clearInterval(heartbeat);
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache',
			connection: 'keep-alive',
			'x-accel-buffering': 'no'
		}
	});
};
