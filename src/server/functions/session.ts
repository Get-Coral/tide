import { createServerFn } from "@tanstack/react-start";

export interface SessionState {
	requireLogin: boolean;
	connected: boolean;
	isAuthenticated: boolean;
	isAdmin: boolean;
	username: string | null;
}

/**
 * Read by `beforeLoad` on the UI routes. It has to be a server function rather
 * than a `fetch` of `/api/auth/session`, because `beforeLoad` also runs during
 * SSR where a plain `fetch` would carry none of the request's cookies.
 */
export const readSessionState = createServerFn({ method: "GET" }).handler(
	async (): Promise<SessionState> => {
		const { getCookie } = await import("@tanstack/react-start/server");
		const { getRequireLogin, isJellyfinConnected } = await import("#/lib/config-store");
		const { getSessionByToken, isLoginEnforced } = await import("#/lib/auth-store");
		const { SESSION_COOKIE_NAME } = await import("#/lib/session-cookie");

		const base = {
			requireLogin: getRequireLogin(),
			connected: isJellyfinConnected(),
		};

		if (!isLoginEnforced()) {
			return { ...base, isAuthenticated: false, isAdmin: false, username: null };
		}

		const session = getSessionByToken(getCookie(SESSION_COOKIE_NAME));
		return {
			...base,
			isAuthenticated: session != null,
			isAdmin: session?.isAdmin === true,
			username: session?.username ?? null,
		};
	},
);
