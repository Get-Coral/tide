import { CoralButton, CoralCard, CoralSection } from "@get-coral/ui";
import { type FormEvent, useEffect, useState } from "react";
import { listServiceTokens, mintServiceToken, revokeServiceToken } from "#/lib/coral-tokens";
import type { ServiceToken } from "#/lib/service-tokens";

/**
 * The "Coral tokens" card on /manage: credentials other Coral modules use to
 * read Tide's downloads.
 *
 * Inbound only. Tide never calls anything, so there is nothing to connect
 * *to* here — a module that wants Tide's downloads asks Tide for them.
 */
export function ServiceTokensCard() {
	const [tokens, setTokens] = useState<ServiceToken[]>([]);
	const [environmentToken, setEnvironmentToken] = useState(false);
	const [label, setLabel] = useState("");
	const [scope, setScope] = useState<"read" | "full">("read");
	const [minted, setMinted] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let active = true;
		void listServiceTokens()
			.then((state) => {
				if (!active) return;
				setTokens(state.tokens);
				setEnvironmentToken(state.environmentToken);
			})
			.catch((loadError: unknown) => {
				if (!active) return;
				setError(loadError instanceof Error ? loadError.message : "Could not read tokens.");
			});
		return () => {
			active = false;
		};
	}, []);

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setBusy(true);
		setError(null);
		try {
			const result = await mintServiceToken({ label, scope });
			setTokens((current) => [...current, result.record]);
			setMinted(result.token);
			setLabel("");
		} catch (mintError) {
			setError(mintError instanceof Error ? mintError.message : "Could not issue a token.");
		} finally {
			setBusy(false);
		}
	}

	async function handleRevoke(id: string) {
		try {
			await revokeServiceToken(id);
			setTokens((current) => current.filter((token) => token.id !== id));
		} catch (revokeError) {
			setError(revokeError instanceof Error ? revokeError.message : "Could not revoke.");
		}
	}

	return (
		<CoralSection title="Coral tokens">
			<CoralCard>
				<p className="text-sm text-slate-300">
					Let another Coral module read what Tide is downloading. A token grants a capability, not
					an account — it carries no user identity.
				</p>

				<form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={handleSubmit}>
					<label className="flex-1 min-w-[12rem] text-sm">
						<span className="mb-1 block text-slate-400">Label</span>
						<input
							className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
							placeholder="e.g. Librarian"
							value={label}
							onChange={(event) => setLabel(event.target.value)}
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block text-slate-400">Access</span>
						<select
							className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
							value={scope}
							onChange={(event) => setScope(event.target.value as "read" | "full")}
						>
							<option value="read">Read-only</option>
							<option value="full">Full</option>
						</select>
					</label>
					<CoralButton type="submit" disabled={busy}>
						Issue
					</CoralButton>
				</form>

				{error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}

				{minted ? (
					<div className="mt-4 rounded-lg border border-emerald-400/30 bg-emerald-400/5 p-3">
						<p className="text-sm font-semibold text-emerald-300">
							Copy this now — it is not shown again.
						</p>
						<p className="mt-2 break-all font-mono text-xs">{minted}</p>
						<button
							type="button"
							className="mt-2 text-xs text-slate-400 underline"
							onClick={() => setMinted(null)}
						>
							Done
						</button>
					</div>
				) : null}

				{environmentToken ? (
					<p className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-slate-400">
						<span className="font-semibold text-slate-200">CORAL_SERVICE_TOKEN</span> is set in the
						environment and grants full access. It is not listed here and cannot be revoked from
						this page — remove it from your compose file.
					</p>
				) : null}

				<div className="mt-4 grid gap-2">
					{tokens.length === 0 ? <p className="text-sm text-slate-400">No tokens issued.</p> : null}

					{tokens.map((token) => (
						<div
							key={token.id}
							className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2"
						>
							<div className="min-w-0">
								<p className="truncate text-sm font-semibold">{token.label}</p>
								<p className="truncate text-xs text-slate-400">
									{token.scopes.includes("full") ? "Full access" : "Read-only"} ·{" "}
									{token.lastUsedAt ? `last used ${formatWhen(token.lastUsedAt)}` : "never used"}
								</p>
							</div>
							<button
								type="button"
								className="text-xs text-slate-400 underline"
								onClick={() => void handleRevoke(token.id)}
							>
								Revoke
							</button>
						</div>
					))}
				</div>
			</CoralCard>
		</CoralSection>
	);
}

function formatWhen(value: string) {
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return value;

	return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
		parsed,
	);
}
