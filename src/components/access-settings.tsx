import { CoralButton, CoralCard, CoralSection } from "@get-coral/ui";
import { type FormEvent, useEffect, useState } from "react";
import { type AccessSettings, getSessionState, saveAccessSettings } from "#/lib/auth";

/**
 * The "Access" card on /manage: the Jellyfin connection Tide authenticates
 * against, and whether sign-in is required. Kept out of manage.tsx, which is
 * already long enough.
 */
export function AccessSettingsCard() {
	const [access, setAccess] = useState<AccessSettings | null>(null);
	const [urlInput, setUrlInput] = useState("");
	const [requireLogin, setRequireLogin] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let active = true;
		void getSessionState()
			.then((state) => {
				if (!active) return;
				setAccess(state.access);
				setUrlInput(state.access.jellyfinUrl ?? "");
				setRequireLogin(state.access.requireLogin);
			})
			.catch((loadError: unknown) => {
				if (!active) return;
				setError(
					loadError instanceof Error ? loadError.message : "Could not read access settings.",
				);
			});
		return () => {
			active = false;
		};
	}, []);

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			const next = await saveAccessSettings({ jellyfinUrl: urlInput, requireLogin });
			setAccess(next);
			setUrlInput(next.jellyfinUrl ?? "");
			setRequireLogin(next.requireLogin);
			setNotice("Access settings saved.");
		} catch (saveError) {
			setError(saveError instanceof Error ? saveError.message : "Could not save access settings.");
			setRequireLogin(access?.requireLogin ?? false);
		} finally {
			setBusy(false);
		}
	}

	const urlLocked = access?.jellyfinUrlSource === "env";
	const requireLoginLocked = access?.requireLoginSource === "env";

	return (
		<CoralSection
			eyebrow="Access"
			title="Sign-in"
			subtitle="Optionally require a Jellyfin account to reach Tide. Off by default."
		>
			<CoralCard>
				<form className="tide-settings-form" onSubmit={handleSubmit}>
					<label className="tide-label" htmlFor="jellyfin-url">
						Jellyfin server URL
					</label>
					<input
						id="jellyfin-url"
						className="tide-input"
						value={urlInput}
						disabled={urlLocked}
						onChange={(event) => setUrlInput(event.target.value)}
						placeholder="https://jellyfin.example.com"
					/>
					<label className="tide-toggle" htmlFor="require-login">
						<input
							id="require-login"
							type="checkbox"
							checked={requireLogin}
							disabled={requireLoginLocked}
							onChange={(event) => setRequireLogin(event.target.checked)}
						/>
						<span>Require a Jellyfin sign-in to use Tide</span>
					</label>
					<CoralButton type="submit" disabled={busy || (urlLocked && requireLoginLocked)}>
						{busy ? "Saving..." : "Save access settings"}
					</CoralButton>
				</form>
			</CoralCard>
			{error ? <p className="tide-error">{error}</p> : null}
			{notice ? <p className="tide-notice">{notice}</p> : null}
			{access ? (
				<CoralCard>
					<div className="tide-stack-list">
						<AccessRow label="Jellyfin server" value={access.jellyfinUrl ?? "Not connected"} />
						<AccessRow
							label="Sign-in required"
							value={`${access.requireLogin ? "Yes" : "No"} (${access.requireLoginSource})`}
						/>
						<AccessRow label="Access .env" value="TIDE_JELLYFIN_URL and TIDE_REQUIRE_LOGIN" />
						<AccessRow
							label="Note"
							value="Tide stores no Jellyfin API key — only the server URL, used to verify sign-ins."
						/>
					</div>
				</CoralCard>
			) : null}
		</CoralSection>
	);
}

function AccessRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="tide-stack-row">
			<div>
				<p>{label}</p>
			</div>
			<span className="tide-setting-value">{value}</span>
		</div>
	);
}
