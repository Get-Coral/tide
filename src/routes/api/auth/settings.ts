import { createFileRoute } from "@tanstack/react-router";
import { requireAdmin } from "#/server/auth-guards";

interface AccessSettingsBody {
	jellyfinUrl?: string | null;
	requireLogin?: boolean;
}

export const Route = createFileRoute("/api/auth/settings")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const { denied } = await requireAdmin(request);
				if (denied) return denied;

				const { getAccessSettingsSummary, saveJellyfinUrl, setRequireLogin } = await import(
					"#/lib/config-store"
				);
				const payload = (await request.json().catch(() => ({}))) as AccessSettingsBody;

				try {
					if (payload.jellyfinUrl !== undefined) {
						await saveJellyfinUrl(payload.jellyfinUrl ?? "");
					}
					// Ordered after the URL save on purpose: enabling the requirement
					// is rejected while Tide has no server to authenticate against.
					if (payload.requireLogin !== undefined) {
						setRequireLogin(payload.requireLogin);
					}
				} catch (error) {
					const message =
						error instanceof Error ? error.message : "Could not save access settings.";
					return new Response(message, { status: 400 });
				}

				return Response.json({ access: getAccessSettingsSummary() });
			},
		},
	},
});
