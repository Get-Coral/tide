import type { AuthSession } from "#/lib/auth-store";

/**
 * Request-level guards for the plain API route handlers. Aurora gates server
 * functions with `createMiddleware`, but Tide's endpoints are
 * `server: { handlers: { ... } }` route handlers, so they take a `Request` and
 * hand back the rejection `Response` to return early.
 *
 * Both resolve to `null` (allow) whenever sign-in is not enforced, which is the
 * default — an unconfigured Tide behaves exactly as it did before.
 */

export interface GuardResult {
	denied: Response | null;
	session: AuthSession | null;
}

async function resolve(request: Request) {
	const { isLoginEnforced, getSessionFromRequest } = await import("#/lib/auth-store");
	if (!isLoginEnforced()) {
		return { enforced: false, session: null } as const;
	}
	return { enforced: true, session: getSessionFromRequest(request) } as const;
}

export async function requireSession(request: Request): Promise<GuardResult> {
	const { enforced, session } = await resolve(request);
	if (!enforced) return { denied: null, session: null };
	if (!session) return { denied: unauthorized(), session: null };
	return { denied: null, session };
}

export async function requireAdmin(request: Request): Promise<GuardResult> {
	const { enforced, session } = await resolve(request);
	if (!enforced) return { denied: null, session: null };
	if (!session) return { denied: unauthorized(), session: null };
	if (!session.isAdmin) return { denied: forbidden(), session };
	return { denied: null, session };
}

function unauthorized() {
	return new Response("Sign in to use Tide.", { status: 401 });
}

function forbidden() {
	return new Response("This action is limited to Jellyfin administrators.", { status: 403 });
}
