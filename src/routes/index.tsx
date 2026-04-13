import { CoralButton, CoralCard, CoralSection } from "@get-coral/ui";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
	createTorrent,
	deleteTorrent,
	listTorrents,
	type GlobalTorrentSettings,
	type TorrentSnapshot,
	updateGlobalTorrentSettings,
	updateTorrentControl,
} from "#/lib/torrents";

export const Route = createFileRoute("/")({
	component: Home,
});

type SortMode = "activity" | "name" | "progress" | "speed" | "size" | "status" | "ratio";
type FilterMode = "all" | TorrentSnapshot["state"];

function Home() {
	const [items, setItems] = useState<TorrentSnapshot[]>([]);
	const [, setGlobalSettings] = useState<GlobalTorrentSettings>({
		downloadLimitBps: null,
		uploadLimitBps: null,
	});
	const [magnet, setMagnet] = useState("");
	const [busy, setBusy] = useState(false);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [sortMode, setSortMode] = useState<SortMode>("activity");
	const [filterMode, setFilterMode] = useState<FilterMode>("all");
	const [trackerDraft, setTrackerDraft] = useState<Record<string, string>>({});
	const [globalDownInput, setGlobalDownInput] = useState("");
	const [globalUpInput, setGlobalUpInput] = useState("");

	useEffect(() => {
		let active = true;

		async function refresh() {
			try {
				const next = await listTorrents();
				if (!active) return;
				setItems(next.items);
				setGlobalSettings(next.global);
				setGlobalDownInput(toLimitInput(next.global.downloadLimitBps));
				setGlobalUpInput(toLimitInput(next.global.uploadLimitBps));
				setError(null);
			} catch (requestError) {
				if (!active) return;
				setError(requestError instanceof Error ? requestError.message : "Failed to load torrents.");
			} finally {
				if (active) {
					setLoading(false);
				}
			}
		}

		void refresh();

		const source = new EventSource("/api/torrents/events");
		source.onopen = () => {
			if (active) {
				setError(null);
			}
		};
		source.onmessage = (event) => {
			if (!active) return;
			try {
				const payload = JSON.parse(event.data) as {
					items?: TorrentSnapshot[];
					global?: GlobalTorrentSettings;
				};
				if (Array.isArray(payload.items)) {
					setItems(payload.items);
					setLoading(false);
				}
				if (payload.global) {
					setGlobalSettings(payload.global);
				}
			} catch {
				// ignore malformed stream event
			}
		};
		source.onerror = () => {
			if (active) {
				setError("Live updates disconnected. Reconnecting...");
			}
		};

		return () => {
			active = false;
			source.close();
		};
	}, []);

	const totals = useMemo(() => {
		const active = items.filter((item) => item.state === "downloading" || item.state === "seeding").length;
		const done = items.filter((item) => item.done).length;
		const combinedSpeed = items.reduce((total, item) => total + item.downloadSpeed, 0);
		return { active, done, combinedSpeed };
	}, [items]);

	const filteredItems = useMemo(() => {
		if (filterMode === "all") return items;
		return items.filter((item) => item.state === filterMode);
	}, [items, filterMode]);

	const sortedItems = useMemo(() => {
		const next = [...filteredItems];
		next.sort((left, right) => compareTorrents(left, right, sortMode));
		return next;
	}, [filteredItems, sortMode]);

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

	async function applyGlobalLimits(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setBusy(true);
		try {
			const updated = await updateGlobalTorrentSettings({
				downloadLimitBps: fromLimitInput(globalDownInput),
				uploadLimitBps: fromLimitInput(globalUpInput),
			});
			setGlobalSettings(updated);
			setError(null);
		} catch (requestError) {
			setError(requestError instanceof Error ? requestError.message : "Unable to save global limits.");
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
			setError(requestError instanceof Error ? requestError.message : "Unable to update torrent control.");
		} finally {
			setBusy(false);
		}
	}

	return (
		<main className="tide-screen text-ink">
			<div className="tide-layout">
				<CoralSection
					eyebrow="Tide"
					title="Torrent downloads"
					subtitle="Now includes controls close to Transmission-class operations."
				>
					<div className="tide-metrics-grid">
						<MetricCard label="Active" value={String(totals.active)} />
						<MetricCard label="Completed" value={String(totals.done)} />
						<MetricCard label="Total speed" value={formatSpeed(totals.combinedSpeed)} />
					</div>
				</CoralSection>

				<CoralSection
					eyebrow="Global"
					title="Global speed limits"
					subtitle="Set total download and upload throttles for the whole engine."
				>
					<CoralCard>
						<form className="tide-limit-form" onSubmit={applyGlobalLimits}>
							<label className="tide-label" htmlFor="global-down">
								Download KB/s
							</label>
							<input
								id="global-down"
								className="tide-input"
								value={globalDownInput}
								onChange={(event) => setGlobalDownInput(event.target.value)}
								placeholder="Unlimited"
							/>
							<label className="tide-label" htmlFor="global-up">
								Upload KB/s
							</label>
							<input
								id="global-up"
								className="tide-input"
								value={globalUpInput}
								onChange={(event) => setGlobalUpInput(event.target.value)}
								placeholder="Unlimited"
							/>
							<CoralButton type="submit" disabled={busy}>
								Save global limits
							</CoralButton>
						</form>
					</CoralCard>
				</CoralSection>

				<CoralSection
					eyebrow="Add"
					title="Start a download"
					subtitle="Paste a magnet URI to add a torrent."
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
							<div className="tide-form-row">
								<CoralButton type="submit" disabled={busy}>
									{busy ? "Working..." : "Add torrent"}
								</CoralButton>
								{error ? <p className="tide-error">{error}</p> : null}
							</div>
						</form>
					</CoralCard>
				</CoralSection>

				<CoralSection
					eyebrow="Queue"
					title="Current torrents"
					subtitle="Filter and control download lifecycle, priorities, trackers, and rules."
				>
					<div className="tide-toolbar">
						<div className="tide-sort-row">
							<label htmlFor="tide-filter" className="tide-sort-label">
								Filter
							</label>
							<select
								id="tide-filter"
								className="tide-sort-select"
								value={filterMode}
								onChange={(event) => setFilterMode(event.target.value as FilterMode)}
							>
								<option value="all">All</option>
								<option value="downloading">Downloading</option>
								<option value="seeding">Seeding</option>
								<option value="paused">Paused</option>
								<option value="errored">Errored</option>
								<option value="idle">Idle</option>
							</select>
						</div>
						<div className="tide-sort-row">
							<label htmlFor="tide-sort" className="tide-sort-label">
								Sort
							</label>
							<select
								id="tide-sort"
								className="tide-sort-select"
								value={sortMode}
								onChange={(event) => setSortMode(event.target.value as SortMode)}
							>
								<option value="activity">Recent activity</option>
								<option value="progress">Progress</option>
								<option value="speed">Download speed</option>
								<option value="status">Status</option>
								<option value="size">Size</option>
								<option value="ratio">Ratio</option>
								<option value="name">Name</option>
							</select>
						</div>
					</div>

					{loading ? <p className="text-ink-muted">Loading torrents...</p> : null}
					{!loading && sortedItems.length === 0 ? (
						<CoralCard>
							<p className="text-ink-muted">No torrents match this filter.</p>
						</CoralCard>
					) : null}
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
											<a
												href={`/api/torrents/${item.id}/stream`}
												target="_blank"
												rel="noreferrer"
												className="tide-watch-link"
											>
												Watch
											</a>
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
										<span>{item.state}</span>
										<span>{formatSpeed(item.downloadSpeed)} down</span>
										<span>{formatSpeed(item.uploadSpeed)} up</span>
										<span>{item.numPeers} peers</span>
										<span>ratio {item.ratio.toFixed(2)}</span>
										<span>eta {formatEta(item.etaSeconds)}</span>
										<span>availability {item.availability.toFixed(2)}</span>
										{item.control.lastError ? <span>error: {item.control.lastError}</span> : null}
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
														onClick={() => void patchTorrent(item.id, { removeTrackerUrl: tracker })}
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
										<p className="tide-label">Files</p>
										<div className="tide-file-list">
											{item.files.map((file) => (
												<div key={file.index} className="tide-file-row">
													<label>
														<input
															type="checkbox"
															checked={file.selected}
															onChange={(event) =>
																void patchTorrent(item.id, {
																	fileUpdates: [{ index: file.index, selected: event.target.checked }],
																})
															}
														/>
														<span>{file.name}</span>
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

function MetricCard({ label, value }: { label: string; value: string }) {
	return (
		<CoralCard>
			<p className="tide-metric-label">{label}</p>
			<p className="tide-metric-value">{value}</p>
		</CoralCard>
	);
}

function formatBytes(bytes: number) {
	if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
	const units = ["B", "KB", "MB", "GB", "TB"];
	const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	const value = bytes / 1024 ** power;
	return `${value.toFixed(value >= 10 || power === 0 ? 0 : 1)} ${units[power]}`;
}

function formatSpeed(bytesPerSecond: number) {
	return `${formatBytes(bytesPerSecond)}/s`;
}

function formatEta(seconds: number | null) {
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

function toLimitInput(value: number | null | undefined) {
	if (value == null || value < 0) return "";
	return String(Math.round(value / 1024));
}

function fromLimitInput(value: string) {
	const trimmed = value.trim();
	if (!trimmed) return null;
	const parsed = Number.parseFloat(trimmed);
	if (!Number.isFinite(parsed) || parsed < 0) return null;
	return Math.round(parsed * 1024);
}

function compareTorrents(a: TorrentSnapshot, b: TorrentSnapshot, mode: SortMode) {
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
		const order = ["downloading", "seeding", "paused", "idle", "errored"];
		return order.indexOf(a.state) - order.indexOf(b.state);
	}

	const aTime = new Date(a.createdAt).getTime();
	const bTime = new Date(b.createdAt).getTime();
	if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
		return bTime - aTime;
	}
	return a.control.queueOrder - b.control.queueOrder;
}
