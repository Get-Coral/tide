export interface TorrentFileSnapshot {
	index: number;
	name: string;
	length: number;
	downloaded: number;
	progress: number;
	selected: boolean;
	priority: number;
	firstPiece: number;
	lastPiece: number;
}

export type TorrentState = "downloading" | "seeding" | "paused" | "queued" | "errored" | "idle";

export interface TorrentTrackerSnapshot {
	url: string;
	status: "active" | "idle" | "warning" | "no-peers";
	lastAnnounceAt: string | null;
	lastError: string | null;
}

export interface TorrentPeerSnapshot {
	id: string;
	address: string;
	client: string;
	progress: number | null;
	downloadSpeed: number | null;
	uploadSpeed: number | null;
	requestedPieces: number;
	choked: boolean;
	interested: boolean;
	type: string;
}

export interface TorrentPieceBucketSnapshot {
	index: number;
	startPiece: number;
	endPiece: number;
	completionRate: number;
	availabilityRate: number;
	selected: boolean;
}

export interface TorrentDetailSnapshot {
	pieceCount: number;
	pieceLength: number;
	completedPieces: number;
	selectedPieces: number;
	pieceMap: TorrentPieceBucketSnapshot[];
	peers: TorrentPeerSnapshot[];
	trackers: TorrentTrackerSnapshot[];
}

export interface TorrentControlState {
	paused: boolean;
	pausedByQueue: boolean;
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
	maxActiveDownloads: number | null;
	maxActiveSeeders: number | null;
}

export interface AppTorrentSettingsSummary {
	downloadsDirectory: string;
	downloadsEnvVar: string;
	databasePath: string;
	basicAuthEnabled: boolean;
	basicAuthUsername: string | null;
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
	details: TorrentDetailSnapshot;
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
			message = sanitizeErrorText(text, message);
		}
	} catch {
		// ignore parse failure and keep status message
	}
	return message;
}

function sanitizeErrorText(text: string, fallback: string) {
	const trimmed = text.trim();
	if (!trimmed) {
		return fallback;
	}

	const isHtmlDocument =
		trimmed.startsWith("<!DOCTYPE") ||
		trimmed.startsWith("<html") ||
		trimmed.includes("<body") ||
		trimmed.includes("</html>");
	if (isHtmlDocument) {
		return `${fallback}. Server returned an unexpected HTML page.`;
	}

	return trimmed.length > 240 ? `${trimmed.slice(0, 237)}...` : trimmed;
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

export async function getAppTorrentSettingsSummary() {
	const response = await fetch("/api/torrents/control", { method: "GET" });
	if (!response.ok) {
		throw new Error(await parseError(response));
	}
	return (await response.json()) as { app: AppTorrentSettingsSummary };
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
