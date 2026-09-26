import { createFileRoute } from "@tanstack/react-router";
import { requireAdmin } from "#/server/auth-guards";

/**
 * Managing the tokens other Coral modules use to call Tide.
 *
 * Deliberately *not* under `/api/coral/`. That prefix is exempt from HTTP
 * basic and gated by service tokens, which would mean a token could mint
 * itself more tokens. Managing them is administration, and goes through the
 * ordinary admin guard and the browser session.
 */
export const Route = createFileRoute("/api/service-tokens/")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const { denied } = await requireAdmin(request);
				if (denied) return denied;

				const { listServiceTokens } = await import("#/lib/service-tokens");
				return Response.json({
					tokens: listServiceTokens(),
					environmentToken: Boolean(process.env.CORAL_SERVICE_TOKEN?.trim()),
				});
			},
			POST: async ({ request }) => {
				const { denied } = await requireAdmin(request);
				if (denied) return denied;

				const payload = (await request.json().catch(() => null)) as {
					label?: string;
					scope?: "read" | "full";
				} | null;

				if (!payload?.label?.trim()) {
					return new Response("A label is required.", { status: 400 });
				}

				const scope = payload.scope === "full" ? "full" : "read";
				const { mintServiceToken } = await import("#/lib/service-tokens");

				// The secret is in this response and nowhere else, ever again.
				return Response.json(mintServiceToken({ label: payload.label, scopes: [scope] }), {
					status: 201,
				});
			},
		},
	},
});
