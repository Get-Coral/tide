import { createFileRoute } from "@tanstack/react-router";

/** A point-in-time snapshot, for a consumer that cannot hold a stream open. */
export const Route = createFileRoute("/api/coral/downloads")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const { requireServiceAuth } = await import("#/server/service-auth");
				const { denied } = await requireServiceAuth(request);
				if (denied) return denied;

				const { listTorrents } = await import("#/server/modules/torrent/manager");
				return Response.json({ items: listTorrents() });
			},
		},
	},
});
