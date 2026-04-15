import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import type WebTorrent from "webtorrent";
import { downloadsPath, incompletePath, torrentClient } from "./client";
import {
	deletePersistedTorrent,
	deletePersistedTorrentControl,
	getDatabaseLocation,
	loadPersistedGlobalSettings,
	loadPersistedTorrentControls,
	loadPersistedTorrents,
	savePersistedGlobalSettings,
	savePersistedTorrent,
	savePersistedTorrentControl,
} from "./store";
import type {
	AddTorrentInput,
	GlobalTorrentSettings,
	TorrentControlInput,
	TorrentControlState,
	TorrentDetailSnapshot,
	TorrentFileSnapshot,
	TorrentPeerSnapshot,
	TorrentPieceBucketSnapshot,
	TorrentSnapshot,
	TorrentTrackerSnapshot,
} from "./types";

const updates = new EventEmitter();
const restoredMagnets = new Set<string>();
const limiterPaused = new Set<string>();
const controls = new Map<string, TorrentControlState>();
const trackerRuntime = new Map<
	string,
	{
		status: TorrentTrackerSnapshot["status"];
		lastAnnounceAt: string | null;
		lastError: string | null;
	}
>();

let persistedGlobal = toSafeGlobalSettings(loadPersistedGlobalSettings());
let persistTimer: ReturnType<typeof setTimeout> | null = null;

interface InternalSelection {
	from: number;
	to: number;
	priority?: number;
	notify?: () => void;
	isStreamSelection?: boolean;
}

interface InternalSelections {
	_items: InternalSelection[];
	clear(): void;
	insert(item: InternalSelection): void;
}

interface InternalFile extends WebTorrent.TorrentFile {
	_startPiece?: number;
	_endPiece?: number;
	select(priority?: number): void;
}

interface InternalWire {
	peerId?: string | Uint8Array;
	remoteAddress?: string;
	remotePort?: number;
	type?: string;
	destroyed?: boolean;
	peerChoking?: boolean;
	amInterested?: boolean;
	downloadSpeed?: () => number;
	uploadSpeed?: () => number;
	requests?: unknown[];
	destroy(): void;
}

interface InternalTorrent extends WebTorrent.Torrent {
	_selections?: InternalSelections;
	_updateSelections?: () => void;
	_critical?: boolean[];
	_rarityMap?: { _pieces?: number[] };
	bitfield?: { get(index: number): boolean };
	discovery?: { tracker?: { start?: () => void; update?: () => void } };
	wires: InternalWire[];
	files: InternalFile[];
	critical(start: number, end: number): void;
	deselect(start: number, end: number): void;
}

function isHexHash(value: string) {
	return /^[a-fA-F0-9]{40}$/.test(value);
}

function normalizeId(value: string) {
	return value.trim().toLowerCase();
}

function toPersistedInfoHash(value: unknown) {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function clampMaybeNumber(value: number | null | undefined) {
	if (value == null) return null;
	if (!Number.isFinite(value) || value < 0) return null;
	return value;
}

function clampMaybeInteger(value: number | null | undefined) {
	if (value == null) return null;
	if (!Number.isFinite(value) || value < 0) return null;
	return Math.floor(value);
}

function sanitizePriority(value: number | undefined) {
	if (value === undefined || !Number.isFinite(value)) return 0;
	return Math.max(0, Math.min(10, Math.floor(value)));
}

function toSafeGlobalSettings(value: Partial<GlobalTorrentSettings> | null | undefined) {
	return {
		downloadLimitBps: clampMaybeNumber(value?.downloadLimitBps),
		uploadLimitBps: clampMaybeNumber(value?.uploadLimitBps),
		maxActiveDownloads: clampMaybeInteger(value?.maxActiveDownloads),
		maxActiveSeeders: clampMaybeInteger(value?.maxActiveSeeders),
	};
}

function defaultControlState(queueOrder: number): TorrentControlState {
	return {
		paused: false,
		pausedByQueue: false,
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
		seedTimeGoalMinutes: clampMaybeInteger(value.seedTimeGoalMinutes),
		trackerUrls: Array.isArray(value.trackerUrls)
			? value.trackerUrls.filter((url) => typeof url === "string" && url.length > 0)
			: [],
		selectedFiles:
			typeof value.selectedFiles === "object" && value.selectedFiles ? value.selectedFiles : {},
		pausedByQueue: false,
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

function persistState() {
	savePersistedGlobalSettings(persistedGlobal);
	for (const [infoHash, control] of controls.entries()) {
		const persistedInfoHash = toPersistedInfoHash(infoHash);
		if (!persistedInfoHash) {
			continue;
		}
		savePersistedTorrentControl(persistedInfoHash, {
			...control,
			pausedByQueue: false,
			lastError: null,
		});
	}
	for (const torrent of torrentClient.torrents) {
		savePersistedTorrent(torrent.infoHash, torrent.magnetURI, torrent.path ?? null);
	}
}

function schedulePersist() {
	if (persistTimer) {
		clearTimeout(persistTimer);
	}
	persistTimer = setTimeout(() => {
		persistTimer = null;
		persistState();
	}, 150);
}

function restorePersistedControls() {
	let queueOrder = 0;
	for (const [id, value] of loadPersistedTorrentControls().entries()) {
		const safe = toSafeControlState(value ?? {}, queueOrder);
		controls.set(id, safe);
		queueOrder = Math.max(queueOrder + 1, safe.queueOrder + 1);
	}
}

function restorePersistedTorrents() {
	for (const item of loadPersistedTorrents()) {
		if (!item.magnet_uri || restoredMagnets.has(item.magnet_uri)) {
			continue;
		}
		restoredMagnets.add(item.magnet_uri);
		const existing = torrentClient.torrents.find(
			(torrent) => torrent.magnetURI === item.magnet_uri,
		);
		if (existing) {
			continue;
		}
		torrentClient.add(item.magnet_uri, { path: item.download_path || incompletePath });
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

function getSelectedRanges(torrent: InternalTorrent, control: TorrentControlState) {
	const ranges: Array<{ start: number; end: number; priority: number }> = [];
	for (const [index, file] of torrent.files.entries()) {
		const entry = control.selectedFiles[index];
		const selected = entry?.selected !== false;
		const start = file._startPiece ?? 0;
		const end = file._endPiece ?? start;
		if (!selected || end < start) {
			continue;
		}
		ranges.push({
			start,
			end,
			priority: sanitizePriority(entry?.priority),
		});
	}

	if (ranges.length === 0 && torrent.files.length > 0) {
		return [];
	}

	ranges.sort((left, right) => left.start - right.start || right.priority - left.priority);
	const merged: Array<{ start: number; end: number; priority: number }> = [];

	for (const range of ranges) {
		const previous = merged.at(-1);
		if (previous && range.start <= previous.end + 1) {
			previous.end = Math.max(previous.end, range.end);
			previous.priority = Math.max(previous.priority, range.priority);
			continue;
		}
		merged.push({ ...range });
	}

	return merged;
}

function applyPieceSelections(torrent: WebTorrent.Torrent, control: TorrentControlState) {
	const internalTorrent = torrent as InternalTorrent;
	if (!internalTorrent.files.length || !internalTorrent._selections) {
		return;
	}
	const shouldSuspendSelections = control.paused || control.pausedByQueue || control.stoppedByRule;

	const preservedStreams = shouldSuspendSelections
		? []
		: internalTorrent._selections._items
				.filter((item) => item.isStreamSelection)
				.map((item) => ({ ...item }));

	internalTorrent._selections.clear();
	internalTorrent._critical = [];
	for (const streamSelection of preservedStreams) {
		internalTorrent._selections.insert(streamSelection);
	}

	if (shouldSuspendSelections) {
		internalTorrent._updateSelections?.();
		return;
	}

	for (const range of getSelectedRanges(internalTorrent, control)) {
		internalTorrent.select(range.start, range.end, range.priority);
		if (range.priority >= 8) {
			internalTorrent.critical(range.start, Math.min(range.end, range.start + 1));
		}
	}

	internalTorrent._updateSelections?.();
}

function disconnectActiveWires(torrent: WebTorrent.Torrent) {
	const internalTorrent = torrent as InternalTorrent;
	for (const wire of internalTorrent.wires) {
		if (wire.destroyed) {
			continue;
		}
		wire.destroy();
	}
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
	if (control.paused || control.pausedByQueue || control.stoppedByRule) {
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
			if (!latest || latest.paused || latest.pausedByQueue || latest.stoppedByRule) {
				limiterPaused.delete(torrent.infoHash);
				return;
			}
			limiterPaused.delete(torrent.infoHash);
			torrent.resume();
		}, 700);
	}
}

function applyPauseState(torrent: WebTorrent.Torrent, control: TorrentControlState) {
	const shouldPause = control.paused || control.pausedByQueue || control.stoppedByRule;
	if (shouldPause) {
		if (!torrent.paused) {
			torrent.pause();
		}
		disconnectActiveWires(torrent);
		return;
	}
	if (!shouldPause && torrent.paused && !limiterPaused.has(torrent.infoHash)) {
		torrent.resume();
		const tracker = (torrent as InternalTorrent).discovery?.tracker;
		tracker?.update?.();
		tracker?.start?.();
	}
}

function applyQueueState() {
	const ordered = [...torrentClient.torrents].sort((left, right) => {
		return getOrCreateControl(left).queueOrder - getOrCreateControl(right).queueOrder;
	});

	let activeDownloads = 0;
	let activeSeeders = 0;

	for (const torrent of ordered) {
		const control = getOrCreateControl(torrent);
		control.pausedByQueue = false;

		if (control.paused || control.stoppedByRule) {
			continue;
		}

		if (torrent.done) {
			if (
				persistedGlobal.maxActiveSeeders != null &&
				activeSeeders >= persistedGlobal.maxActiveSeeders
			) {
				control.pausedByQueue = true;
				continue;
			}
			activeSeeders += 1;
			continue;
		}

		if (
			persistedGlobal.maxActiveDownloads != null &&
			activeDownloads >= persistedGlobal.maxActiveDownloads
		) {
			control.pausedByQueue = true;
			continue;
		}
		activeDownloads += 1;
	}
}

function enforceControlState(torrent: WebTorrent.Torrent) {
	const control = getOrCreateControl(torrent);
	applyTrackerList(torrent, control);
	applyPieceSelections(torrent, control);
	applyRuleStops(torrent, control);
	applyPauseState(torrent, control);
	applySoftPerTorrentLimit(torrent, control);
}

function enforceAllTorrents() {
	applyQueueState();
	for (const torrent of torrentClient.torrents) {
		enforceControlState(torrent);
	}
}

function estimateAvailability(torrent: InternalTorrent) {
	const pieces = torrent._rarityMap?._pieces;
	if (!pieces || pieces.length === 0) {
		return torrent.numPeers > 0 ? 1 : 0;
	}
	let total = 0;
	for (const value of pieces) {
		total += value ?? 0;
	}
	return total / pieces.length;
}

function toFileSnapshot(torrent: InternalTorrent): TorrentFileSnapshot[] {
	const control = getOrCreateControl(torrent);
	return torrent.files.map((file, index) => ({
		index,
		name: file.name,
		length: file.length,
		downloaded: file.downloaded,
		progress: file.length > 0 ? file.downloaded / file.length : 0,
		selected: control.selectedFiles[index]?.selected !== false,
		priority: sanitizePriority(control.selectedFiles[index]?.priority),
		firstPiece: file._startPiece ?? 0,
		lastPiece: file._endPiece ?? 0,
	}));
}

function getSelectedPieceRangesFromFiles(files: TorrentFileSnapshot[]) {
	const ranges = files
		.filter((file) => file.selected)
		.map((file) => ({
			start: file.firstPiece,
			end: file.lastPiece,
		}))
		.sort((left, right) => left.start - right.start);

	const merged: Array<{ start: number; end: number }> = [];
	for (const range of ranges) {
		const previous = merged.at(-1);
		if (previous && range.start <= previous.end + 1) {
			previous.end = Math.max(previous.end, range.end);
			continue;
		}
		merged.push({ ...range });
	}
	return merged;
}

function isSelectedPiece(pieceIndex: number, ranges: Array<{ start: number; end: number }>) {
	return ranges.some((range) => pieceIndex >= range.start && pieceIndex <= range.end);
}

function toPieceMap(
	torrent: InternalTorrent,
	selectedRanges: Array<{ start: number; end: number }>,
): TorrentPieceBucketSnapshot[] {
	const pieceCount = torrent.pieces.length;
	if (pieceCount === 0 || !torrent.bitfield) {
		return [];
	}

	const buckets = getPieceMapBucketCount(pieceCount);
	const rarity = torrent._rarityMap?._pieces ?? [];
	const map: TorrentPieceBucketSnapshot[] = [];

	for (let bucketIndex = 0; bucketIndex < buckets; bucketIndex += 1) {
		const startPiece = Math.floor((bucketIndex * pieceCount) / buckets);
		const endPiece = Math.max(
			startPiece,
			Math.floor(((bucketIndex + 1) * pieceCount) / buckets) - 1,
		);
		let completed = 0;
		let selected = false;
		let availability = 0;
		let totalPieces = 0;
		for (let pieceIndex = startPiece; pieceIndex <= endPiece; pieceIndex += 1) {
			totalPieces += 1;
			if (torrent.bitfield.get(pieceIndex)) {
				completed += 1;
			}
			if (!selected && isSelectedPiece(pieceIndex, selectedRanges)) {
				selected = true;
			}
			availability += rarity[pieceIndex] ?? 0;
		}

		map.push({
			index: bucketIndex,
			startPiece,
			endPiece,
			completionRate: totalPieces > 0 ? completed / totalPieces : 0,
			availabilityRate: totalPieces > 0 ? availability / totalPieces : 0,
			selected,
		});
	}

	return map;
}

function getPieceMapBucketCount(pieceCount: number) {
	if (pieceCount <= 64) {
		return pieceCount;
	}

	return Math.min(pieceCount, Math.min(224, Math.max(56, Math.ceil(Math.sqrt(pieceCount) * 6))));
}

function toPeerSnapshots(torrent: InternalTorrent): TorrentPeerSnapshot[] {
	return torrent.wires.slice(0, 8).map(toPeerSnapshot);
}

function toPeerSnapshot(wire: InternalWire, index: number): TorrentPeerSnapshot {
	return {
		id: getPeerSnapshotId(wire, index),
		address: getPeerSnapshotAddress(wire),
		client: getPeerSnapshotClient(wire),
		progress: null,
		downloadSpeed: readPeerTransferRate(wire.downloadSpeed),
		uploadSpeed: readPeerTransferRate(wire.uploadSpeed),
		requestedPieces: Array.isArray(wire.requests) ? wire.requests.length : 0,
		choked: Boolean(wire.peerChoking),
		interested: Boolean(wire.amInterested),
		type: wire.type ?? "tcp",
	};
}

function getPeerSnapshotId(wire: InternalWire, index: number) {
	if (typeof wire.peerId === "string") {
		return wire.peerId;
	}
	if (ArrayBuffer.isView(wire.peerId)) {
		return Buffer.from(wire.peerId).toString("hex");
	}
	return `peer-${index + 1}`;
}

function getPeerSnapshotAddress(wire: InternalWire) {
	if (!wire.remoteAddress) {
		return "Unknown";
	}
	return `${wire.remoteAddress}${wire.remotePort ? `:${wire.remotePort}` : ""}`;
}

function getPeerSnapshotClient(wire: InternalWire) {
	return typeof wire.peerId === "string" ? wire.peerId.slice(0, 8) : "Peer";
}

function readPeerTransferRate(
	getRate: InternalWire["downloadSpeed"] | InternalWire["uploadSpeed"],
) {
	return typeof getRate === "function" ? getRate() : null;
}

function toTrackerSnapshots(torrent: WebTorrent.Torrent): TorrentTrackerSnapshot[] {
	const runtime = trackerRuntime.get(torrent.infoHash);
	const control = getOrCreateControl(torrent);
	return control.trackerUrls.map((url) => ({
		url,
		status: runtime?.status ?? (torrent.numPeers > 0 ? "active" : "idle"),
		lastAnnounceAt: runtime?.lastAnnounceAt ?? null,
		lastError: runtime?.lastError ?? null,
	}));
}

function toDetailSnapshot(
	torrent: InternalTorrent,
	files: TorrentFileSnapshot[],
): TorrentDetailSnapshot {
	const selectedRanges = getSelectedPieceRangesFromFiles(files);
	const pieceCount = torrent.pieces.length;
	let completedPieces = 0;
	if (torrent.bitfield) {
		for (let pieceIndex = 0; pieceIndex < pieceCount; pieceIndex += 1) {
			if (torrent.bitfield.get(pieceIndex)) {
				completedPieces += 1;
			}
		}
	}

	let selectedPieces = 0;
	for (const range of selectedRanges) {
		selectedPieces += range.end - range.start + 1;
	}

	return {
		pieceCount,
		pieceLength: torrent.pieceLength || 0,
		completedPieces,
		selectedPieces,
		pieceMap: toPieceMap(torrent, selectedRanges),
		peers: toPeerSnapshots(torrent),
		trackers: toTrackerSnapshots(torrent),
	};
}

export function toTorrentSnapshot(torrent: WebTorrent.Torrent): TorrentSnapshot {
	const control = getOrCreateControl(torrent);
	const internalTorrent = torrent as InternalTorrent;
	const files = toFileSnapshot(internalTorrent);
	const state = getTorrentSnapshotState(torrent, control);

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
		createdAt: getTorrentCreatedAt(torrent),
		state,
		etaSeconds: getTorrentEtaSeconds(torrent),
		ratio: Number.isFinite(torrent.ratio) ? torrent.ratio : 0,
		availability: estimateAvailability(internalTorrent),
		timeRemainingMs: torrent.timeRemaining,
		files,
		control,
		details: toDetailSnapshot(internalTorrent, files),
	};
}

function getTorrentSnapshotState(
	torrent: WebTorrent.Torrent,
	control: TorrentControlState,
): TorrentSnapshot["state"] {
	if (control.lastError) {
		return "errored";
	}
	if (control.paused || control.stoppedByRule) {
		return "paused";
	}
	if (control.pausedByQueue) {
		return "queued";
	}
	if (torrent.paused) {
		return "paused";
	}
	if (torrent.done) {
		return "seeding";
	}
	if (torrent.numPeers > 0) {
		return "downloading";
	}
	return "idle";
}

function getTorrentCreatedAt(torrent: WebTorrent.Torrent) {
	return torrent.created?.toISOString?.() ?? new Date().toISOString();
}

function getTorrentEtaSeconds(torrent: WebTorrent.Torrent) {
	return torrent.timeRemaining > 0 && Number.isFinite(torrent.timeRemaining)
		? Math.ceil(torrent.timeRemaining / 1000)
		: null;
}

export function listTorrents() {
	return torrentClient.torrents.map(toTorrentSnapshot);
}

let snapshotTimer: ReturnType<typeof setTimeout> | null = null;

function publishSnapshot() {
	if (snapshotTimer) return;
	snapshotTimer = setTimeout(() => {
		snapshotTimer = null;
		updates.emit("update", listTorrents());
	}, 500);
}

function markTrackerStatus(
	torrent: WebTorrent.Torrent,
	status: TorrentTrackerSnapshot["status"],
	lastError: string | null = null,
) {
	const current = trackerRuntime.get(torrent.infoHash) ?? {
		status: "idle" as const,
		lastAnnounceAt: null,
		lastError: null,
	};
	trackerRuntime.set(torrent.infoHash, {
		status,
		lastAnnounceAt: status === "active" ? new Date().toISOString() : current.lastAnnounceAt,
		lastError,
	});
}

function moveToComplete(torrent: WebTorrent.Torrent) {
	if (torrent.path === downloadsPath || !torrent.files.length) {
		return;
	}
	const firstFile = torrent.files[0] as InternalFile;
	// file.path is relative to torrent.path (e.g. "MovieName/ep1.mkv"), not absolute.
	// Take the first path segment to get the top-level dir/file to move.
	const topLevel = firstFile.path.split(path.sep)[0];
	const src = path.join(torrent.path, topLevel);
	const dst = path.join(downloadsPath, topLevel);

	fs.mkdirSync(downloadsPath, { recursive: true });

	let moved = false;
	try {
		fs.renameSync(src, dst);
		moved = true;
	} catch (err) {
		// Cross-device rename (e.g. Docker volumes on different filesystems) — fall back to copy + delete
		if ((err as NodeJS.ErrnoException).code === "EXDEV") {
			try {
				fs.cpSync(src, dst, { recursive: true });
				fs.rmSync(src, { recursive: true, force: true });
				moved = true;
			} catch {
				// Copy+delete also failed — files remain in incomplete folder
			}
		}
	}

	if (moved) {
		(torrent as WebTorrent.Torrent & { path: string }).path = downloadsPath;
		savePersistedTorrent(torrent.infoHash, torrent.magnetURI, downloadsPath);
	}
}

function wireTorrent(torrent: WebTorrent.Torrent) {
	const wired = torrent as WebTorrent.Torrent & { __coralWired?: boolean };
	const eventfulTorrent = torrent as WebTorrent.Torrent & {
		on(event: string, listener: (...args: unknown[]) => void): WebTorrent.Torrent;
	};
	if (wired.__coralWired) {
		return;
	}

	wired.__coralWired = true;
	torrent.on("ready", () => {
		enforceAllTorrents();
		publishSnapshot();
	});
	torrent.on("done", () => {
		moveToComplete(torrent);
		publishSnapshot();
	});
	torrent.on("download", () => {
		const control = getOrCreateControl(torrent);
		if (control.lastError) {
			control.lastError = null;
		}
		publishSnapshot();
	});
	torrent.on("upload", publishSnapshot);
	torrent.on("wire", publishSnapshot);
	eventfulTorrent.on("trackerAnnounce", () => {
		markTrackerStatus(torrent, "active");
		publishSnapshot();
	});
	torrent.on("noPeers", (announceType) => {
		if (announceType === "tracker") {
			markTrackerStatus(torrent, "no-peers");
		}
		publishSnapshot();
	});
	torrent.on("warning", (warning) => {
		const message =
			warning instanceof Error ? warning.message : typeof warning === "string" ? warning : null;
		const control = getOrCreateControl(torrent);
		control.lastError = message;
		markTrackerStatus(torrent, "warning", message);
		schedulePersist();
		publishSnapshot();
	});
	torrent.on("error", (error) => {
		const message =
			error instanceof Error ? error.message : typeof error === "string" ? error : null;
		const control = getOrCreateControl(torrent);
		control.lastError = message;
		markTrackerStatus(torrent, "warning", message);
		schedulePersist();
		publishSnapshot();
	});

	enforceAllTorrents();
}

restorePersistedControls();

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

restorePersistedTorrents();

torrentClient.on("torrent", (torrent: WebTorrent.Torrent) => {
	wireTorrent(torrent);
	restoredMagnets.add(torrent.magnetURI);
	savePersistedTorrent(torrent.infoHash, torrent.magnetURI, torrent.path ?? null);
	schedulePersist();
	publishSnapshot();
});

for (const torrent of torrentClient.torrents) {
	wireTorrent(torrent);
}

setInterval(() => {
	enforceAllTorrents();
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

export function getAppSettingsSummary() {
	const authUsername = process.env.TIDE_AUTH_USERNAME?.trim() ?? "";
	const authPassword = process.env.TIDE_AUTH_PASSWORD?.trim() ?? "";
	return {
		downloadsDirectory: downloadsPath,
		downloadsEnvVar: process.env.TIDE_DOWNLOADS_DIR?.trim()
			? "TIDE_DOWNLOADS_DIR"
			: process.env.TORRENT_DOWNLOADS_DIR?.trim()
				? "TORRENT_DOWNLOADS_DIR"
				: "TIDE_DOWNLOADS_DIR",
		databasePath: getDatabaseLocation(),
		basicAuthEnabled: Boolean(authUsername && authPassword),
		basicAuthUsername: authUsername || null,
	};
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
		maxActiveDownloads:
			input.maxActiveDownloads === undefined
				? persistedGlobal.maxActiveDownloads
				: clampMaybeInteger(input.maxActiveDownloads),
		maxActiveSeeders:
			input.maxActiveSeeders === undefined
				? persistedGlobal.maxActiveSeeders
				: clampMaybeInteger(input.maxActiveSeeders),
	};

	torrentClient.throttleDownload(persistedGlobal.downloadLimitBps ?? -1);
	torrentClient.throttleUpload(persistedGlobal.uploadLimitBps ?? -1);
	enforceAllTorrents();
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
	applyTorrentAction(torrent, control, input.action);
	applyTorrentLimitUpdates(control, input);
	applyTorrentGoalUpdates(control, input);
	applyTorrentPreferenceUpdates(control, input);
	applyTorrentTrackerUpdates(control, input);
	applyTorrentFileUpdates(control, input);
	control.lastError = null;
	enforceAllTorrents();
	schedulePersist();
	publishSnapshot();
	return toTorrentSnapshot(torrent);
}

function applyTorrentAction(
	torrent: WebTorrent.Torrent,
	control: TorrentControlState,
	action: TorrentControlInput["action"],
) {
	if (action === "pause") {
		control.paused = true;
		control.stoppedByRule = false;
		torrent.pause();
		return;
	}

	if (action === "resume") {
		control.paused = false;
		control.stoppedByRule = false;
		limiterPaused.delete(torrent.infoHash);
		torrent.resume();
		return;
	}

	if (action === "reannounce") {
		const tracker = (torrent as InternalTorrent).discovery?.tracker;
		tracker?.update?.();
		tracker?.start?.();
	}
}

function applyTorrentLimitUpdates(control: TorrentControlState, input: TorrentControlInput) {
	if (input.downloadLimitBps !== undefined) {
		control.downloadLimitBps = clampMaybeNumber(input.downloadLimitBps);
	}

	if (input.uploadLimitBps !== undefined) {
		control.uploadLimitBps = clampMaybeNumber(input.uploadLimitBps);
	}
}

function applyTorrentGoalUpdates(control: TorrentControlState, input: TorrentControlInput) {
	if (input.ratioGoal !== undefined) {
		control.ratioGoal = clampMaybeNumber(input.ratioGoal);
	}

	if (input.seedTimeGoalMinutes !== undefined) {
		control.seedTimeGoalMinutes = clampMaybeInteger(input.seedTimeGoalMinutes);
	}
}

function applyTorrentPreferenceUpdates(control: TorrentControlState, input: TorrentControlInput) {
	if (input.stopOnRatio !== undefined) {
		control.stopOnRatio = Boolean(input.stopOnRatio);
	}

	if (input.stopOnSeedTime !== undefined) {
		control.stopOnSeedTime = Boolean(input.stopOnSeedTime);
	}

	if (input.queueOrder !== undefined && Number.isFinite(input.queueOrder)) {
		control.queueOrder = Math.max(0, Math.floor(input.queueOrder));
	}
}

function applyTorrentTrackerUpdates(control: TorrentControlState, input: TorrentControlInput) {
	const trackerToAdd = normalizeTrackerUrl(input.addTrackerUrl);
	if (trackerToAdd) {
		control.trackerUrls = Array.from(new Set([...control.trackerUrls, trackerToAdd]));
	}

	const trackerToRemove = normalizeTrackerUrl(input.removeTrackerUrl);
	if (trackerToRemove) {
		control.trackerUrls = control.trackerUrls.filter((url) => url !== trackerToRemove);
	}
}

function normalizeTrackerUrl(value: string | undefined) {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed || null;
}

function applyTorrentFileUpdates(control: TorrentControlState, input: TorrentControlInput) {
	if (!Array.isArray(input.fileUpdates)) {
		return;
	}

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

export function addTorrent(input: AddTorrentInput) {
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

	// torrentClient.add() is synchronous — the torrent (with infoHash from the magnet URI)
	// is available immediately. We don't wait for "ready" so the UI unblocks at once.
	// Metadata, name, and files arrive later and are pushed via SSE.
	const torrent = torrentClient.add(magnet, { path: input.path || incompletePath });
	restoredMagnets.add(torrent.magnetURI);
	wireTorrent(torrent);
	savePersistedTorrent(torrent.infoHash, torrent.magnetURI, torrent.path ?? null);
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
	trackerRuntime.delete(torrent.infoHash);
	limiterPaused.delete(torrent.infoHash);
	deletePersistedTorrent(torrent.infoHash);
	deletePersistedTorrentControl(torrent.infoHash);
	schedulePersist();
	publishSnapshot();
	return true;
}
