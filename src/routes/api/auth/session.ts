import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/auth/session")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const { getAccessSettingsSummary } = await import("#/lib/config-store");
				const { getSessionFromRequest, isLoginEnforced } = await import("#/lib/auth-store");

				const session = isLoginEnforced() ? getSessionFromRequest(request) : null;

				return Response.json({
					access: getAccessSettingsSummary(),
					session: session ? { username: session.username, isAdmin: session.isAdmin } : null,
					isAuthenticated: session != null,
				});
			},
		},
	},
});
