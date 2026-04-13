import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import type WebTorrent from "webtorrent";
import { downloadsPath, torrentClient } from "./client";
import type {
	AddTorrentInput,
	GlobalTorrentSettings,
	TorrentControlInput,
	TorrentControlState,
	TorrentSnapshot,
} from "./types";

const updates = new EventEmitter();
const SESSION_PATH = path.resolve(process.cwd(), "data", "torrent-session.json");

interface PersistedTorrentEntry {
	id: string;
	magnetURI: string;
	path?: string;
}

interface PersistedSession {
	version: 1;
	global: GlobalTorrentSettings;
	controls: Record<string, TorrentControlState>;
	torrents: PersistedTorrentEntry[];
}

const controls = new Map<string, TorrentControlState>();
const restoredMagnets = new Set<string>();
const limiterPaused = new Set<string>();

let persistedGlobal: GlobalTorrentSettings = {
	downloadLimitBps: null,
	uploadLimitBps: null,
};

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function isHexHash(value: string) {
	return /^[a-fA-F0-9]{40}$/.test(value);
}

function normalizeId(value: string) {
	return value.trim().toLowerCase();
}

function clampMaybeNumber(value: number | null | undefined) {
	if (value == null) return null;
	if (!Number.isFinite(value) || value < 0) return null;
	return value;
}

function sanitizePriority(value: number | undefined) {
	if (value === undefined || !Number.isFinite(value)) return 0;
	return Math.max(0, Math.min(10, Math.floor(value)));
}

function defaultControlState(queueOrder: number): TorrentControlState {
	return {
		paused: false,
		queueOrder,
		downloadLimitBps: null,
		uploadLimitBps: null,
		ratioGoal: null,
		seedTimeGoalMinutes: null,
		stopOnRatio: false,
		stopOnSeedTime: false,
		trackerUrls: [],
		addedAt: new Date().toISOString(),
		doneAt: null,
		selectedFiles: {},
		lastError: null,
		stoppedByRule: false,
	};
}

function toSafeControlState(
	value: Partial<TorrentControlState>,
	queueOrder: number,
): TorrentControlState {
	const fallback = defaultControlState(queueOrder);
	return {
		...fallback,
		...value,
		queueOrder: Number.isFinite(value.queueOrder) ? Number(value.queueOrder) : queueOrder,
		downloadLimitBps: clampMaybeNumber(value.downloadLimitBps),
		uploadLimitBps: clampMaybeNumber(value.uploadLimitBps),
		ratioGoal: clampMaybeNumber(value.ratioGoal),
		seedTimeGoalMinutes: clampMaybeNumber(value.seedTimeGoalMinutes),
		trackerUrls: Array.isArray(value.trackerUrls)
			? value.trackerUrls.filter((url) => typeof url === "string" && url.length > 0)
			: [],
		selectedFiles:
			typeof value.selectedFiles === "object" && value.selectedFiles ? value.selectedFiles : {},
	};
}

function getNextQueueOrder() {
	let max = -1;
	for (const control of controls.values()) {
		max = Math.max(max, control.queueOrder);
	}
	return max + 1;
}

function getOrCreateControl(torrent: WebTorrent.Torrent) {
	const existing = controls.get(torrent.infoHash);
	if (existing) {
		return existing;
	}

	const created = defaultControlState(getNextQueueOrder());
	created.trackerUrls = Array.from(new Set(torrent.announce ?? []));
	controls.set(torrent.infoHash, created);
	schedulePersist();
	return created;
}

function loadSession() {
	try {
		if (!fs.existsSync(SESSION_PATH)) {
			return;
		}
		const parsed = JSON.parse(fs.readFileSync(SESSION_PATH, "utf8")) as Partial<PersistedSession>;
		if (parsed.global) {
			persistedGlobal = {
				downloadLimitBps: clampMaybeNumber(parsed.global.downloadLimitBps),
				uploadLimitBps: clampMaybeNumber(parsed.global.uploadLimitBps),
			};
		}

		const savedControls = parsed.controls ?? {};
		let queueOrder = 0;
		for (const [id, value] of Object.entries(savedControls)) {
			const safe = toSafeControlState(value ?? {}, queueOrder);
			controls.set(id, safe);
			queueOrder = Math.max(queueOrder + 1, safe.queueOrder + 1);
		}

		const savedTorrents = Array.isArray(parsed.torrents) ? parsed.torrents : [];
		for (const item of savedTorrents) {
			if (!item?.magnetURI || restoredMagnets.has(item.magnetURI)) {
				continue;
			}
			restoredMagnets.add(item.magnetURI);
			const existing = torrentClient.torrents.find(
				(torrent) => torrent.magnetURI === item.magnetURI,
			);
			if (existing) {
				continue;
			}
			torrentClient.add(item.magnetURI, { path: item.path || downloadsPath });
		}
	} catch (error) {
		console.error("Failed to load torrent session:", error);
	}
}

function persistSession() {
	try {
		const session: PersistedSession = {
			version: 1,
			global: persistedGlobal,
			controls: Object.fromEntries(controls.entries()),
			torrents: torrentClient.torrents.map((torrent) => ({
				id: torrent.infoHash,
				magnetURI: torrent.magnetURI,
				path: torrent.path,
			})),
		};
		fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });
		fs.writeFileSync(SESSION_PATH, JSON.stringify(session, null, 2));
	} catch (error) {
		console.error("Failed to persist torrent session:", error);
	}
}

function schedulePersist() {
	if (persistTimer) {
		clearTimeout(persistTimer);
	}
	persistTimer = setTimeout(() => {
		persistTimer = null;
		persistSession();
	}, 150);
}

function applyFileSelections(torrent: WebTorrent.Torrent, control: TorrentControlState) {
	for (const [indexRaw, entry] of Object.entries(control.selectedFiles)) {
		const index = Number.parseInt(indexRaw, 10);
		const file = torrent.files[index];
		if (!file) {
			continue;
		}
		if (entry.selected === false) {
			file.deselect();
		} else {
			file.select();
		}
	}
}

function applyTrackerList(torrent: WebTorrent.Torrent, control: TorrentControlState) {
	if (!Array.isArray(torrent.announce)) {
		return;
	}
	const desired = Array.from(new Set(control.trackerUrls));
	torrent.announce.length = 0;
	torrent.announce.push(...desired);
}

function applyRuleStops(torrent: WebTorrent.Torrent, control: TorrentControlState) {
	if (torrent.done && !control.doneAt) {
		control.doneAt = new Date().toISOString();
	}

	if (!torrent.done) {
		control.doneAt = null;
		if (control.stoppedByRule) {
			control.stoppedByRule = false;
		}
		return;
	}

	let shouldStop = false;
	if (control.stopOnRatio && control.ratioGoal != null && torrent.ratio >= control.ratioGoal) {
		shouldStop = true;
	}

	if (control.stopOnSeedTime && control.seedTimeGoalMinutes != null && control.doneAt) {
		const elapsedMs = Date.now() - new Date(control.doneAt).getTime();
		if (elapsedMs >= control.seedTimeGoalMinutes * 60 * 1000) {
			shouldStop = true;
		}
	}

	if (shouldStop) {
		control.stoppedByRule = true;
		if (!torrent.paused) {
			torrent.pause();
		}
	}
}

function applySoftPerTorrentLimit(torrent: WebTorrent.Torrent, control: TorrentControlState) {
	if (control.paused || control.stoppedByRule) {
		limiterPaused.delete(torrent.infoHash);
		return;
	}

	const downLimit = control.downloadLimitBps;
	const upLimit = control.uploadLimitBps;
	const overDown = downLimit != null && downLimit > 0 && torrent.downloadSpeed > downLimit * 1.1;
	const overUp = upLimit != null && upLimit > 0 && torrent.uploadSpeed > upLimit * 1.1;

	if ((overDown || overUp) && !torrent.paused) {
		limiterPaused.add(torrent.infoHash);
		torrent.pause();
		setTimeout(() => {
			if (!limiterPaused.has(torrent.infoHash)) {
				return;
			}
			const latest = controls.get(torrent.infoHash);
			if (!latest || latest.paused || latest.stoppedByRule) {
				limiterPaused.delete(torrent.infoHash);
				return;
			}
			limiterPaused.delete(torrent.infoHash);
			torrent.resume();
		}, 700);
	}
}

function applyPauseState(torrent: WebTorrent.Torrent, control: TorrentControlState) {
	const shouldPause = control.paused || control.stoppedByRule;
	if (shouldPause && !torrent.paused) {
		torrent.pause();
	}
	if (!shouldPause && torrent.paused && !limiterPaused.has(torrent.infoHash)) {
		torrent.resume();
	}
}

function enforceControlState(torrent: WebTorrent.Torrent) {
	const control = getOrCreateControl(torrent);
	applyTrackerList(torrent, control);
	applyFileSelections(torrent, control);
	applyRuleStops(torrent, control);
	applyPauseState(torrent, control);
	applySoftPerTorrentLimit(torrent, control);
}

function estimateAvailability(torrent: WebTorrent.Torrent) {
	const map = (torrent as WebTorrent.Torrent & { _rarityMap?: { _pieces?: number[] } })._rarityMap;
	const pieces = map?._pieces;
	if (!pieces || pieces.length === 0) {
		return torrent.numPeers > 0 ? 1 : 0;
	}

	let total = 0;
	for (const value of pieces) {
		total += value ?? 0;
	}
	return total / pieces.length;
}

function toFileSnapshot(torrent: WebTorrent.Torrent) {
	const control = getOrCreateControl(torrent);
	return torrent.files.map((file: WebTorrent.TorrentFile, index: number) => ({
		index,
		name: file.name,
		length: file.length,
		downloaded: file.downloaded,
		progress: file.length > 0 ? file.downloaded / file.length : 0,
		selected: control.selectedFiles[index]?.selected !== false,
		priority: sanitizePriority(control.selectedFiles[index]?.priority),
	}));
}

export function toTorrentSnapshot(torrent: WebTorrent.Torrent): TorrentSnapshot {
	const control = getOrCreateControl(torrent);
	const isErrored = Boolean(control.lastError);
	const state: TorrentSnapshot["state"] = isErrored
		? "errored"
		: torrent.paused
			? "paused"
			: torrent.done
				? "seeding"
				: torrent.numPeers > 0
					? "downloading"
					: "idle";

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
		state,
		etaSeconds:
			torrent.timeRemaining > 0 && Number.isFinite(torrent.timeRemaining)
				? Math.ceil(torrent.timeRemaining / 1000)
				: null,
		ratio: Number.isFinite(torrent.ratio) ? torrent.ratio : 0,
		availability: estimateAvailability(torrent),
		timeRemainingMs: torrent.timeRemaining,
		files: toFileSnapshot(torrent),
		control,
	};
}

export function listTorrents() {
	return torrentClient.torrents.map(toTorrentSnapshot);
}

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
	torrent.on("warning", (warning) => {
		const control = getOrCreateControl(torrent);
		control.lastError =
			warning instanceof Error ? warning.message : typeof warning === "string" ? warning : null;
		schedulePersist();
		publishSnapshot();
	});
	torrent.on("error", (error) => {
		const control = getOrCreateControl(torrent);
		control.lastError =
			error instanceof Error ? error.message : typeof error === "string" ? error : null;
		schedulePersist();
		publishSnapshot();
	});
	enforceControlState(torrent);
}

loadSession();

if (persistedGlobal.downloadLimitBps != null) {
	torrentClient.throttleDownload(persistedGlobal.downloadLimitBps);
} else {
	torrentClient.throttleDownload(-1);
}

if (persistedGlobal.uploadLimitBps != null) {
	torrentClient.throttleUpload(persistedGlobal.uploadLimitBps);
} else {
	torrentClient.throttleUpload(-1);
}

torrentClient.on("torrent", (torrent: WebTorrent.Torrent) => {
	wireTorrent(torrent);
	enforceControlState(torrent);
	schedulePersist();
	publishSnapshot();
});

for (const torrent of torrentClient.torrents) {
	wireTorrent(torrent);
	enforceControlState(torrent);
}

setInterval(() => {
	for (const torrent of torrentClient.torrents) {
		enforceControlState(torrent);
	}
	publishSnapshot();
}, 1000).unref();

export function subscribeToTorrentUpdates(listener: (items: TorrentSnapshot[]) => void) {
	updates.on("update", listener);
	return () => {
		updates.off("update", listener);
	};
}

export function getGlobalSettings() {
	return { ...persistedGlobal };
}

export function updateGlobalSettings(input: Partial<GlobalTorrentSettings>) {
	persistedGlobal = {
		downloadLimitBps:
			input.downloadLimitBps === undefined
				? persistedGlobal.downloadLimitBps
				: clampMaybeNumber(input.downloadLimitBps),
		uploadLimitBps:
			input.uploadLimitBps === undefined
				? persistedGlobal.uploadLimitBps
				: clampMaybeNumber(input.uploadLimitBps),
	};

	torrentClient.throttleDownload(persistedGlobal.downloadLimitBps ?? -1);
	torrentClient.throttleUpload(persistedGlobal.uploadLimitBps ?? -1);
	schedulePersist();
	publishSnapshot();
	return getGlobalSettings();
}

export function getTorrentById(id: string) {
	const normalized = normalizeId(id);
	return torrentClient.torrents.find(
		(torrent: WebTorrent.Torrent) => torrent.infoHash.toLowerCase() === normalized,
	);
}

export async function updateTorrentControl(id: string, input: TorrentControlInput) {
	const torrent = getTorrentById(id);
	if (!torrent) {
		return null;
	}

	const control = getOrCreateControl(torrent);

	if (input.action === "pause") {
		control.paused = true;
		control.stoppedByRule = false;
		torrent.pause();
	}

	if (input.action === "resume") {
		control.paused = false;
		control.stoppedByRule = false;
		limiterPaused.delete(torrent.infoHash);
		torrent.resume();
	}

	if (input.action === "reannounce") {
		const tracker = (
			torrent as WebTorrent.Torrent & {
				discovery?: { tracker?: { start?: () => void; update?: () => void } };
			}
		).discovery?.tracker;
		tracker?.update?.();
		tracker?.start?.();
	}

	if (input.downloadLimitBps !== undefined) {
		control.downloadLimitBps = clampMaybeNumber(input.downloadLimitBps);
	}

	if (input.uploadLimitBps !== undefined) {
		control.uploadLimitBps = clampMaybeNumber(input.uploadLimitBps);
	}

	if (input.ratioGoal !== undefined) {
		control.ratioGoal = clampMaybeNumber(input.ratioGoal);
	}

	if (input.seedTimeGoalMinutes !== undefined) {
		control.seedTimeGoalMinutes = clampMaybeNumber(input.seedTimeGoalMinutes);
	}

	if (input.stopOnRatio !== undefined) {
		control.stopOnRatio = Boolean(input.stopOnRatio);
	}

	if (input.stopOnSeedTime !== undefined) {
		control.stopOnSeedTime = Boolean(input.stopOnSeedTime);
	}

	if (input.queueOrder !== undefined && Number.isFinite(input.queueOrder)) {
		control.queueOrder = Math.max(0, Math.floor(input.queueOrder));
	}

	if (typeof input.addTrackerUrl === "string" && input.addTrackerUrl.trim()) {
		control.trackerUrls = Array.from(new Set([...control.trackerUrls, input.addTrackerUrl.trim()]));
	}

	if (typeof input.removeTrackerUrl === "string" && input.removeTrackerUrl.trim()) {
		const remove = input.removeTrackerUrl.trim();
		control.trackerUrls = control.trackerUrls.filter((url) => url !== remove);
	}

	if (Array.isArray(input.fileUpdates)) {
		for (const update of input.fileUpdates) {
			if (!Number.isFinite(update.index) || update.index < 0) {
				continue;
			}
			const key = Math.floor(update.index);
			const previous = control.selectedFiles[key] ?? { selected: true, priority: 0 };
			control.selectedFiles[key] = {
				selected: update.selected ?? previous.selected,
				priority:
					update.priority === undefined ? previous.priority : sanitizePriority(update.priority),
			};
		}
	}

	control.lastError = null;
	enforceControlState(torrent);
	schedulePersist();
	publishSnapshot();
	return toTorrentSnapshot(torrent);
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

	restoredMagnets.add(torrent.magnetURI);
	wireTorrent(torrent);
	enforceControlState(torrent);
	schedulePersist();
	publishSnapshot();

	return toTorrentSnapshot(torrent);
}

export async function removeTorrent(id: string) {
	const torrent = getTorrentById(id);
	if (!torrent) {
		return false;
	}

	await torrentClient.remove(torrent.infoHash, { destroyStore: false });
	controls.delete(torrent.infoHash);
	limiterPaused.delete(torrent.infoHash);
	schedulePersist();
	publishSnapshot();

	return true;
}
