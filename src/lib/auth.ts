/**
 * Browser-side wrappers for the auth endpoints. Kept apart from
 * `#/lib/auth-store`, which is server-only (SQLite + Jellyfin).
 */

export type AccessSettingSource = "env" | "stored" | "unset";

export interface AccessSettings {
	jellyfinUrl: string | null;
	jellyfinUrlSource: AccessSettingSource;
	requireLogin: boolean;
	requireLoginSource: AccessSettingSource;
}

export interface SessionResponse {
	access: AccessSettings;
	session: { username: string; isAdmin: boolean } | null;
	isAuthenticated: boolean;
}

async function parseError(response: Response, fallback: string) {
	try {
		const text = (await response.text()).trim();
		if (text && !text.startsWith("<")) {
			return text.length > 240 ? `${text.slice(0, 237)}...` : text;
		}
	} catch {
		// Fall through to the status-based message.
	}
	return `${fallback} (${response.status})`;
}

export async function getSessionState() {
	const response = await fetch("/api/auth/session", { method: "GET" });
	if (!response.ok) {
		throw new Error(await parseError(response, "Could not read the session"));
	}
	return (await response.json()) as SessionResponse;
}

export async function signIn(username: string, password: string) {
	const response = await fetch("/api/auth/login", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ username, password }),
	});
	if (!response.ok) {
		throw new Error(await parseError(response, "Sign-in failed"));
	}
	return (await response.json()) as { username: string; isAdmin: boolean };
}

export async function signOut() {
	const response = await fetch("/api/auth/logout", { method: "POST" });
	if (!response.ok) {
		throw new Error(await parseError(response, "Sign-out failed"));
	}
}

export async function saveAccessSettings(input: {
	jellyfinUrl?: string | null;
	requireLogin?: boolean;
}) {
	const response = await fetch("/api/auth/settings", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
	if (!response.ok) {
		throw new Error(await parseError(response, "Could not save access settings"));
	}
	const payload = (await response.json()) as { access: AccessSettings };
	return payload.access;
}
