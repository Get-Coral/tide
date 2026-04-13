import { CoralButton, CoralCard, CoralSection } from "@get-coral/ui";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createTorrent, deleteTorrent, listTorrents, type TorrentSnapshot } from "#/lib/torrents";

export const Route = createFileRoute("/")({
	component: Home,
});

function Home() {
	const [items, setItems] = useState<TorrentSnapshot[]>([]);
	const [magnet, setMagnet] = useState("");
	const [busy, setBusy] = useState(false);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let active = true;

		async function refresh() {
			try {
				const next = await listTorrents();
				if (active) {
					setItems(next);
					setError(null);
				}
			} catch (requestError) {
				if (active) {
					setError(
						requestError instanceof Error ? requestError.message : "Failed to load torrents.",
					);
				}
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
			if (!active) {
				return;
			}

			try {
				const payload = JSON.parse(event.data) as { items?: TorrentSnapshot[] };
				if (Array.isArray(payload.items)) {
					setItems(payload.items);
					setLoading(false);
					setError(null);
				}
			} catch {
				// Ignore malformed events and keep stream alive.
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
		const active = items.filter((item) => !item.done).length;
		const done = items.filter((item) => item.done).length;
		const combinedSpeed = items.reduce((total, item) => total + item.downloadSpeed, 0);
		return { active, done, combinedSpeed };
	}, [items]);

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
			setItems(await listTorrents());
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

	return (
		<main className="tide-screen text-ink">
			<div className="tide-layout">
				<CoralSection
					eyebrow="Tide"
					title="Torrent downloads"
					subtitle="Single app mode with server API, engine, and UI in one module."
				>
					<div className="tide-metrics-grid">
						<MetricCard label="Active" value={String(totals.active)} />
						<MetricCard label="Completed" value={String(totals.done)} />
						<MetricCard label="Total speed" value={formatSpeed(totals.combinedSpeed)} />
					</div>
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
					subtitle="Live updates are streamed from the server."
				>
					{loading ? <p className="text-ink-muted">Loading torrents...</p> : null}
					{!loading && items.length === 0 ? (
						<CoralCard>
							<p className="text-ink-muted">No torrents yet. Add one to begin.</p>
						</CoralCard>
					) : null}
					<div className="tide-list">
						{items.map((item) => (
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
												onClick={() => handleRemove(item.id)}
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
										<span>{item.done ? "Finished" : "Downloading"}</span>
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
