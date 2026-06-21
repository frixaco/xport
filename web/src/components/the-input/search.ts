const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type HomeSearch = {
  input?: string;
  jobId?: string;
  auth_error?: string;
  checkout_id?: string;
} & Record<string, string | undefined>;

export function validateHomeSearch(search: Record<string, unknown>): HomeSearch {
  const result: HomeSearch = {};

  for (const [key, value] of Object.entries(search)) {
    if (typeof value === "string") result[key] = value;
  }

  return result;
}

export function isValidJobId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function withoutEmptySearchValues(search: HomeSearch): HomeSearch | undefined {
  const result: HomeSearch = {};

  for (const [key, value] of Object.entries(search)) {
    if (typeof value === "string" && value.length > 0) result[key] = value;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}
