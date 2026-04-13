export interface TorrentFileSnapshot {
	index: number;
	name: string;
	length: number;
	downloaded: number;
	progress: number;
}

export interface TorrentSnapshot {
	id: string;
	name: string;
	magnetURI: string;
	progress: number;
	downloadSpeed: number;
	uploadSpeed: number;
	numPeers: number;
	downloaded: number;
	length: number;
	done: boolean;
	createdAt: string;
	files: TorrentFileSnapshot[];
}

export interface AddTorrentInput {
	magnet: string;
	path?: string;
}
