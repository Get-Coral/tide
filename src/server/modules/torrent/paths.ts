import path from "node:path";

export interface DownloadRoots {
	downloads: string;
	incomplete: string;
}

/**
 * Confine a caller-supplied download path to the directories Tide owns.
 *
 * `POST /api/torrents` accepts an optional `path`, and it used to reach
 * `torrentClient.add()` untouched — so a caller could have Tide write torrent
 * data anywhere the process could reach. Only the completed and in-progress
 * directories, or somewhere beneath them, are valid targets.
 *
 * Comparing against `root + path.sep` rather than the bare root matters: a
 * plain prefix test would also accept a sibling like `/downloads-old`.
 */
export function resolveDownloadPath(candidate: string | undefined, roots: DownloadRoots): string {
	const requested = candidate?.trim();
	if (!requested) {
		return roots.incomplete;
	}

	const resolved = path.resolve(requested);
	const allowed = [roots.downloads, roots.incomplete].some(
		(root) => resolved === root || resolved.startsWith(`${root}${path.sep}`),
	);

	if (!allowed) {
		throw new Error("Download path must be inside Tide's downloads directory.");
	}

	return resolved;
}
