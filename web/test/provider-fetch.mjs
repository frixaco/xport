// Loaded only by the test server. Keep real routes, SDK validation and auth hooks intact.
const fetchReal = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (
    ["sandbox-api.polar.sh", "github.com", "api.github.com", "oauth2.googleapis.com"].includes(
      url.hostname,
    )
  ) {
    return fetchReal(
      new Request(`http://localhost:3211/${url.hostname}${url.pathname}${url.search}`, request),
    );
  }
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error(`Unexpected external request in offline suite: ${url.origin}`);
  }
  return fetchReal(request);
};
