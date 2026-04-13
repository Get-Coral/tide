export interface TorrentFileSnapshot {
	index: number;
	name: string;
	length: number;
	downloaded: number;
	progress: number;
}

export interface TorrentSnapshot {
	id: string;
	name: string;
	magnetURI: string;
	progress: number;
	downloadSpeed: number;
	uploadSpeed: number;
	numPeers: number;
	downloaded: number;
	length: number;
	done: boolean;
	createdAt: string;
	files: TorrentFileSnapshot[];
}

interface ListResponse {
	items: TorrentSnapshot[];
}

async function parseError(response: Response) {
	let message = `Request failed (${response.status})`;
	try {
		const text = await response.text();
		if (text) {
			message = text;
		}
	} catch {
		// ignore parse failure and keep status message
	}
	return message;
}

export async function listTorrents() {
	const response = await fetch("/api/torrents", { method: "GET" });
	if (!response.ok) {
		throw new Error(await parseError(response));
	}
	const data = (await response.json()) as ListResponse;
	return data.items;
}

export async function createTorrent(magnet: string) {
	const response = await fetch("/api/torrents", {
		method: "POST",
		headers: {
			"content-type": "application/json",
		},
		body: JSON.stringify({ magnet }),
	});
	if (!response.ok) {
		throw new Error(await parseError(response));
	}
	return (await response.json()) as TorrentSnapshot;
}

export async function deleteTorrent(id: string) {
	const response = await fetch(`/api/torrents/${id}`, { method: "DELETE" });
	if (!response.ok && response.status !== 404) {
		throw new Error(await parseError(response));
	}
}
