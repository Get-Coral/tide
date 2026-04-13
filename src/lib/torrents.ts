export interface TorrentFileSnapshot {
	index: number;
	name: string;
	length: number;
	downloaded: number;
	progress: number;
	selected: boolean;
	priority: number;
}

export type TorrentState = "downloading" | "seeding" | "paused" | "errored" | "idle";

export interface TorrentControlState {
	paused: boolean;
	queueOrder: number;
	downloadLimitBps: number | null;
	uploadLimitBps: number | null;
	ratioGoal: number | null;
	seedTimeGoalMinutes: number | null;
	stopOnRatio: boolean;
	stopOnSeedTime: boolean;
	trackerUrls: string[];
	addedAt: string;
	doneAt: string | null;
	selectedFiles: Record<number, { selected: boolean; priority: number }>;
	lastError: string | null;
	stoppedByRule: boolean;
}

export interface GlobalTorrentSettings {
	downloadLimitBps: number | null;
	uploadLimitBps: number | null;
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
	state: TorrentState;
	etaSeconds: number | null;
	ratio: number;
	availability: number;
	timeRemainingMs: number;
	files: TorrentFileSnapshot[];
	control: TorrentControlState;
}

interface ListResponse {
	items: TorrentSnapshot[];
	global: GlobalTorrentSettings;
}

export interface TorrentControlInput {
	action?: "pause" | "resume" | "reannounce";
	downloadLimitBps?: number | null;
	uploadLimitBps?: number | null;
	ratioGoal?: number | null;
	seedTimeGoalMinutes?: number | null;
	stopOnRatio?: boolean;
	stopOnSeedTime?: boolean;
	queueOrder?: number;
	addTrackerUrl?: string;
	removeTrackerUrl?: string;
	fileUpdates?: Array<{
		index: number;
		selected?: boolean;
		priority?: number;
	}>;
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
	return (await response.json()) as ListResponse;
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

export async function updateGlobalTorrentSettings(input: Partial<GlobalTorrentSettings>) {
	const response = await fetch("/api/torrents/control", {
		method: "POST",
		headers: {
			"content-type": "application/json",
		},
		body: JSON.stringify(input),
	});
	if (!response.ok) {
		throw new Error(await parseError(response));
	}
	const payload = (await response.json()) as { global: GlobalTorrentSettings };
	return payload.global;
}

export async function updateTorrentControl(id: string, input: TorrentControlInput) {
	const response = await fetch(`/api/torrents/${id}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
		},
		body: JSON.stringify(input),
	});
	if (!response.ok) {
		throw new Error(await parseError(response));
	}
	return (await response.json()) as TorrentSnapshot;
}
