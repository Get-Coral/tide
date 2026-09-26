import { createFileRoute } from "@tanstack/react-router";
import { createTorrentEventResponse } from "#/server/torrent-events";

/**
 * The same snapshot stream the UI uses, behind a service token instead of a
 * browser session.
 *
 * Deliberately not a webhook. Tide already emits full snapshots, so this is
 * already a reconcile stream; a consumer subscribes, diffs against whatever
 * it has already acted on, and gets idempotency for free. Pushing instead
 * would need a delivery queue, retries, a dead-letter path, replay after
 * downtime, a second credential pointing the other way, and reachability
 * from Tide to the consumer — to deliver knowledge only the consumer has.
 */
export const Route = createFileRoute("/api/coral/events")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const { requireServiceAuth } = await import("#/server/service-auth");
				const { denied } = await requireServiceAuth(request);
				if (denied) return denied;

				return createTorrentEventResponse(request);
			},
		},
	},
});
