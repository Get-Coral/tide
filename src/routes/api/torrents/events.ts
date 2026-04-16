import { createFileRoute } from "@tanstack/react-router";

function sseData(value: unknown) {
	return `data: ${JSON.stringify(value)}\n\n`;
}

export const Route = createFileRoute("/api/torrents/events")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const { listTorrents, subscribeToTorrentUpdates } = await import(
					"#/server/modules/torrent/manager"
				);
				const encoder = new TextEncoder();

				const body = new ReadableStream<Uint8Array>({
					start(controller) {
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
								controller.enqueue(encoder.encode(": keepalive\\n\\n"));
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
			},
		},
	},
});
