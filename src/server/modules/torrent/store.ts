import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { GlobalTorrentSettings, TorrentControlState } from "./types";

const CREATE_SETTINGS_TABLE_SQL = [
	"CREATE TABLE IF NOT EXISTS app_settings (",
	"  key TEXT PRIMARY KEY,",
	"  value TEXT NOT NULL,",
	"  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
	");",
].join("\n");

const CREATE_TORRENTS_TABLE_SQL = [
	"CREATE TABLE IF NOT EXISTS torrents (",
	"  info_hash TEXT PRIMARY KEY,",
	"  magnet_uri TEXT NOT NULL,",
	"  download_path TEXT,",
	"  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
	");",
].join("\n");

const CREATE_CONTROLS_TABLE_SQL = [
	"CREATE TABLE IF NOT EXISTS torrent_controls (",
	"  info_hash TEXT PRIMARY KEY,",
	"  payload TEXT NOT NULL,",
	"  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
	");",
].join("\n");

const UPSERT_SETTING_SQL = [
	"INSERT INTO app_settings (key, value, updated_at)",
	"VALUES (?, ?, CURRENT_TIMESTAMP)",
	"ON CONFLICT(key) DO UPDATE SET",
	"  value = excluded.value,",
	"  updated_at = CURRENT_TIMESTAMP",
].join("\n");

const UPSERT_TORRENT_SQL = [
	"INSERT INTO torrents (info_hash, magnet_uri, download_path, created_at)",
	"VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
	"ON CONFLICT(info_hash) DO UPDATE SET",
	"  magnet_uri = excluded.magnet_uri,",
	"  download_path = excluded.download_path",
].join("\n");

const UPSERT_CONTROL_SQL = [
	"INSERT INTO torrent_controls (info_hash, payload, updated_at)",
	"VALUES (?, ?, CURRENT_TIMESTAMP)",
	"ON CONFLICT(info_hash) DO UPDATE SET",
	"  payload = excluded.payload,",
	"  updated_at = CURRENT_TIMESTAMP",
].join("\n");

function getDataDirectory() {
	return process.env.TIDE_DATA_DIR?.trim() || path.join(process.cwd(), "data");
}

function getDatabasePath() {
	return path.join(getDataDirectory(), "tide.sqlite");
}

let database: DatabaseSync | null = null;

function toDatabaseText(value: unknown) {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getDatabase() {
	if (database) return database;
	fs.mkdirSync(getDataDirectory(), { recursive: true });
	database = new DatabaseSync(getDatabasePath());
	database.exec(CREATE_SETTINGS_TABLE_SQL);
	database.exec(CREATE_TORRENTS_TABLE_SQL);
	database.exec(CREATE_CONTROLS_TABLE_SQL);
	return database;
}

function getSetting<T>(key: string, fallback: T): T {
	const row = getDatabase().prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as
		| { value?: string }
		| undefined;
	if (!row?.value) {
		return fallback;
	}
	try {
		return JSON.parse(row.value) as T;
	} catch {
		return fallback;
	}
}

function setSetting<T>(key: string, value: T) {
	getDatabase().prepare(UPSERT_SETTING_SQL).run(key, JSON.stringify(value));
}

export function loadPersistedGlobalSettings() {
	return getSetting<GlobalTorrentSettings>("torrent.global", {
		downloadLimitBps: null,
		uploadLimitBps: null,
		maxActiveDownloads: null,
		maxActiveSeeders: null,
	});
}

export function savePersistedGlobalSettings(settings: GlobalTorrentSettings) {
	setSetting("torrent.global", settings);
}

export function loadPersistedTorrentControls() {
	const rows = getDatabase()
		.prepare("SELECT info_hash, payload FROM torrent_controls ORDER BY updated_at ASC")
		.all() as Array<{ info_hash: string; payload: string }>;
	const controls = new Map<string, Partial<TorrentControlState>>();
	for (const row of rows) {
		const infoHash = toDatabaseText(row.info_hash);
		if (!infoHash) {
			continue;
		}
		try {
			controls.set(infoHash, JSON.parse(row.payload) as Partial<TorrentControlState>);
		} catch {
			// Ignore corrupted entries and let defaults take over.
		}
	}
	return controls;
}

export function savePersistedTorrentControl(infoHash: string, control: TorrentControlState) {
	const safeInfoHash = toDatabaseText(infoHash);
	if (!safeInfoHash) {
		return;
	}
	getDatabase().prepare(UPSERT_CONTROL_SQL).run(safeInfoHash, JSON.stringify(control));
}

export function deletePersistedTorrentControl(infoHash: string) {
	const safeInfoHash = toDatabaseText(infoHash);
	if (!safeInfoHash) {
		return;
	}
	getDatabase().prepare("DELETE FROM torrent_controls WHERE info_hash = ?").run(safeInfoHash);
}

export function loadPersistedTorrents() {
	return getDatabase()
		.prepare(
			"SELECT info_hash, magnet_uri, download_path FROM torrents ORDER BY datetime(created_at) ASC",
		)
		.all() as Array<{
		info_hash: string;
		magnet_uri: string;
		download_path: string | null;
	}>;
}

export function savePersistedTorrent(
	infoHash: string,
	magnetURI: string,
	downloadPath: string | null,
) {
	const safeInfoHash = toDatabaseText(infoHash);
	const safeMagnetUri = toDatabaseText(magnetURI);
	if (!safeInfoHash || !safeMagnetUri) {
		return;
	}
	getDatabase().prepare(UPSERT_TORRENT_SQL).run(safeInfoHash, safeMagnetUri, downloadPath);
}

export function deletePersistedTorrent(infoHash: string) {
	const safeInfoHash = toDatabaseText(infoHash);
	if (!safeInfoHash) {
		return;
	}
	getDatabase().prepare("DELETE FROM torrents WHERE info_hash = ?").run(safeInfoHash);
}

export function getDatabaseLocation() {
	return getDatabasePath();
}
