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

export const torrentClient = existing ?? new WebTorrent();

if (!existing) {
	globalThis.__coralTorrentClient = torrentClient;
}

export const downloadsPath = getDownloadsPath();
export const incompletePath = (() => {
	const dir = path.join(path.dirname(downloadsPath), "incomplete");
	fs.mkdirSync(dir, { recursive: true });
	return dir;
})();
