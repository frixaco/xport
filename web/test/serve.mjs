// oxlint-disable-next-line import/no-unassigned-import -- starts the test-only provider server.
import "./mock-providers.mjs";
import { spawn } from "node:child_process";
const child = spawn(
  process.execPath,
  ["--import", "./test/provider-fetch.mjs", ".output/server/index.mjs"],
  {
    env: { ...process.env, PORT: "3210", HOST: "127.0.0.1" },
    stdio: "inherit",
  },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    child.kill(signal);
    process.exit();
  });
child.on("exit", (code) => process.exit(code ?? 1));
