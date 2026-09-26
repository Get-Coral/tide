import { describe, expect, it } from "vitest";
import {
	buildClearedSessionCookie,
	buildSessionCookie,
	getSessionTokenFromCookieHeader,
	isSecureRequest,
	SESSION_COOKIE_NAME,
} from "./session-cookie";

describe("getSessionTokenFromCookieHeader", () => {
	it("finds the session cookie among others", () => {
		const header = `theme=dark; ${SESSION_COOKIE_NAME}=abc123; other=1`;
		expect(getSessionTokenFromCookieHeader(header)).toBe("abc123");
	});

	it("decodes percent-encoded values", () => {
		expect(getSessionTokenFromCookieHeader(`${SESSION_COOKIE_NAME}=a%2Bb`)).toBe("a+b");
	});

	it("returns null for a missing, empty, or absent header", () => {
		expect(getSessionTokenFromCookieHeader("theme=dark")).toBeNull();
		expect(getSessionTokenFromCookieHeader(`${SESSION_COOKIE_NAME}=`)).toBeNull();
		expect(getSessionTokenFromCookieHeader(null)).toBeNull();
	});
});

describe("session cookie serialisation", () => {
	it("marks the cookie Secure only when asked", () => {
		expect(buildSessionCookie("token", { secure: true })).toContain("Secure");
		expect(buildSessionCookie("token", { secure: false })).not.toContain("Secure");
	});

	it("always sets HttpOnly, Path and SameSite", () => {
		const cookie = buildSessionCookie("token", { secure: false });
		expect(cookie).toContain("HttpOnly");
		expect(cookie).toContain("Path=/");
		expect(cookie).toContain("SameSite=Lax");
	});

	it("expires the cookie when cleared", () => {
		expect(buildClearedSessionCookie({ secure: false })).toContain("Max-Age=0");
	});

	it("round-trips through the parser", () => {
		const cookie = buildSessionCookie("a+b", { secure: false });
		const [pair] = cookie.split(";");
		expect(getSessionTokenFromCookieHeader(pair)).toBe("a+b");
	});
});

describe("isSecureRequest", () => {
	it("trusts x-forwarded-proto ahead of the request scheme", () => {
		const request = new Request("http://tide.local/api", {
			headers: { "x-forwarded-proto": "https, http" },
		});
		expect(isSecureRequest(request)).toBe(true);
	});

	it("falls back to the request scheme", () => {
		expect(isSecureRequest(new Request("https://tide.local/api"))).toBe(true);
		expect(isSecureRequest(new Request("http://tide.local/api"))).toBe(false);
	});
});
