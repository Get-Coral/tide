import type { TorrentSnapshot } from "#/lib/torrents";

export type TorrentSortMode =
	| "activity"
	| "name"
	| "progress"
	| "speed"
	| "size"
	| "status"
	| "ratio";

export function formatBytes(bytes: number) {
	if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
	const units = ["B", "KB", "MB", "GB", "TB"];
	const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	const value = bytes / 1024 ** power;
	return `${value.toFixed(value >= 10 || power === 0 ? 0 : 1)} ${units[power]}`;
}

export function formatSpeed(bytesPerSecond: number) {
	return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatEta(seconds: number | null) {
	if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) {
		return "--";
	}
	const total = Math.floor(seconds);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	if (h > 0) return `${h}h ${m}m`;
	if (m > 0) return `${m}m ${s}s`;
	return `${s}s`;
}

export function toLimitInput(value: number | null | undefined) {
	if (value == null || value < 0) return "";
	return String(Math.round(value / 1024));
}

export function fromLimitInput(value: string) {
	const trimmed = value.trim();
	if (!trimmed) return null;
	const parsed = Number.parseFloat(trimmed);
	if (!Number.isFinite(parsed) || parsed < 0) return null;
	return Math.round(parsed * 1024);
}

export function compareTorrents(a: TorrentSnapshot, b: TorrentSnapshot, mode: TorrentSortMode) {
	if (mode === "name") {
		return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
	}
	if (mode === "progress") {
		return b.progress - a.progress;
	}
	if (mode === "speed") {
		return b.downloadSpeed - a.downloadSpeed;
	}
	if (mode === "size") {
		return b.length - a.length;
	}
	if (mode === "ratio") {
		return b.ratio - a.ratio;
	}
	if (mode === "status") {
		const order = ["downloading", "seeding", "queued", "paused", "idle", "errored"];
		return order.indexOf(a.state) - order.indexOf(b.state);
	}

	const aTime = new Date(a.createdAt).getTime();
	const bTime = new Date(b.createdAt).getTime();
	if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
		return bTime - aTime;
	}
	return a.control.queueOrder - b.control.queueOrder;
}
