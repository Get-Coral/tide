import { createFileRoute } from "@tanstack/react-router";

interface ControlBody {
	action?: "pause" | "resume" | "reannounce";
	downloadLimitBps?: number | null;
	uploadLimitBps?: number | null;
	ratioGoal?: number | null;
	seedTimeGoalMinutes?: number | null;
	stopOnRatio?: boolean;
	stopOnSeedTime?: boolean;
	queueOrder?: number;
	addTrackerUrl?: string;
	removeTrackerUrl?: string;
	fileUpdates?: Array<{
		index: number;
		selected?: boolean;
		priority?: number;
	}>;
}

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
			POST: async ({ params, request }) => {
				const payload = (await request.json()) as ControlBody;
				const { updateTorrentControl } = await import("#/server/modules/torrent/manager");
				const updated = await updateTorrentControl(params.id, payload);
				if (!updated) {
					return new Response("Torrent not found.", { status: 404 });
				}
				return Response.json(updated);
			},
		},
	},
});
