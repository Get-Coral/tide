import { createFileRoute } from "@tanstack/react-router";

interface LoginBody {
	username?: string;
	password?: string;
}

export const Route = createFileRoute("/api/auth/login")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const { buildSessionCookie, isSecureRequest } = await import("#/lib/session-cookie");
				const {
					assertLoginAllowed,
					authenticateJellyfinCredentials,
					clearLoginFailures,
					createAuthSession,
					recordLoginFailure,
				} = await import("#/lib/auth-store");

				const ip = getClientIp(request);
				const payload = (await request.json().catch(() => ({}))) as LoginBody;
				const username = payload.username?.trim() ?? "";
				const password = payload.password ?? "";

				if (!username || !password) {
					return new Response("Username and password are required.", { status: 400 });
				}

				try {
					assertLoginAllowed(ip);
				} catch (error) {
					return new Response(toMessage(error), { status: 429 });
				}

				try {
					const session = await authenticateJellyfinCredentials(username, password);
					const token = createAuthSession(session);
					clearLoginFailures(ip);

					return Response.json(
						{ username: session.username, isAdmin: session.isAdmin },
						{
							headers: {
								"set-cookie": buildSessionCookie(token, { secure: isSecureRequest(request) }),
							},
						},
					);
				} catch (error) {
					recordLoginFailure(ip);
					return new Response(toMessage(error), { status: 401 });
				}
			},
		},
	},
});

function getClientIp(request: Request) {
	const forwarded = request.headers.get("x-forwarded-for");
	if (forwarded) return forwarded.split(",")[0]?.trim() || null;
	return request.headers.get("x-real-ip");
}

function toMessage(error: unknown) {
	return error instanceof Error ? error.message : "Sign-in failed.";
}
