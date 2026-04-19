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
	pausedByMemory: boolean;
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
	details: TorrentDetailSnapshot;
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
	memoryGuardEnabled: boolean;
	memoryGuardSource: "env" | "cgroup" | "disabled";
	memoryGuardLimitMb: number | null;
	memoryGuardPauseMb: number | null;
	memoryGuardResumeMb: number | null;
	memoryGuardCheckIntervalMs: number;
	memoryGuardActive: boolean;
	memoryGuardCurrentRssMb: number | null;
	memoryGuardLastTriggeredAt: string | null;
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
