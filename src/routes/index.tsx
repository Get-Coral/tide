import { CoralButton, CoralCard, CoralSection } from "@get-coral/ui";
import { createFileRoute, Link } from "@tanstack/react-router";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
	compareTorrents,
	formatBytes,
	formatEta,
	formatSpeed,
	type TorrentSortMode,
} from "#/lib/torrent-ui";
import {
	createTorrent,
	type GlobalTorrentSettings,
	listTorrents,
	type TorrentSnapshot,
	updateTorrentControl,
} from "#/lib/torrents";

export const Route = createFileRoute("/")({
	component: Home,
});

type FilterMode = "all" | TorrentSnapshot["state"];

function Home() {
	const [items, setItems] = useState<TorrentSnapshot[]>([]);
	const [global, setGlobal] = useState<GlobalTorrentSettings>({
		downloadLimitBps: null,
		uploadLimitBps: null,
		maxActiveDownloads: null,
		maxActiveSeeders: null,
	});
	const [loading, setLoading] = useState(true);
	const [busyId, setBusyId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [magnet, setMagnet] = useState("");
	const [adding, setAdding] = useState(false);
	const [pasting, setPasting] = useState(false);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [sortMode, setSortMode] = useState<TorrentSortMode>("activity");
	const [filterMode, setFilterMode] = useState<FilterMode>("all");
	const [detailsOpen, setDetailsOpen] = useState(false);

	useEffect(() => {
		let active = true;

		async function refresh() {
			try {
				const next = await listTorrents();
				if (!active) return;
				setItems(next.items);
				setGlobal(next.global);
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
		source.onmessage = (event) => {
			if (!active) return;
			try {
				const payload = JSON.parse(event.data) as {
					items?: TorrentSnapshot[];
					global?: GlobalTorrentSettings;
				};
				const nextItems = Array.isArray(payload.items) ? payload.items : null;
				if (nextItems) {
					setItems(nextItems);
					setSelectedId((current) => {
						if (current && nextItems.some((item) => item.id === current)) {
							return current;
						}
						return null;
					});
				}
				if (payload.global) {
					setGlobal(payload.global);
				}
				setLoading(false);
				setError(null);
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
		const activeCount = items.filter(
			(item) => item.state === "downloading" || item.state === "seeding",
		).length;
		const queuedCount = items.filter((item) => item.state === "queued").length;
		const doneCount = items.filter((item) => item.done).length;
		const combinedSpeed = items.reduce((total, item) => total + item.downloadSpeed, 0);
		return { activeCount, queuedCount, doneCount, combinedSpeed };
	}, [items]);

	const filteredItems = useMemo(() => {
		if (filterMode === "all") return items;
		return items.filter((item) => item.state === filterMode);
	}, [filterMode, items]);

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

		setAdding(true);
		try {
			const created = await createTorrent(magnet.trim());
			setItems((current) => [created, ...current.filter((item) => item.id !== created.id)]);
			setMagnet("");
			setDetailsOpen(false);
			setError(null);
		} catch (requestError) {
			setError(requestError instanceof Error ? requestError.message : "Unable to add torrent.");
		} finally {
			setAdding(false);
		}
	}

	async function handlePasteFromClipboard() {
		if (typeof navigator === "undefined" || !navigator.clipboard?.readText) {
			setError("Clipboard paste is not available in this browser.");
			return;
		}

		setPasting(true);
		try {
			const text = await navigator.clipboard.readText();
			if (!text.trim()) {
				setError("Clipboard is empty.");
				return;
			}
			setMagnet(text.trim());
			setError(null);
		} catch {
			setError("Clipboard access was blocked. Allow paste permission and try again.");
		} finally {
			setPasting(false);
		}
	}

	async function patchTorrent(id: string, patch: Parameters<typeof updateTorrentControl>[1]) {
		setBusyId(id);
		try {
			const updated = await updateTorrentControl(id, patch);
			setItems((current) => current.map((item) => (item.id === id ? updated : item)));
			setError(null);
		} catch (requestError) {
			setError(
				requestError instanceof Error ? requestError.message : "Unable to update torrent control.",
			);
		} finally {
			setBusyId(null);
		}
	}

	return (
		<main className="tide-screen text-ink">
			<div className="tide-layout">
				<CoralSection
					eyebrow="Tide"
					title="Torrent board"
					subtitle="A calmer home view for queue status, health, and live swarm detail."
				>
					<div className="tide-hero-row">
						<div className="tide-metrics-grid tide-metrics-grid--wide">
							<MetricCard label="Active" value={String(totals.activeCount)} />
							<MetricCard label="Queued" value={String(totals.queuedCount)} />
							<MetricCard label="Completed" value={String(totals.doneCount)} />
							<MetricCard label="Total speed" value={formatSpeed(totals.combinedSpeed)} />
						</div>
						<CoralCard className="tide-hero-card">
							<div className="tide-summary-card tide-summary-card--stacked">
								<p className="tide-metric-label">Queue caps</p>
								<p className="tide-summary-copy">
									Downloads {global.maxActiveDownloads ?? "unlimited"} and seeders{" "}
									{global.maxActiveSeeders ?? "unlimited"}.
								</p>
								<div className="tide-inline-actions">
									<Link to="/manage" className="tide-watch-link">
										Open management
									</Link>
								</div>
							</div>
						</CoralCard>
						<CoralCard className="tide-hero-card tide-hero-card--form">
							<form className="tide-form" onSubmit={handleAdd}>
								<label htmlFor="home-magnet" className="tide-label">
									Quick add
								</label>
								<textarea
									id="home-magnet"
									value={magnet}
									onChange={(event) => setMagnet(event.target.value)}
									rows={3}
									placeholder="magnet:?xt=urn:btih:..."
									className="tide-input"
								/>
								<div className="tide-inline-actions">
									<CoralButton
										type="button"
										variant="neutral"
										onClick={() => void handlePasteFromClipboard()}
										disabled={pasting}
									>
										{pasting ? "Pasting..." : "Paste clipboard"}
									</CoralButton>
									<CoralButton type="submit" disabled={adding}>
										{adding ? "Adding..." : "Add torrent"}
									</CoralButton>
								</div>
							</form>
						</CoralCard>
					</div>
					{error ? <p className="tide-error">{error}</p> : null}
				</CoralSection>

				<CoralSection
					eyebrow="Live"
					title="Queue overview"
					subtitle="Select a torrent to inspect pieces, peers, and tracker health."
				>
					<div className="tide-toolbar tide-toolbar--board">
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
								<option value="queued">Queued</option>
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
								onChange={(event) => setSortMode(event.target.value as TorrentSortMode)}
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
						<CoralCard className="tide-empty-card">
							<p className="text-ink-muted">No torrents match this filter.</p>
						</CoralCard>
					) : null}

					<div className={`tide-board ${sortedItems.length === 0 ? "tide-board--empty" : ""}`}>
						<div className="tide-list tide-list--board">
							{sortedItems.map((item) => {
								const isSelected = selectedId === item.id;
								return (
									<CoralCard key={item.id} className="tide-card-shell">
										<button
											type="button"
											className={`tide-row-card ${isSelected ? "is-active" : ""}`}
											onClick={() => {
												if (isSelected) {
													setSelectedId(null);
													setDetailsOpen(false);
													return;
												}
												setSelectedId(item.id);
												setDetailsOpen(false);
											}}
										>
											<div className="tide-row-card__head">
												<div>
													<h2 className="tide-item-title">{item.name}</h2>
													<p className="tide-item-id">{item.id}</p>
												</div>
												<span className={`tide-status-pill tide-status-pill--${item.state}`}>
													{item.state}
												</span>
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
										</button>

										{isSelected ? (
											<DetailsDrawer
												detailsOpen={detailsOpen}
												item={item}
												busy={busyId === item.id}
												onPatch={patchTorrent}
												onToggleDetails={() => setDetailsOpen((current) => !current)}
											/>
										) : null}
									</CoralCard>
								);
							})}
						</div>
					</div>
				</CoralSection>
			</div>
		</main>
	);
}

function DetailsDrawer({
	busy,
	detailsOpen,
	item,
	onPatch,
	onToggleDetails,
}: {
	busy: boolean;
	detailsOpen: boolean;
	item: TorrentSnapshot;
	onPatch: (id: string, patch: Parameters<typeof updateTorrentControl>[1]) => Promise<void>;
	onToggleDetails: () => void;
}) {
	return (
		<aside className="tide-drawer">
			<div className="tide-drawer__head">
				<div>
					<p className="tide-metric-label">Torrent details</p>
					<h2 className="tide-drawer__title">{item.name}</h2>
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
							void onPatch(item.id, { action: item.control.paused ? "resume" : "pause" })
						}
						disabled={busy}
					>
						{item.control.paused ? "Resume" : "Pause"}
					</CoralButton>
					<Link to="/manage" className="tide-watch-link">
						Manage
					</Link>
				</div>
			</div>

			<div className="tide-item-stats">
				<span>{item.state}</span>
				<span>{formatBytes(item.length)}</span>
				<span>{item.numPeers} peers</span>
				<span>availability {item.availability.toFixed(2)}</span>
				{item.control.lastError ? <span>error: {item.control.lastError}</span> : null}
			</div>

			<div className="tide-mini-grid tide-mini-grid--details">
				<MiniStat label="Selected pieces" value={`${item.details.selectedPieces}`} />
				<MiniStat label="Completed pieces" value={`${item.details.completedPieces}`} />
				<MiniStat label="Trackers" value={`${item.details.trackers.length}`} />
				<MiniStat label="Peers shown" value={`${item.details.peers.length}`} />
			</div>
			<div className="tide-drawer-summary">
				<div>
					<p className="tide-label">More detail</p>
					<p className="text-ink-muted">
						Open the deep view for the piece map, tracker state, and live peer list.
					</p>
				</div>
				<CoralButton variant="neutral" onClick={onToggleDetails}>
					{detailsOpen ? "Hide details" : "Show details"}
				</CoralButton>
			</div>

			{detailsOpen ? (
				<>
					<section className="tide-drawer-section">
						<div className="tide-drawer-section__head">
							<h3>Piece map</h3>
							<span>
								{item.details.pieceCount} pieces · {formatBytes(item.details.pieceLength)}
							</span>
						</div>
						<div className="tide-piece-map">
							{item.details.pieceMap.map((bucket) => (
								<div
									key={`${bucket.startPiece}-${bucket.endPiece}`}
									className={`tide-piece-cell ${bucket.selected ? "is-selected" : "is-deselected"}`}
									style={{
										opacity: Math.max(0.2, bucket.completionRate),
										backgroundColor:
											bucket.completionRate >= 1
												? "rgba(101, 200, 184, 0.95)"
												: `rgba(242, 136, 98, ${0.2 + bucket.availabilityRate * 0.18})`,
									}}
									title={`Pieces ${bucket.startPiece}-${bucket.endPiece} · ${Math.round(
										bucket.completionRate * 100,
									)}% complete`}
								/>
							))}
						</div>
					</section>

					<section className="tide-drawer-section">
						<div className="tide-drawer-section__head">
							<h3>Trackers</h3>
							<span>{item.details.trackers.length} configured</span>
						</div>
						<div className="tide-stack-list">
							{item.details.trackers.length === 0 ? (
								<p className="text-ink-muted">No trackers configured for this torrent yet.</p>
							) : (
								item.details.trackers.map((tracker) => (
									<div key={tracker.url} className="tide-stack-row">
										<div>
											<p>{tracker.url}</p>
											<p className="tide-item-id">
												{tracker.lastAnnounceAt
													? `last announce ${new Date(tracker.lastAnnounceAt).toLocaleTimeString()}`
													: "No announce yet"}
											</p>
										</div>
										<span className={`tide-status-pill tide-status-pill--${tracker.status}`}>
											{tracker.status}
										</span>
									</div>
								))
							)}
						</div>
					</section>

					<section className="tide-drawer-section">
						<div className="tide-drawer-section__head">
							<h3>Peers</h3>
							<span>{item.details.peers.length} shown</span>
						</div>
						<div className="tide-stack-list">
							{item.details.peers.length === 0 ? (
								<p className="text-ink-muted">No peer wires connected right now.</p>
							) : (
								item.details.peers.map((peer) => (
									<div key={peer.id} className="tide-stack-row">
										<div>
											<p>{peer.address}</p>
											<p className="tide-item-id">
												{peer.type} · {peer.requestedPieces} active requests
											</p>
										</div>
										<div className="tide-peer-metrics">
											<span>{peer.downloadSpeed ? formatSpeed(peer.downloadSpeed) : "--"} in</span>
											<span>{peer.uploadSpeed ? formatSpeed(peer.uploadSpeed) : "--"} out</span>
										</div>
									</div>
								))
							)}
						</div>
					</section>
				</>
			) : null}
		</aside>
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

function MiniStat({ label, value }: { label: string; value: string }) {
	return (
		<div className="tide-mini-stat tide-mini-stat--detail">
			<p className="tide-metric-label">{label}</p>
			<p className="tide-mini-stat__value">{value}</p>
		</div>
	);
}
