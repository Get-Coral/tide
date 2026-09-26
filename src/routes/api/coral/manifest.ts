import { createFileRoute } from "@tanstack/react-router";

/**
 * What this module is and what it can do for you.
 *
 * A caller with no credentials gets 200 and a reduced manifest: identity and
 * what Tide wants from them, no capabilities. The flow this exists for is
 * "paste a URL, see what this is, paste a token", and a bare 401 would turn
 * the first step into guesswork.
 *
 * A caller whose credentials do not work gets 401, because that is a
 * different situation and the second step of the same flow depends on being
 * able to tell them apart.
 *
 * Compatibility rules, which matter more than the contents:
 *
 * - `spec` is a single integer for the envelope.
 * - Each capability carries its own integer version, so one can move without
 *   the others.
 * - `path` is declared here, never derived by the caller from the name.
 * - Parsers must be lenient and additive-only: ignore unknown fields rather
 *   than throwing, so an old consumer keeps working against a newer Tide.
 */

const SPEC = 1;

export const Route = createFileRoute("/api/coral/manifest")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const { bearerToken } = await import("#/lib/service-tokens");
				const { requireServiceAuth } = await import("#/server/service-auth");

				// Read rather than written down, so release-please cannot leave the
				// manifest claiming a version that has already moved on.
				const { version } = await import("../../../../package.json");

				const base = {
					spec: SPEC,
					module: { id: "tide", name: "Tide", version },
					auth: { required: true, schemes: ["bearer"] },
				};

				if (bearerToken(request) === null) {
					return Response.json({ ...base, capabilities: [] });
				}

				const { denied } = await requireServiceAuth(request);
				if (denied) return denied;

				return Response.json({
					...base,
					capabilities: [
						{ name: "downloads.list", version: 1, path: "/api/coral/downloads" },
						{ name: "downloads.events", version: 1, path: "/api/coral/events" },
					],
				});
			},
		},
	},
});
