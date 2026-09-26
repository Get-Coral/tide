// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dataDir: string;
let tokens: typeof import("./service-tokens");
let guard: typeof import("#/server/service-auth");

beforeEach(async () => {
	dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tide-tokens-"));
	process.env.TIDE_DATA_DIR = dataDir;
	delete process.env.CORAL_SERVICE_TOKEN;
	vi.resetModules();
	tokens = await import("./service-tokens");
	guard = await import("#/server/service-auth");
});

afterEach(() => {
	delete process.env.TIDE_DATA_DIR;
	delete process.env.CORAL_SERVICE_TOKEN;
	fs.rmSync(dataDir, { recursive: true, force: true });
});

function request(token?: string) {
	const headers = new Headers();
	if (token) headers.set("authorization", `Bearer ${token}`);
	return new Request("http://tide.test/api/coral/downloads", { headers });
}

describe("service tokens", () => {
	it("names the module that issued them", () => {
		const { token } = tokens.mintServiceToken({ label: "Librarian", scopes: ["read"] });

		expect(token).toMatch(/^coral_tide_[0-9a-f]{48}$/);
	});

	it("keeps only a hash, and never exposes even that", () => {
		const { token } = tokens.mintServiceToken({ label: "Librarian", scopes: ["read"] });

		expect(JSON.stringify(tokens.listServiceTokens())).not.toContain(token);
		expect(tokens.listServiceTokens()[0]).not.toHaveProperty("hash");
	});

	it("recognises what it minted and refuses what it did not", () => {
		const { token } = tokens.mintServiceToken({ label: "Librarian", scopes: ["read"] });

		expect(tokens.verifyServiceToken(token)).not.toBeNull();
		expect(tokens.verifyServiceToken("coral_tide_nope")).toBeNull();
		expect(tokens.verifyServiceToken(null)).toBeNull();
	});

	it("forgets a revoked token", () => {
		const { token, record } = tokens.mintServiceToken({ label: "Librarian", scopes: ["full"] });
		tokens.revokeServiceToken(record.id);

		expect(tokens.verifyServiceToken(token)).toBeNull();
	});

	it("accepts the compose-only escape hatch with full scope", () => {
		process.env.CORAL_SERVICE_TOKEN = "compose-secret";

		expect(tokens.verifyServiceToken("compose-secret")).toMatchObject({
			id: "environment",
			scopes: ["full"],
		});
		expect(tokens.listServiceTokens()).toEqual([]);
	});
});

describe("requireServiceAuth", () => {
	it("refuses a request with no token, whatever the login setting says", async () => {
		// The permissive "sign-in is off, allow everything" path that the
		// browser guards take must not reach this one.
		const result = await guard.requireServiceAuth(request());

		expect(result.denied?.status).toBe(401);
	});

	it("separates reading from acting", async () => {
		const { token } = tokens.mintServiceToken({ label: "Librarian", scopes: ["read"] });

		expect((await guard.requireServiceAuth(request(token), "read")).denied).toBeNull();
		expect((await guard.requireServiceAuth(request(token), "full")).denied?.status).toBe(403);
	});

	it("lets a full token do both", async () => {
		const { token } = tokens.mintServiceToken({ label: "Librarian", scopes: ["full"] });

		expect((await guard.requireServiceAuth(request(token), "read")).denied).toBeNull();
		expect((await guard.requireServiceAuth(request(token), "full")).denied).toBeNull();
	});

	it("hands back a token that names no user", async () => {
		const { token } = tokens.mintServiceToken({ label: "Librarian", scopes: ["full"] });

		const result = await guard.requireServiceAuth(request(token));

		expect(result.token).not.toHaveProperty("userId");
		expect(result.token).not.toHaveProperty("username");
	});
});
