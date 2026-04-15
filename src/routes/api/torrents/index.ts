import { createFileRoute } from "@tanstack/react-router";

interface AddTorrentBody {
	magnet?: string;
	path?: string;
}

export const Route = createFileRoute("/api/torrents/")({
	server: {
		handlers: {
			GET: async () => {
				const { getGlobalSettings, listTorrents } = await import(
					"#/server/modules/torrent/manager"
				);
				return Response.json({ items: listTorrents(), global: getGlobalSettings() });
			},
			POST: async ({ request }) => {
				const payload = (await request.json()) as AddTorrentBody;
				if (!payload?.magnet || typeof payload.magnet !== "string") {
					return new Response("Missing magnet in request body.", { status: 400 });
				}

				try {
					const { addTorrent } = await import("#/server/modules/torrent/manager");
					const created = await addTorrent({
						magnet: payload.magnet,
						path: typeof payload.path === "string" ? payload.path : undefined,
					});
					return Response.json(created, { status: 201 });
				} catch (error) {
					const message =
						error instanceof Error ? error.message : "Unable to add torrent.";
					const status = /^torrent already exists:/i.test(message) ? 409 : 400;
					return new Response(message, { status });
				}
			},
		},
	},
});
