import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/torrents/$id/")({
	server: {
		handlers: {
			GET: async ({ params }) => {
				const { getTorrentById, toTorrentSnapshot } = await import(
					"#/server/modules/torrent/manager"
				);
				const torrent = getTorrentById(params.id);
				if (!torrent) {
					return new Response("Torrent not found.", { status: 404 });
				}
				return Response.json(toTorrentSnapshot(torrent));
			},
			DELETE: async ({ params }) => {
				const { removeTorrent } = await import("#/server/modules/torrent/manager");
				const removed = await removeTorrent(params.id);
				if (!removed) {
					return new Response("Torrent not found.", { status: 404 });
				}
				return new Response(null, { status: 204 });
			},
		},
	},
});
