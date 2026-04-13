import { createFileRoute } from "@tanstack/react-router";

const VIDEO_EXTENSIONS = [".mkv", ".mp4", ".mov", ".avi", ".webm", ".m4v"];

function inferContentType(name: string) {
	const lower = name.toLowerCase();
	if (lower.endsWith(".mp4") || lower.endsWith(".m4v")) return "video/mp4";
	if (lower.endsWith(".webm")) return "video/webm";
	if (lower.endsWith(".mkv")) return "video/x-matroska";
	if (lower.endsWith(".mov")) return "video/quicktime";
	if (lower.endsWith(".avi")) return "video/x-msvideo";
	return "application/octet-stream";
}

function chooseFileIndex(names: string[], requested: string | null) {
	if (requested == null) {
		const preferred = names.findIndex((name) =>
			VIDEO_EXTENSIONS.some((extension) => name.toLowerCase().endsWith(extension)),
		);
		return preferred >= 0 ? preferred : 0;
	}
	const parsed = Number.parseInt(requested, 10);
	if (!Number.isFinite(parsed) || parsed < 0 || parsed >= names.length) {
		return -1;
	}
	return parsed;
}

export const Route = createFileRoute("/api/torrents/$id/stream")({
	server: {
		handlers: {
			GET: async ({ params, request }) => {
				const { getTorrentById } = await import("#/server/modules/torrent/manager");
				const torrent = getTorrentById(params.id);
				if (!torrent) {
					return new Response("Torrent not found.", { status: 404 });
				}

				if (!torrent.files.length) {
					return new Response("No files available yet.", { status: 409 });
				}

				const url = new URL(request.url);
				const names = torrent.files.map((file) => file.name);
				const index = chooseFileIndex(names, url.searchParams.get("fileIndex"));
				if (index < 0) {
					return new Response("Invalid file index.", { status: 400 });
				}

				const file = torrent.files[index];
				const totalSize = file.length;
				const rangeHeader = request.headers.get("range");
				const contentType = inferContentType(file.name);

				if (!rangeHeader) {
					const nodeStream = file.createReadStream();
					return new Response(nodeStream as unknown as BodyInit, {
						status: 200,
						headers: {
							"content-type": contentType,
							"accept-ranges": "bytes",
							"content-length": String(totalSize),
						},
					});
				}

				const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
				if (!match) {
					return new Response("Invalid range header.", { status: 416 });
				}

				const start = match[1] ? Number.parseInt(match[1], 10) : 0;
				const end = match[2] ? Number.parseInt(match[2], 10) : totalSize - 1;

				if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end >= totalSize) {
					return new Response("Requested range not satisfiable.", {
						status: 416,
						headers: { "content-range": `bytes */${totalSize}` },
					});
				}

				const nodeStream = file.createReadStream({ start, end });
				return new Response(nodeStream as unknown as BodyInit, {
					status: 206,
					headers: {
						"content-type": contentType,
						"accept-ranges": "bytes",
						"content-range": `bytes ${start}-${end}/${totalSize}`,
						"content-length": String(end - start + 1),
					},
				});
			},
		},
	},
});
