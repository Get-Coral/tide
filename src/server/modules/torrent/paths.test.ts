import { describe, expect, it } from "vitest";
import { resolveDownloadPath } from "./paths";

const roots = { downloads: "/downloads/complete", incomplete: "/downloads/incomplete" };

describe("resolveDownloadPath", () => {
	it("falls back to the in-progress directory when no path is given", () => {
		expect(resolveDownloadPath(undefined, roots)).toBe(roots.incomplete);
		expect(resolveDownloadPath("", roots)).toBe(roots.incomplete);
		expect(resolveDownloadPath("   ", roots)).toBe(roots.incomplete);
	});

	it("accepts the roots themselves and paths beneath them", () => {
		expect(resolveDownloadPath("/downloads/complete", roots)).toBe("/downloads/complete");
		expect(resolveDownloadPath("/downloads/incomplete", roots)).toBe("/downloads/incomplete");
		expect(resolveDownloadPath("/downloads/complete/Show/S01", roots)).toBe(
			"/downloads/complete/Show/S01",
		);
	});

	it("rejects paths outside the downloads directories", () => {
		expect(() => resolveDownloadPath("/etc", roots)).toThrow(/inside Tide's downloads/);
		expect(() => resolveDownloadPath("/media/movies", roots)).toThrow();
		expect(() => resolveDownloadPath("/downloads", roots)).toThrow();
	});

	it("rejects traversal that escapes a root", () => {
		expect(() => resolveDownloadPath("/downloads/complete/../../etc", roots)).toThrow();
		expect(() => resolveDownloadPath("/downloads/complete/../../../root/.ssh", roots)).toThrow();
	});

	it("normalises traversal that stays inside a root", () => {
		expect(resolveDownloadPath("/downloads/complete/a/../b", roots)).toBe("/downloads/complete/b");
	});

	it("does not treat a sibling directory as contained", () => {
		expect(() => resolveDownloadPath("/downloads/complete-old", roots)).toThrow();
		expect(() => resolveDownloadPath("/downloads/incompleted", roots)).toThrow();
	});
});
