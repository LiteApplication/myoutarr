/**
 * Process-wide pub/sub feeding the SSE endpoint. Single-replica deployment
 * (enforced in the stack file) means in-memory fan-out is complete coverage.
 */
export interface QueueEvent {
	type: 'job' | 'batch' | 'queue';
	payload: unknown;
}

type Listener = (event: QueueEvent) => void;

const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function publish(event: QueueEvent): void {
	for (const listener of listeners) {
		try {
			listener(event);
		} catch {
			// One bad SSE consumer must not break the others.
		}
	}
}

export function listenerCount(): number {
	return listeners.size;
}
