import crypto from "node:crypto";
import {
	authenticateUserByName,
	createClient,
	JellyfinError,
	logoutUserSession,
} from "@get-coral/jellyfin";
import { getAppDatabase } from "#/server/modules/torrent/store";
import { getJellyfinUrl, getRequireLogin, isJellyfinConnected } from "./config-store";
import { getSessionTokenFromCookieHeader, SESSION_MAX_AGE_SECONDS } from "./session-cookie";

export interface AuthSession {
	userId: string;
	username: string;
	isAdmin: boolean;
	/**
	 * The Jellyfin access token issued at sign-in. Tide never reads library
	 * data with it — it is kept only so signing out of Tide can revoke the
	 * token on the Jellyfin side.
	 */
	jellyfinToken: string | null;
	/** Unique per-session Jellyfin device id the token was issued for. */
	deviceId: string | null;
}

const CREATE_SESSIONS_TABLE_SQL = [
	"CREATE TABLE IF NOT EXISTS auth_sessions (",
	"  token_hash TEXT PRIMARY KEY,",
	"  user_id TEXT NOT NULL,",
	"  username TEXT NOT NULL,",
	"  is_admin INTEGER NOT NULL DEFAULT 0,",
	"  created_at INTEGER NOT NULL,",
	"  expires_at INTEGER NOT NULL,",
	"  jellyfin_token TEXT,",
	"  device_id TEXT",
	");",
].join("\n");

const CLIENT_NAME = "Tide";
const DEVICE_NAME = "Tide Web";
const CLIENT_VERSION = "1.0.0";

let sessionsTableReady = false;

function getSessionsDatabase() {
	const database = getAppDatabase();
	if (!sessionsTableReady) {
		database.exec(CREATE_SESSIONS_TABLE_SQL);
		sessionsTableReady = true;
	}
	return database;
}

function hashToken(token: string) {
	return crypto.createHash("sha256").update(token).digest("hex");
}

function nowSeconds() {
	return Math.floor(Date.now() / 1000);
}

function createJellyfinClient(url: string, deviceId: string) {
	// `authenticateUserByName` signs its request with the client header only, so
	// an empty apiKey/userId is all Tide needs — it never calls an authenticated
	// endpoint with the server's own key.
	return createClient({
		url,
		apiKey: "",
		userId: "",
		clientName: CLIENT_NAME,
		deviceName: DEVICE_NAME,
		deviceId,
		version: CLIENT_VERSION,
	});
}

export function isLoginEnforced() {
	return getRequireLogin() && isJellyfinConnected();
}

export async function authenticateJellyfinCredentials(
	username: string,
	password: string,
): Promise<AuthSession> {
	const url = getJellyfinUrl();
	if (!url) {
		throw new Error("Tide is not connected to a Jellyfin server yet.");
	}

	// Jellyfin revokes the previous token when the same user re-authenticates
	// with the same device id, so every Tide session gets its own — two browsers
	// signed in as the same user must not kill each other's session.
	const deviceId = `tide-web-${crypto.randomBytes(4).toString("hex")}`;

	try {
		const result = await authenticateUserByName(
			createJellyfinClient(url, deviceId),
			username,
			password,
		);
		return {
			userId: result.user.Id,
			username: result.user.Name ?? username,
			isAdmin: result.user.Policy?.IsAdministrator === true,
			jellyfinToken: result.accessToken,
			deviceId,
		};
	} catch (error) {
		if (error instanceof JellyfinError) {
			if (error.status === 401 || error.status === 403) {
				throw new Error("Invalid username or password.");
			}
			throw new Error(`Jellyfin sign-in failed (${error.status ?? "unknown"}).`);
		}
		throw new Error("Tide could not reach the Jellyfin server.");
	}
}

export function createAuthSession(session: AuthSession) {
	const database = getSessionsDatabase();
	const token = crypto.randomBytes(32).toString("hex");
	const createdAt = nowSeconds();

	database
		.prepare(
			"INSERT INTO auth_sessions (token_hash, user_id, username, is_admin, created_at, expires_at, jellyfin_token, device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		)
		.run(
			hashToken(token),
			session.userId,
			session.username,
			session.isAdmin ? 1 : 0,
			createdAt,
			createdAt + SESSION_MAX_AGE_SECONDS,
			session.jellyfinToken,
			session.deviceId,
		);

	return token;
}

export function getSessionByToken(token: string | null | undefined): AuthSession | null {
	if (!token) return null;

	const row = getSessionsDatabase()
		.prepare(
			"SELECT user_id, username, is_admin, expires_at, jellyfin_token, device_id FROM auth_sessions WHERE token_hash = ?",
		)
		.get(hashToken(token)) as
		| {
				user_id: string;
				username: string;
				is_admin: number;
				expires_at: number;
				jellyfin_token: string | null;
				device_id: string | null;
		  }
		| undefined;

	if (!row) return null;

	if (row.expires_at < nowSeconds()) {
		deleteSessionByToken(token);
		return null;
	}

	return {
		userId: row.user_id,
		username: row.username,
		isAdmin: row.is_admin === 1,
		jellyfinToken: row.jellyfin_token,
		deviceId: row.device_id,
	};
}

export function deleteSessionByToken(token: string | null | undefined) {
	if (!token) return;
	getSessionsDatabase()
		.prepare("DELETE FROM auth_sessions WHERE token_hash = ?")
		.run(hashToken(token));
}

/**
 * Delete a session and revoke its Jellyfin access token (best effort), so
 * signing out of Tide also ends the session on the Jellyfin side.
 */
export async function destroySessionByToken(token: string | null | undefined) {
	if (!token) return;

	const session = getSessionByToken(token);
	const url = getJellyfinUrl();
	if (session?.jellyfinToken && url) {
		const client = createJellyfinClient(url, session.deviceId ?? "tide-web");
		await logoutUserSession(client, session.jellyfinToken).catch(() => {
			// Jellyfin unreachable — the token idles out on its own.
		});
	}

	deleteSessionByToken(token);
}

export function sweepExpiredSessions() {
	getSessionsDatabase().prepare("DELETE FROM auth_sessions WHERE expires_at < ?").run(nowSeconds());
}

/** The signed-in session behind a plain `Request`, when sign-in is enforced. */
export function getSessionFromRequest(request: Request): AuthSession | null {
	if (!isLoginEnforced()) return null;
	return getSessionByToken(getSessionTokenFromCookieHeader(request.headers.get("cookie")));
}

// ── Login throttling ─────────────────────────────────────────────────────────
// A small in-memory guard on top of Jellyfin's own lockout policy. Resets on
// restart, which is fine — it only needs to blunt rapid guessing.

const LOGIN_ATTEMPT_WINDOW_SECONDS = 15 * 60;
const LOGIN_ATTEMPT_LIMIT = 10;

const loginFailures = new Map<string, { count: number; resetAt: number }>();

export function assertLoginAllowed(ip: string | null | undefined) {
	if (!ip) return;

	const entry = loginFailures.get(ip);
	if (!entry) return;

	if (entry.resetAt <= nowSeconds()) {
		loginFailures.delete(ip);
		return;
	}

	if (entry.count >= LOGIN_ATTEMPT_LIMIT) {
		throw new Error("Too many failed sign-in attempts. Try again later.");
	}
}

export function recordLoginFailure(ip: string | null | undefined) {
	if (!ip) return;

	const now = nowSeconds();
	const entry = loginFailures.get(ip);
	if (!entry || entry.resetAt <= now) {
		loginFailures.set(ip, { count: 1, resetAt: now + LOGIN_ATTEMPT_WINDOW_SECONDS });
		return;
	}
	entry.count++;
}

export function clearLoginFailures(ip: string | null | undefined) {
	if (!ip) return;
	loginFailures.delete(ip);
}
