import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "#/server/auth-guards";
import { createTorrentEventResponse } from "#/server/torrent-events";

export const Route = createFileRoute("/api/torrents/events")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const { denied } = await requireSession(request);
				if (denied) return denied;

				return createTorrentEventResponse(request);
			},
		},
	},
});
