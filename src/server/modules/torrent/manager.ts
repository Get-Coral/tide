import { EventEmitter } from "node:events";
import type WebTorrent from "webtorrent";
import type { AddTorrentInput, TorrentSnapshot } from "./types";
import { downloadsPath, torrentClient } from "./client";

const updates = new EventEmitter();

function publishSnapshot() {
	updates.emit("update", listTorrents());
}

function wireTorrent(torrent: WebTorrent.Torrent) {
	const wired = torrent as WebTorrent.Torrent & { __coralWired?: boolean };
	if (wired.__coralWired) {
		return;
	}

	wired.__coralWired = true;
	torrent.on("ready", publishSnapshot);
	torrent.on("done", publishSnapshot);
	torrent.on("download", publishSnapshot);
	torrent.on("upload", publishSnapshot);
	torrent.on("wire", publishSnapshot);
	torrent.on("noPeers", publishSnapshot);
}

torrentClient.on("torrent", (torrent: WebTorrent.Torrent) => {
	wireTorrent(torrent);
	publishSnapshot();
});

for (const torrent of torrentClient.torrents) {
	wireTorrent(torrent);
}

function isHexHash(value: string) {
	return /^[a-fA-F0-9]{40}$/.test(value);
}

function normalizeId(value: string) {
	return value.trim().toLowerCase();
}

function toFileSnapshot(torrent: WebTorrent.Torrent) {
	return torrent.files.map((file: WebTorrent.TorrentFile, index: number) => ({
		index,
		name: file.name,
		length: file.length,
		downloaded: file.downloaded,
		progress: file.length > 0 ? file.downloaded / file.length : 0,
	}));
}

export function toTorrentSnapshot(torrent: WebTorrent.Torrent): TorrentSnapshot {
	return {
		id: torrent.infoHash,
		name: torrent.name || torrent.infoHash,
		magnetURI: torrent.magnetURI,
		progress: torrent.progress,
		downloadSpeed: torrent.downloadSpeed,
		uploadSpeed: torrent.uploadSpeed,
		numPeers: torrent.numPeers,
		downloaded: torrent.downloaded,
		length: torrent.length,
		done: torrent.done,
		createdAt: torrent.created?.toISOString?.() ?? new Date().toISOString(),
		files: toFileSnapshot(torrent),
	};
}

export function listTorrents() {
	return torrentClient.torrents.map(toTorrentSnapshot);
}

export function subscribeToTorrentUpdates(listener: (items: TorrentSnapshot[]) => void) {
	updates.on("update", listener);
	return () => {
		updates.off("update", listener);
	};
}

export function getTorrentById(id: string) {
	const normalized = normalizeId(id);
	return torrentClient.torrents.find(
		(torrent: WebTorrent.Torrent) => torrent.infoHash.toLowerCase() === normalized,
	);
}

export async function addTorrent(input: AddTorrentInput) {
	const magnet = input.magnet.trim();
	if (!magnet) {
		throw new Error("Magnet link is required.");
	}

	if (isHexHash(magnet)) {
		const existing = getTorrentById(magnet);
		if (existing) {
			return toTorrentSnapshot(existing);
		}
	}

	const torrent = await new Promise<WebTorrent.Torrent>((resolve, reject) => {
		const created = torrentClient.add(magnet, { path: input.path || downloadsPath });
		created.once("ready", () => resolve(created));
		created.once("error", reject);
	});

	wireTorrent(torrent);
	publishSnapshot();

	return toTorrentSnapshot(torrent);
}

export async function removeTorrent(id: string) {
	const torrent = getTorrentById(id);
	if (!torrent) {
		return false;
	}

	await torrentClient.remove(torrent.infoHash, { destroyStore: false });
	publishSnapshot();

	return true;
}
