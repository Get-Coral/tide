import type { ServiceToken } from "./service-tokens";

/** Browser-side calls for the Tokens card on /manage. */

export interface ServiceTokenList {
	tokens: ServiceToken[];
	environmentToken: boolean;
}

async function failure(response: Response) {
	const text = await response.text().catch(() => "");
	return new Error(text.trim() || `Request failed (${response.status}).`);
}

export async function listServiceTokens(): Promise<ServiceTokenList> {
	const response = await fetch("/api/service-tokens", { method: "GET" });
	if (!response.ok) throw await failure(response);
	return (await response.json()) as ServiceTokenList;
}

export async function mintServiceToken(input: {
	label: string;
	scope: "read" | "full";
}): Promise<{ record: ServiceToken; token: string }> {
	const response = await fetch("/api/service-tokens", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
	if (!response.ok) throw await failure(response);
	return (await response.json()) as { record: ServiceToken; token: string };
}

export async function revokeServiceToken(id: string): Promise<void> {
	const response = await fetch(`/api/service-tokens/${encodeURIComponent(id)}`, {
		method: "DELETE",
	});
	if (!response.ok) throw await failure(response);
}
