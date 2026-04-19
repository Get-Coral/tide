import { CoralButton, CoralCard, CoralSection } from "@get-coral/ui";
import { createFileRoute, Link } from "@tanstack/react-router";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
	compareTorrents,
	formatBytes,
	formatEta,
	formatSpeed,
	fromLimitInput,
	type TorrentSortMode,
	toLimitInput,
} from "#/lib/torrent-ui";
import {
	type AppTorrentSettingsSummary,
	createTorrent,
	deleteTorrent,
	type GlobalTorrentSettings,
	getAppTorrentSettingsSummary,
	listTorrents,
	type TorrentSnapshot,
	updateGlobalTorrentSettings,
	updateTorrentControl,
} from "#/lib/torrents";

export const Route = createFileRoute("/manage")({
	component: ManageRoute,
});

function ManageRoute() {
	const [items, setItems] = useState<TorrentSnapshot[]>([]);
	const [app, setApp] = useState<AppTorrentSettingsSummary | null>(null);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [settingsError, setSettingsError] = useState<string | null>(null);
	const [magnet, setMagnet] = useState("");
	const [sortMode, setSortMode] = useState<TorrentSortMode>("activity");
	const [trackerDraft, setTrackerDraft] = useState<Record<string, string>>({});
	const [globalDownInput, setGlobalDownInput] = useState("");
	const [globalUpInput, setGlobalUpInput] = useState("");
	const [maxDownloadsInput, setMaxDownloadsInput] = useState("");
	const [maxSeedersInput, setMaxSeedersInput] = useState("");

	useEffect(() => {
		let active = true;

		async function refresh() {
			const [torrentsResult, settingsResult] = await Promise.allSettled([
				listTorrents(),
				getAppTorrentSettingsSummary(),
			]);
			if (!active) return;

			if (torrentsResult.status === "fulfilled") {
				const next = torrentsResult.value;
				setItems(next.items);
				setGlobalDownInput(toLimitInput(next.global.downloadLimitBps));
				setGlobalUpInput(toLimitInput(next.global.uploadLimitBps));
				setMaxDownloadsInput(toQueueInput(next.global.maxActiveDownloads));
				setMaxSeedersInput(toQueueInput(next.global.maxActiveSeeders));
				setError(null);
			} else {
				setError(
					torrentsResult.reason instanceof Error
						? torrentsResult.reason.message
						: "Failed to load torrents.",
				);
			}

			if (settingsResult.status === "fulfilled") {
				setApp(settingsResult.value.app);
				setSettingsError(null);
			} else {
				setApp(null);
				setSettingsError(
					settingsResult.reason instanceof Error
						? settingsResult.reason.message
						: "Settings summary is temporarily unavailable.",
				);
			}

			setLoading(false);
		}

		void refresh();

		const source = new EventSource("/api/torrents/events");
		source.onmessage = (event) => {
			if (!active) return;
			try {
				const payload = JSON.parse(event.data) as {
					items?: TorrentSnapshot[];
					global?: GlobalTorrentSettings;
				};
				if (Array.isArray(payload.items)) {
					setItems(payload.items);
				}
				if (payload.global) {
					setGlobalDownInput(toLimitInput(payload.global.downloadLimitBps));
					setGlobalUpInput(toLimitInput(payload.global.uploadLimitBps));
					setMaxDownloadsInput(toQueueInput(payload.global.maxActiveDownloads));
					setMaxSeedersInput(toQueueInput(payload.global.maxActiveSeeders));
				}
				setLoading(false);
			} catch {
				// ignore malformed stream event
			}
		};

		return () => {
			active = false;
			source.close();
		};
	}, []);

	const sortedItems = useMemo(() => {
		const next = [...items];
		next.sort((left, right) => compareTorrents(left, right, sortMode));
		return next;
	}, [items, sortMode]);

	async function handleAdd(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!magnet.trim()) {
			setError("Paste a magnet link first.");
			return;
		}
		setBusy(true);
		try {
			await createTorrent(magnet.trim());
			setMagnet("");
			setError(null);
		} catch (requestError) {
			setError(requestError instanceof Error ? requestError.message : "Unable to add torrent.");
		} finally {
			setBusy(false);
		}
	}

	async function handleRemove(id: string) {
		setBusy(true);
		try {
			await deleteTorrent(id);
			setItems((current) => current.filter((item) => item.id !== id));
		} catch (requestError) {
			setError(requestError instanceof Error ? requestError.message : "Unable to remove torrent.");
		} finally {
			setBusy(false);
		}
	}

	async function patchTorrent(id: string, patch: Parameters<typeof updateTorrentControl>[1]) {
		setBusy(true);
		try {
			const updated = await updateTorrentControl(id, patch);
			setItems((current) => current.map((item) => (item.id === id ? updated : item)));
			setError(null);
		} catch (requestError) {
			setError(
				requestError instanceof Error ? requestError.message : "Unable to update torrent control.",
			);
		} finally {
			setBusy(false);
		}
	}

	async function saveGlobalSettings(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setBusy(true);
		try {
			await updateGlobalTorrentSettings({
				downloadLimitBps: fromLimitInput(globalDownInput),
				uploadLimitBps: fromLimitInput(globalUpInput),
				maxActiveDownloads: fromQueueInput(maxDownloadsInput),
				maxActiveSeeders: fromQueueInput(maxSeedersInput),
			});
			setError(null);
		} catch (requestError) {
			setError(requestError instanceof Error ? requestError.message : "Unable to save settings.");
		} finally {
			setBusy(false);
		}
	}

	return (
		<main className="tide-screen text-ink">
			<div className="tide-layout">
				<CoralSection
					eyebrow="Manage"
					title="Operations and settings"
					subtitle="All torrent controls live here now, leaving the homepage focused on monitoring."
				>
					<div className="tide-top-nav">
						<Link to="/" className="tide-watch-link">
							Back to board
						</Link>
						<div className="tide-sort-row">
							<label htmlFor="manage-sort" className="tide-sort-label">
								Sort
							</label>
							<select
								id="manage-sort"
								className="tide-sort-select"
								value={sortMode}
								onChange={(event) => setSortMode(event.target.value as TorrentSortMode)}
							>
								<option value="activity">Recently added</option>
								<option value="progress">Progress</option>
								<option value="speed">Download speed</option>
								<option value="status">Status</option>
								<option value="size">Size</option>
								<option value="ratio">Ratio</option>
								<option value="name">Name</option>
							</select>
						</div>
					</div>
					{error ? <p className="tide-error">{error}</p> : null}
				</CoralSection>

				<div className="tide-manage-grid">
					<CoralSection
						eyebrow="Add"
						title="Start a download"
						subtitle="Paste a magnet URI to add a torrent into the queue."
					>
						<CoralCard>
							<form className="tide-form" onSubmit={handleAdd}>
								<label htmlFor="magnet" className="tide-label">
									Magnet link
								</label>
								<textarea
									id="magnet"
									value={magnet}
									onChange={(event) => setMagnet(event.target.value)}
									rows={3}
									placeholder="magnet:?xt=urn:btih:..."
									className="tide-input"
								/>
								<CoralButton type="submit" disabled={busy}>
									{busy ? "Working..." : "Add torrent"}
								</CoralButton>
							</form>
						</CoralCard>
					</CoralSection>

					<CoralSection
						eyebrow="Settings"
						title="Engine settings"
						subtitle="Global throttles, queue caps, downloads path, SQLite storage, and auth."
					>
						<CoralCard>
							<form className="tide-settings-form" onSubmit={saveGlobalSettings}>
								<label className="tide-label" htmlFor="global-down">
									Global download KB/s
								</label>
								<input
									id="global-down"
									className="tide-input"
									value={globalDownInput}
									onChange={(event) => setGlobalDownInput(event.target.value)}
									placeholder="Unlimited"
								/>
								<label className="tide-label" htmlFor="global-up">
									Global upload KB/s
								</label>
								<input
									id="global-up"
									className="tide-input"
									value={globalUpInput}
									onChange={(event) => setGlobalUpInput(event.target.value)}
									placeholder="Unlimited"
								/>
								<label className="tide-label" htmlFor="max-downloads">
									Max active downloads
								</label>
								<input
									id="max-downloads"
									className="tide-input"
									value={maxDownloadsInput}
									onChange={(event) => setMaxDownloadsInput(event.target.value)}
									placeholder="Unlimited"
								/>
								<label className="tide-label" htmlFor="max-seeders">
									Max active seeders
								</label>
								<input
									id="max-seeders"
									className="tide-input"
									value={maxSeedersInput}
									onChange={(event) => setMaxSeedersInput(event.target.value)}
									placeholder="Unlimited"
								/>
								<CoralButton type="submit" disabled={busy}>
									Save settings
								</CoralButton>
							</form>
						</CoralCard>
						{settingsError ? <p className="tide-error">{settingsError}</p> : null}
						{app ? (
							<CoralCard>
								<div className="tide-stack-list">
									<SettingRow label="Downloads directory" value={app.downloadsDirectory} />
									<SettingRow
										label="Choose via .env"
										value={`${app.downloadsEnvVar}=./downloads`}
									/>
									<SettingRow label="SQLite database" value={app.databasePath} />
									<SettingRow
										label="Basic auth"
										value={
											app.basicAuthEnabled
												? `Enabled for ${app.basicAuthUsername ?? "configured user"}`
												: "Disabled"
										}
									/>
									<SettingRow label="Auth .env" value="TIDE_AUTH_USERNAME and TIDE_AUTH_PASSWORD" />
									<SettingRow
										label="Memory guard"
										value={
											app.memoryGuardEnabled
												? `Enabled (${app.memoryGuardSource})${app.memoryGuardActive ? " · active" : ""}`
												: "Disabled"
										}
									/>
									<SettingRow label="Memory thresholds" value={formatMemoryThresholdSummary(app)} />
									<SettingRow
										label="Memory guard .env"
										value="TIDE_MEMORY_LIMIT_MB, TIDE_MEMORY_PAUSE_MB, TIDE_MEMORY_RESUME_MB, TIDE_MEMORY_CHECK_INTERVAL_MS"
									/>
								</div>
							</CoralCard>
						) : null}
					</CoralSection>
				</div>

				<CoralSection
					eyebrow="Queue"
					title="Torrent controls"
					subtitle="Per-torrent management, file priorities, trackers, and lifecycle rules."
				>
					{loading ? <p className="text-ink-muted">Loading torrents...</p> : null}
					<div className="tide-list">
						{sortedItems.map((item) => (
							<CoralCard key={item.id}>
								<article className="tide-item">
									<div className="tide-item-head">
										<div>
											<h2 className="tide-item-title">{item.name}</h2>
											<p className="tide-item-id">{item.id}</p>
										</div>
										<div className="tide-item-actions">
											<span className={`tide-status-pill tide-status-pill--${item.state}`}>
												{item.state}
											</span>
											<CoralButton
												variant="neutral"
												onClick={() =>
													void patchTorrent(item.id, {
														action: item.control.paused ? "resume" : "pause",
													})
												}
												disabled={busy}
											>
												{item.control.paused ? "Resume" : "Pause"}
											</CoralButton>
											<CoralButton
												variant="neutral"
												onClick={() => void patchTorrent(item.id, { action: "reannounce" })}
												disabled={busy}
											>
												Reannounce
											</CoralButton>
											<CoralButton
												variant="danger"
												onClick={() => void handleRemove(item.id)}
												disabled={busy}
											>
												Remove
											</CoralButton>
										</div>
									</div>

									<div className="tide-progress-meta">
										<span>{Math.round(item.progress * 100)}%</span>
										<span>
											{formatBytes(item.downloaded)} / {formatBytes(item.length)}
										</span>
									</div>
									<div className="tide-progress-track">
										<div
											className="tide-progress-fill"
											style={{ width: `${Math.max(2, item.progress * 100)}%` }}
										/>
									</div>

									<div className="tide-item-stats">
										<span>{formatSpeed(item.downloadSpeed)} down</span>
										<span>{formatSpeed(item.uploadSpeed)} up</span>
										<span>{item.numPeers} peers</span>
										<span>ratio {item.ratio.toFixed(2)}</span>
										<span>eta {formatEta(item.etaSeconds)}</span>
									</div>

									<div className="tide-control-grid">
										<label className="tide-label">
											Queue order
											<input
												type="number"
												defaultValue={item.control.queueOrder}
												className="tide-input"
												onBlur={(event) => {
													const value = Number.parseInt(event.target.value, 10);
													if (Number.isFinite(value)) {
														void patchTorrent(item.id, { queueOrder: value });
													}
												}}
											/>
										</label>
										<label className="tide-label">
											Torrent down KB/s
											<input
												type="number"
												defaultValue={toLimitInput(item.control.downloadLimitBps)}
												className="tide-input"
												onBlur={(event) => {
													void patchTorrent(item.id, {
														downloadLimitBps: fromLimitInput(event.target.value),
													});
												}}
											/>
										</label>
										<label className="tide-label">
											Torrent up KB/s
											<input
												type="number"
												defaultValue={toLimitInput(item.control.uploadLimitBps)}
												className="tide-input"
												onBlur={(event) => {
													void patchTorrent(item.id, {
														uploadLimitBps: fromLimitInput(event.target.value),
													});
												}}
											/>
										</label>
										<label className="tide-label">
											Ratio goal
											<input
												type="number"
												step="0.1"
												defaultValue={item.control.ratioGoal ?? ""}
												className="tide-input"
												onBlur={(event) => {
													const raw = event.target.value.trim();
													const parsed = raw ? Number.parseFloat(raw) : null;
													void patchTorrent(item.id, {
														ratioGoal: parsed != null && Number.isFinite(parsed) ? parsed : null,
													});
												}}
											/>
										</label>
										<label className="tide-label">
											Seed minutes goal
											<input
												type="number"
												defaultValue={item.control.seedTimeGoalMinutes ?? ""}
												className="tide-input"
												onBlur={(event) => {
													const raw = event.target.value.trim();
													const parsed = raw ? Number.parseInt(raw, 10) : null;
													void patchTorrent(item.id, {
														seedTimeGoalMinutes:
															parsed != null && Number.isFinite(parsed) ? parsed : null,
													});
												}}
											/>
										</label>
									</div>

									<div className="tide-inline-actions">
										<CoralButton
											variant={item.control.stopOnRatio ? "neutral" : undefined}
											onClick={() =>
												void patchTorrent(item.id, { stopOnRatio: !item.control.stopOnRatio })
											}
											disabled={busy}
										>
											Stop on ratio: {item.control.stopOnRatio ? "On" : "Off"}
										</CoralButton>
										<CoralButton
											variant={item.control.stopOnSeedTime ? "neutral" : undefined}
											onClick={() =>
												void patchTorrent(item.id, { stopOnSeedTime: !item.control.stopOnSeedTime })
											}
											disabled={busy}
										>
											Stop on seed time: {item.control.stopOnSeedTime ? "On" : "Off"}
										</CoralButton>
									</div>

									<div className="tide-tracker-panel">
										<p className="tide-label">Trackers</p>
										<div className="tide-tracker-list">
											{item.control.trackerUrls.map((tracker) => (
												<div key={tracker} className="tide-tracker-row">
													<span>{tracker}</span>
													<CoralButton
														size="sm"
														variant="neutral"
														onClick={() =>
															void patchTorrent(item.id, { removeTrackerUrl: tracker })
														}
														disabled={busy}
													>
														Remove
													</CoralButton>
												</div>
											))}
										</div>
										<div className="tide-form-row">
											<input
												className="tide-input"
												placeholder="udp://tracker.example:80/announce"
												value={trackerDraft[item.id] ?? ""}
												onChange={(event) =>
													setTrackerDraft((current) => ({
														...current,
														[item.id]: event.target.value,
													}))
												}
											/>
											<CoralButton
												variant="neutral"
												onClick={() => {
													const value = trackerDraft[item.id]?.trim();
													if (!value) return;
													void patchTorrent(item.id, { addTrackerUrl: value });
													setTrackerDraft((current) => ({ ...current, [item.id]: "" }));
												}}
												disabled={busy}
											>
												Add tracker
											</CoralButton>
										</div>
									</div>

									<div className="tide-files-panel">
										<p className="tide-label">Files and priorities</p>
										<div className="tide-file-list">
											{item.files.map((file) => (
												<div key={file.index} className="tide-file-row">
													<label>
														<input
															type="checkbox"
															checked={file.selected}
															onChange={(event) =>
																void patchTorrent(item.id, {
																	fileUpdates: [
																		{ index: file.index, selected: event.target.checked },
																	],
																})
															}
														/>
														<span>
															{file.name} · {formatBytes(file.length)}
														</span>
													</label>
													<input
														type="number"
														min={0}
														max={10}
														defaultValue={file.priority}
														className="tide-file-priority"
														onBlur={(event) => {
															const value = Number.parseInt(event.target.value, 10);
															if (Number.isFinite(value)) {
																void patchTorrent(item.id, {
																	fileUpdates: [{ index: file.index, priority: value }],
																});
															}
														}}
													/>
												</div>
											))}
										</div>
									</div>
								</article>
							</CoralCard>
						))}
					</div>
				</CoralSection>
			</div>
		</main>
	);
}

function SettingRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="tide-stack-row">
			<div>
				<p>{label}</p>
			</div>
			<span className="tide-setting-value">{value}</span>
		</div>
	);
}

function formatMemoryThresholdSummary(app: AppTorrentSettingsSummary) {
	if (!app.memoryGuardEnabled) {
		return "Disabled";
	}

	const parts = [
		`pause ${formatMemoryMiB(app.memoryGuardPauseMb)}`,
		`resume ${formatMemoryMiB(app.memoryGuardResumeMb)}`,
	];
	if (app.memoryGuardLimitMb != null) {
		parts.push(`limit ${formatMemoryMiB(app.memoryGuardLimitMb)}`);
	}
	if (app.memoryGuardCurrentRssMb != null) {
		parts.push(`rss ${formatMemoryMiB(app.memoryGuardCurrentRssMb)}`);
	}
	parts.push(`check ${Math.max(1, Math.round(app.memoryGuardCheckIntervalMs / 1000))}s`);
	return parts.join(" · ");
}

function formatMemoryMiB(value: number | null) {
	return value == null ? "unknown" : `${value} MiB`;
}

function toQueueInput(value: number | null | undefined) {
	if (value == null) return "";
	return String(value);
}

function fromQueueInput(value: string) {
	const trimmed = value.trim();
	if (!trimmed) return null;
	const parsed = Number.parseInt(trimmed, 10);
	if (!Number.isFinite(parsed) || parsed < 0) return null;
	return parsed;
}
