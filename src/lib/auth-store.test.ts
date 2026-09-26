// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dataDir: string;
let authStore: typeof import("./auth-store");

beforeEach(async () => {
	dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tide-auth-"));
	process.env.TIDE_DATA_DIR = dataDir;
	delete process.env.TIDE_REQUIRE_LOGIN;
	delete process.env.TIDE_JELLYFIN_URL;
	vi.resetModules();
	authStore = await import("./auth-store");
});

afterEach(() => {
	vi.useRealTimers();
	delete process.env.TIDE_DATA_DIR;
	delete process.env.TIDE_REQUIRE_LOGIN;
	delete process.env.TIDE_JELLYFIN_URL;
	fs.rmSync(dataDir, { recursive: true, force: true });
});

const session = {
	userId: "user-1",
	username: "ada",
	isAdmin: true,
	jellyfinToken: "jf-token",
	deviceId: "tide-web-abcd1234",
};

describe("session lifecycle", () => {
	it("round-trips a session through its opaque token", () => {
		const token = authStore.createAuthSession(session);
		expect(token).toHaveLength(64);

		const loaded = authStore.getSessionByToken(token);
		expect(loaded).toEqual(session);
	});

	it("rejects an unknown or empty token", () => {
		authStore.createAuthSession(session);
		expect(authStore.getSessionByToken("nope")).toBeNull();
		expect(authStore.getSessionByToken(null)).toBeNull();
	});

	it("drops an expired session instead of returning it", () => {
		const token = authStore.createAuthSession(session);
		// Sessions live 30 days; jump past that.
		vi.useFakeTimers();
		vi.setSystemTime(Date.now() + 31 * 24 * 60 * 60 * 1000);

		expect(authStore.getSessionByToken(token)).toBeNull();
		// The expired row is gone, not merely hidden.
		vi.setSystemTime(Date.now() - 31 * 24 * 60 * 60 * 1000);
		expect(authStore.getSessionByToken(token)).toBeNull();
	});

	it("forgets a deleted session", () => {
		const token = authStore.createAuthSession(session);
		authStore.deleteSessionByToken(token);
		expect(authStore.getSessionByToken(token)).toBeNull();
	});
});

describe("isLoginEnforced", () => {
	it("stays off while Tide has no Jellyfin server, even when required", () => {
		process.env.TIDE_REQUIRE_LOGIN = "true";
		expect(authStore.isLoginEnforced()).toBe(false);
	});

	it("turns on once a server is configured and sign-in is required", () => {
		process.env.TIDE_REQUIRE_LOGIN = "true";
		process.env.TIDE_JELLYFIN_URL = "https://jellyfin.example.com";
		expect(authStore.isLoginEnforced()).toBe(true);
	});
});

describe("login throttling", () => {
	it("blocks an IP after ten failures and clears on success", () => {
		for (let attempt = 0; attempt < 10; attempt++) {
			expect(() => authStore.assertLoginAllowed("10.0.0.1")).not.toThrow();
			authStore.recordLoginFailure("10.0.0.1");
		}

		expect(() => authStore.assertLoginAllowed("10.0.0.1")).toThrow(/Too many failed sign-in/);
		// Other clients are unaffected.
		expect(() => authStore.assertLoginAllowed("10.0.0.2")).not.toThrow();

		authStore.clearLoginFailures("10.0.0.1");
		expect(() => authStore.assertLoginAllowed("10.0.0.1")).not.toThrow();
	});

	it("does nothing without a client IP", () => {
		authStore.recordLoginFailure(null);
		expect(() => authStore.assertLoginAllowed(null)).not.toThrow();
	});
});
