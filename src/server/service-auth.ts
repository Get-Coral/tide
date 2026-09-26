import type { ServiceToken, TokenScope } from "#/lib/service-tokens";

/**
 * The gate on `/api/coral/*`.
 *
 * Separate from `requireSession` and `requireAdmin` on purpose: those resolve
 * through a helper that allows everything when Jellyfin sign-in is not
 * enforced, which is the default. This one never calls it. A cross-module
 * endpoint has no first run to keep reachable and no browsing user to be
 * lenient towards.
 *
 * A token is a capability grant. It carries no user identity.
 */

export interface ServiceGuardResult {
	denied: Response | null;
	token: ServiceToken | null;
}

export async function requireServiceAuth(
	request: Request,
	scope: TokenScope = "read",
): Promise<ServiceGuardResult> {
	const { bearerToken, verifyServiceToken } = await import("#/lib/service-tokens");

	const token = verifyServiceToken(bearerToken(request));
	if (!token) {
		return {
			denied: new Response("A Coral service token is required.", {
				status: 401,
				headers: { "WWW-Authenticate": 'Bearer realm="coral"' },
			}),
			token: null,
		};
	}

	if (!hasScope(token, scope)) {
		return {
			denied: new Response(`This token is not allowed to ${scope === "full" ? "act" : "read"}.`, {
				status: 403,
			}),
			token,
		};
	}

	return { denied: null, token };
}

/** `full` implies `read`; nothing implies `full`. */
export function hasScope(token: ServiceToken, scope: TokenScope): boolean {
	if (token.scopes.includes("full")) return true;
	return token.scopes.includes(scope);
}
