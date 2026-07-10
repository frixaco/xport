import { CliError, type CommandContext } from "./common.ts";
import { extractErrorMessage } from "./core.ts";

export function apiUrl(ctx: CommandContext, route: string): string {
  return new URL(route, `${ctx.baseUrl}/`).toString();
}

export async function readResponsePayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

export async function requestJson<T>(
  ctx: CommandContext,
  route: string,
  options: RequestInit & { token?: string } = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.token) headers.set("Authorization", `Bearer ${options.token}`);
  const response = await fetch(apiUrl(ctx, route), {
    ...options,
    headers,
  });
  const payload = await readResponsePayload(response);

  if (!response.ok) {
    const message = extractErrorMessage(payload) ?? `Request failed (${response.status}).`;
    if (response.status === 401) {
      throw new CliError(`${message} Run \`xport login\` first, or set XPORT_TOKEN.`);
    }
    throw new CliError(message);
  }

  return payload as T;
}
