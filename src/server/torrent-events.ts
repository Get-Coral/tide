/**
 * The torrent snapshot stream, shared by the browser-facing route and the
 * cross-module one.
 *
 * Each message is a *full* snapshot rather than a delta, which is what makes
 * this usable as a reconcile stream: a consumer that misses messages, or that
 * reconnects after being down, still converges on the truth from the next one
 * it receives. That property is why Coral pulls rather than having Tide push.
 */

function sseData(value: unknown) {
	return `data: ${JSON.stringify(value)}\n\n`;
}

export function createTorrentEventResponse(request: Request): Response {
	const encoder = new TextEncoder();

	const body = new ReadableStream<Uint8Array>({
		async start(controller) {
			const { listTorrents, subscribeToTorrentUpdates } = await import(
				"#/server/modules/torrent/manager"
			);

			let closed = false;
			let unsubscribe = () => {};
			let stopHeartbeat = () => {};

			const close = () => {
				if (closed) {
					return;
				}
				closed = true;
				stopHeartbeat();
				unsubscribe();
				request.signal.removeEventListener("abort", close);
				try {
					controller.close();
				} catch {
					// Stream is already closed or errored.
				}
			};

			const send = (value: unknown) => {
				if (closed) {
					return;
				}
				try {
					controller.enqueue(encoder.encode(sseData(value)));
				} catch {
					close();
				}
			};

			send({ items: listTorrents() });

			unsubscribe = subscribeToTorrentUpdates((items) => {
				send({ items });
			});

			const heartbeat = setInterval(() => {
				if (closed) {
					return;
				}
				try {
					controller.enqueue(encoder.encode(": keepalive\n\n"));
				} catch {
					close();
				}
			}, 15000);

			stopHeartbeat = () => {
				clearInterval(heartbeat);
			};

			request.signal.addEventListener("abort", close, { once: true });
		},
	});

	return new Response(body, {
		headers: {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-cache, no-transform",
			connection: "keep-alive",
		},
	});
}
