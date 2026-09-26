import { redirect } from "@tanstack/react-router";
import { readSessionState, type SessionState } from "#/server/functions/session";

/**
 * `beforeLoad` helpers for the UI routes. They read the session through a
 * server function rather than `fetch`, because `beforeLoad` also runs during
 * SSR where a browser fetch would carry none of the request's cookies.
 */

function isEnforced(state: SessionState) {
	return state.requireLogin && state.connected;
}

export async function requireSignedIn(href: string) {
	const state = await readSessionState();
	if (isEnforced(state) && !state.isAuthenticated) {
		throw redirect({ to: "/login", search: { redirect: href } });
	}
	return { session: state };
}

export async function requireAdminUser(href: string) {
	const { session } = await requireSignedIn(href);
	if (isEnforced(session) && !session.isAdmin) {
		throw redirect({ to: "/" });
	}
	return { session };
}
