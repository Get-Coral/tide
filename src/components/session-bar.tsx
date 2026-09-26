import { CoralButton } from "@get-coral/ui";
import { useState } from "react";
import { signOut } from "#/lib/auth";
import type { SessionState } from "#/server/functions/session";

/** "Signed in as X" plus a sign-out button. Renders nothing when sign-in is off. */
export function SessionBar({ session }: { session: SessionState }) {
	const [busy, setBusy] = useState(false);

	if (!session.requireLogin || !session.connected || !session.isAuthenticated) {
		return null;
	}

	async function handleSignOut() {
		setBusy(true);
		try {
			await signOut();
		} finally {
			// A full load so every route loader re-runs without the session cookie.
			window.location.href = "/login";
		}
	}

	return (
		<div className="tide-inline-actions">
			<span className="tide-session-note">
				Signed in as {session.username}
				{session.isAdmin ? " · administrator" : ""}
			</span>
			<CoralButton variant="neutral" disabled={busy} onClick={() => void handleSignOut()}>
				Sign out
			</CoralButton>
		</div>
	);
}
