import { createFileRoute } from "@tanstack/react-router";

interface GlobalControlBody {
	downloadLimitBps?: number | null;
	uploadLimitBps?: number | null;
	maxActiveDownloads?: number | null;
	maxActiveSeeders?: number | null;
	defaultRatioGoal?: number | null;
	defaultSeedTimeGoalMinutes?: number | null;
	defaultStopOnRatio?: boolean;
	defaultStopOnSeedTime?: boolean;
}

export const Route = createFileRoute("/api/torrents/control")({
	server: {
		handlers: {
			GET: async () => {
				const { getAppSettingsSummary } = await import("#/server/modules/torrent/manager");
				return Response.json({ app: getAppSettingsSummary() });
			},
			POST: async ({ request }) => {
				const payload = (await request.json()) as GlobalControlBody;
				const { updateGlobalSettings } = await import("#/server/modules/torrent/manager");
				const global = updateGlobalSettings({
					downloadLimitBps: payload.downloadLimitBps,
					uploadLimitBps: payload.uploadLimitBps,
					maxActiveDownloads: payload.maxActiveDownloads,
					maxActiveSeeders: payload.maxActiveSeeders,
					defaultRatioGoal: payload.defaultRatioGoal,
					defaultSeedTimeGoalMinutes: payload.defaultSeedTimeGoalMinutes,
					defaultStopOnRatio: payload.defaultStopOnRatio,
					defaultStopOnSeedTime: payload.defaultStopOnSeedTime,
				});
				return Response.json({ global });
			},
		},
	},
});
