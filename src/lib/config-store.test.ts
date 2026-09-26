// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dataDir: string;
let store: typeof import("./config-store");

beforeEach(async () => {
	dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tide-config-"));
	process.env.TIDE_DATA_DIR = dataDir;
	delete process.env.TIDE_REQUIRE_LOGIN;
	delete process.env.TIDE_JELLYFIN_URL;
	// Fresh module graph per test so the SQLite handle picks up TIDE_DATA_DIR.
	vi.resetModules();
	store = await import("./config-store");
});

afterEach(() => {
	delete process.env.TIDE_DATA_DIR;
	delete process.env.TIDE_REQUIRE_LOGIN;
	delete process.env.TIDE_JELLYFIN_URL;
	fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("getRequireLogin", () => {
	it("defaults to false", () => {
		expect(store.getRequireLogin()).toBe(false);
		expect(store.getRequireLoginSource()).toBe("stored");
	});

	it("reads the stored value when the env var is unset", () => {
		process.env.TIDE_JELLYFIN_URL = "https://jellyfin.example.com";
		store.setRequireLogin(true);
		expect(store.getRequireLogin()).toBe(true);
		expect(store.getRequireLoginSource()).toBe("stored");
	});

	it("lets TIDE_REQUIRE_LOGIN=true win over a stored false", () => {
		process.env.TIDE_REQUIRE_LOGIN = "true";
		expect(store.getRequireLogin()).toBe(true);
		expect(store.getRequireLoginSource()).toBe("env");
	});

	it("lets TIDE_REQUIRE_LOGIN=false win over a stored true — the lockout escape hatch", () => {
		process.env.TIDE_JELLYFIN_URL = "https://jellyfin.example.com";
		store.setRequireLogin(true);
		process.env.TIDE_REQUIRE_LOGIN = "false";
		expect(store.getRequireLogin()).toBe(false);
		expect(store.getRequireLoginSource()).toBe("env");
	});
});

describe("setRequireLogin", () => {
	it("refuses to require sign-in with no Jellyfin server configured", () => {
		expect(() => store.setRequireLogin(true)).toThrow(/Connect Tide to a Jellyfin server/);
		expect(store.getRequireLogin()).toBe(false);
	});
});

describe("jellyfin url", () => {
	it("prefers the env var and strips trailing slashes", () => {
		process.env.TIDE_JELLYFIN_URL = "https://jellyfin.example.com//";
		expect(store.getJellyfinUrl()).toBe("https://jellyfin.example.com");
		expect(store.getJellyfinUrlSource()).toBe("env");
	});

	it("reports unset when nothing is configured", () => {
		expect(store.getJellyfinUrl()).toBeNull();
		expect(store.getJellyfinUrlSource()).toBe("unset");
		expect(store.isJellyfinConnected()).toBe(false);
	});
});
