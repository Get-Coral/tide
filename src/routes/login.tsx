import { CoralButton, CoralCard, CoralSection } from "@get-coral/ui";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { signIn } from "#/lib/auth";
import { readSessionState } from "#/server/functions/session";

interface LoginSearch {
	redirect?: string;
}

export const Route = createFileRoute("/login")({
	validateSearch: (search: Record<string, unknown>): LoginSearch => ({
		redirect: typeof search.redirect === "string" ? search.redirect : undefined,
	}),
	beforeLoad: async ({ search }) => {
		const state = await readSessionState();
		// Nothing to sign in to — either the requirement is off, or Tide is not
		// connected to a Jellyfin server yet.
		if (!state.requireLogin || !state.connected || state.isAuthenticated) {
			throw redirect({ to: search.redirect ?? "/" });
		}
	},
	component: LoginRoute,
});

function LoginRoute() {
	const search = Route.useSearch();
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setBusy(true);
		setError(null);
		try {
			await signIn(username, password);
			// A full load rather than a client navigation, so every route loader
			// re-runs against the new session cookie.
			window.location.href = search.redirect ?? "/";
		} catch (signInError) {
			setError(signInError instanceof Error ? signInError.message : "Sign-in failed.");
			setBusy(false);
		}
	}

	return (
		<main className="tide-screen text-ink">
			<div className="tide-layout tide-layout--narrow">
				<CoralSection
					eyebrow="Tide"
					title="Sign in"
					subtitle="Use your Jellyfin username and password."
				>
					<CoralCard>
						<form className="tide-form" onSubmit={handleSubmit}>
							<label className="tide-label" htmlFor="login-username">
								Username
							</label>
							<input
								id="login-username"
								className="tide-input"
								autoComplete="username"
								value={username}
								onChange={(event) => setUsername(event.target.value)}
							/>
							<label className="tide-label" htmlFor="login-password">
								Password
							</label>
							<input
								id="login-password"
								className="tide-input"
								type="password"
								autoComplete="current-password"
								value={password}
								onChange={(event) => setPassword(event.target.value)}
							/>
							<CoralButton type="submit" disabled={busy}>
								{busy ? "Signing in..." : "Sign in"}
							</CoralButton>
						</form>
					</CoralCard>
					{error ? <p className="tide-error">{error}</p> : null}
				</CoralSection>
			</div>
		</main>
	);
}
