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

						const close = () => {
							if (closed) {
								return;
							}
							closed = true;
							stopHeartbeat();
							unsubscribe();
							request.signal.removeEventListener("abort", close);
							controller.close();
						};

						const send = (value: unknown) => {
							if (!closed) {
								controller.enqueue(encoder.encode(sseData(value)));
							}
						};

						send({ items: listTorrents() });

						const unsubscribe = subscribeToTorrentUpdates((items) => {
							send({ items });
						});

						const heartbeat = setInterval(() => {
							if (!closed) {
								controller.enqueue(encoder.encode(": keepalive\\n\\n"));
							}
						}, 15000);

						const stopHeartbeat = () => {
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
