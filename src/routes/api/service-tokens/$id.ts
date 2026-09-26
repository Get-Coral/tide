import { createFileRoute } from "@tanstack/react-router";
import { requireAdmin } from "#/server/auth-guards";

export const Route = createFileRoute("/api/service-tokens/$id")({
	server: {
		handlers: {
			DELETE: async ({ request, params }) => {
				const { denied } = await requireAdmin(request);
				if (denied) return denied;

				const { revokeServiceToken } = await import("#/lib/service-tokens");
				revokeServiceToken(params.id);

				return new Response(null, { status: 204 });
			},
		},
	},
});
