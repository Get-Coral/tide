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

export interface GlobalTorrentSettings {
	downloadLimitBps: number | null;
	uploadLimitBps: number | null;
}

export interface AddTorrentInput {
	magnet: string;
	path?: string;
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
