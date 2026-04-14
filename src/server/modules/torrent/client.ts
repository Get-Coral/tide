import fs from "node:fs";
import path from "node:path";
import WebTorrent from "webtorrent";

function getDownloadsPath() {
	const configuredPath =
		process.env.TIDE_DOWNLOADS_DIR?.trim() || process.env.TORRENT_DOWNLOADS_DIR?.trim();
	const resolved = configuredPath
		? path.resolve(configuredPath)
		: path.resolve(process.cwd(), "data", "downloads");
	fs.mkdirSync(resolved, { recursive: true });
	return resolved;
}

declare global {
	// eslint-disable-next-line no-var
	var __coralTorrentClient: WebTorrent.Instance | undefined;
}

const existing = globalThis.__coralTorrentClient;

console.log(`[tide:client] ${existing ? "Reusing existing" : "Creating new"} WebTorrent instance`);
export const torrentClient = existing ?? new WebTorrent();

if (!existing) {
	globalThis.__coralTorrentClient = torrentClient;
	console.log("[tide:client] WebTorrent instance created");
}

export const downloadsPath = getDownloadsPath();
