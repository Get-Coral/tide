import { getAppSetting, setAppSetting } from "#/server/modules/torrent/store";

const JELLYFIN_URL_KEY = "jellyfin.url";
const REQUIRE_LOGIN_KEY = "auth.requireLogin";

export type SettingSource = "env" | "stored" | "unset";

function normalizeUrl(value: string) {
	return value.trim().replace(/\/+$/, "");
}

function getEnvJellyfinUrl() {
	const value = process.env.TIDE_JELLYFIN_URL?.trim();
	return value ? normalizeUrl(value) : null;
}

function getStoredJellyfinUrl() {
	const value = getAppSetting<string | null>(JELLYFIN_URL_KEY, null);
	return typeof value === "string" && value.trim() ? normalizeUrl(value) : null;
}

/** The env var wins so an operator can always point a container at a new server. */
export function getJellyfinUrl() {
	return getEnvJellyfinUrl() ?? getStoredJellyfinUrl();
}

export function getJellyfinUrlSource(): SettingSource {
	if (getEnvJellyfinUrl()) return "env";
	if (getStoredJellyfinUrl()) return "stored";
	return "unset";
}

/**
 * Confirm a URL actually points at a Jellyfin server before storing it.
 * `/System/Info/Public` is unauthenticated, which is why Tide needs no API key.
 */
export async function verifyJellyfinUrl(url: string) {
	const normalized = normalizeUrl(url);
	if (!/^https?:\/\//i.test(normalized)) {
		throw new Error("Jellyfin URL must start with http:// or https://");
	}

	let response: Response;
	try {
		response = await fetch(`${normalized}/System/Info/Public`, {
			signal: AbortSignal.timeout(10_000),
		});
	} catch {
		throw new Error("Tide could not reach that Jellyfin server.");
	}

	if (!response.ok) {
		throw new Error(`Jellyfin answered with ${response.status} at /System/Info/Public.`);
	}

	return normalized;
}

export async function saveJellyfinUrl(url: string) {
	const trimmed = url.trim();
	if (!trimmed) {
		setAppSetting<string | null>(JELLYFIN_URL_KEY, null);
		return null;
	}

	const verified = await verifyJellyfinUrl(trimmed);
	setAppSetting<string | null>(JELLYFIN_URL_KEY, verified);
	return verified;
}

export function isJellyfinConnected() {
	return getJellyfinUrl() != null;
}

function getEnvRequireLogin() {
	const value = process.env.TIDE_REQUIRE_LOGIN?.trim().toLowerCase();
	if (value === "true") return true;
	if (value === "false") return false;
	return null;
}

/**
 * Unlike Aurora, `false` is honoured as well as `true`. An operator who has
 * locked themselves out (wrong Jellyfin URL, server gone) needs a way back in
 * that does not involve editing SQLite by hand.
 */
export function getRequireLogin() {
	return getEnvRequireLogin() ?? getAppSetting<boolean>(REQUIRE_LOGIN_KEY, false);
}

export function getRequireLoginSource(): SettingSource {
	return getEnvRequireLogin() === null ? "stored" : "env";
}

export function setRequireLogin(enabled: boolean) {
	if (enabled && !isJellyfinConnected()) {
		throw new Error("Connect Tide to a Jellyfin server before requiring sign-in.");
	}
	setAppSetting<boolean>(REQUIRE_LOGIN_KEY, enabled);
}

export function getAccessSettingsSummary() {
	return {
		jellyfinUrl: getJellyfinUrl(),
		jellyfinUrlSource: getJellyfinUrlSource(),
		requireLogin: getRequireLogin(),
		requireLoginSource: getRequireLoginSource(),
	};
}
