// Use Polar's CLI relay protocol: preserve the provider's raw body and signature.
// No synthetic signing or webhook endpoint changes in the live suite.
export async function startPolarRelay(token, organizationId, forwardUrl, signal) {
  const { promise: secret, resolve: ready, reject: rejectReady } = Promise.withResolvers();
  const stream = (async () => {
    while (!signal.aborted) {
      const response = await fetch(`https://sandbox-api.polar.sh/v1/cli/listen/${organizationId}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      if (!response.ok) throw new Error(`Polar webhook relay returned ${response.status}`);
      let pending = "",
        reconnect = false;
      for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
        pending = (pending + chunk).replaceAll("\r\n", "\n");
        let end;
        while ((end = pending.indexOf("\n\n")) !== -1) {
          const frame = pending.slice(0, end);
          pending = pending.slice(end + 2);
          const data = frame
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trimStart())
            .join("\n");
          if (!data) continue;
          const event = JSON.parse(data);
          if (event.key === "connected") {
            ready(event.secret);
            continue;
          }
          if (event.type === "reconnect") {
            reconnect = true;
            break;
          }
          if (!event.payload?.payload) continue;
          const result = await fetch(forwardUrl, {
            method: "POST",
            headers: event.headers,
            body: event.payload.payload,
            signal,
          });
          if (!result.ok) throw new Error(`Live webhook forwarding failed (${result.status})`);
        }
        if (reconnect) break;
      }
    }
  })();
  stream.catch(rejectReady);
  return {
    secret: await Promise.race([
      secret,
      new Promise((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Polar webhook relay did not connect")),
          15000,
        );
        timer.unref();
      }),
    ]),
    stream,
  };
}
