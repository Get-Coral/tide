import { createFileRoute } from "@tanstack/react-router";

interface GlobalControlBody {
	downloadLimitBps?: number | null;
	uploadLimitBps?: number | null;
}

export const Route = createFileRoute("/api/torrents/control")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const payload = (await request.json()) as GlobalControlBody;
				const { updateGlobalSettings } = await import("#/server/modules/torrent/manager");
				const global = updateGlobalSettings({
					downloadLimitBps: payload.downloadLimitBps,
					uploadLimitBps: payload.uploadLimitBps,
				});
				return Response.json({ global });
			},
		},
	},
});
