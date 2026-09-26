import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/auth/logout")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const { buildClearedSessionCookie, getSessionTokenFromCookieHeader, isSecureRequest } =
					await import("#/lib/session-cookie");
				const { destroySessionByToken } = await import("#/lib/auth-store");

				await destroySessionByToken(getSessionTokenFromCookieHeader(request.headers.get("cookie")));

				return new Response(null, {
					status: 204,
					headers: {
						"set-cookie": buildClearedSessionCookie({ secure: isSecureRequest(request) }),
					},
				});
			},
		},
	},
});
