import { createFileRoute } from "@tanstack/react-router";
import { requireAdmin, requireSession } from "#/server/auth-guards";

interface GlobalControlBody {
	downloadLimitBps?: number | null;
	uploadLimitBps?: number | null;
	maxActiveDownloads?: number | null;
	maxActiveSeeders?: number | null;
}

export const Route = createFileRoute("/api/torrents/control")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const { denied } = await requireSession(request);
				if (denied) return denied;

				const { getAppSettingsSummary } = await import("#/server/modules/torrent/manager");
				return Response.json({ app: getAppSettingsSummary() });
			},
			POST: async ({ request }) => {
				const { denied } = await requireAdmin(request);
				if (denied) return denied;

				const payload = (await request.json()) as GlobalControlBody;
				const { updateGlobalSettings } = await import("#/server/modules/torrent/manager");
				const global = updateGlobalSettings({
					downloadLimitBps: payload.downloadLimitBps,
					uploadLimitBps: payload.uploadLimitBps,
					maxActiveDownloads: payload.maxActiveDownloads,
					maxActiveSeeders: payload.maxActiveSeeders,
				});
				return Response.json({ global });
			},
		},
	},
});
