import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

const containers = () =>
  execFileSync("docker", ["ps", "-q", "--filter", "name=xport-test-"], { encoding: "utf8" })
    .trim()
    .split("\n")
    .toSorted();

test(
  "interrupting the runner stops descendants and removes its database",
  { timeout: 30000 },
  async () => {
    const before = containers();
    const directory = await mkdtemp(join(tmpdir(), "xport-runner-"));
    // Replace the build with a waiting grandchild; exercise the real runner and Docker cleanup.
    await writeFile(
      join(directory, "wait.mjs"),
      "console.log(`READY:${process.pid}`); setInterval(() => {}, 1000);",
    );
    await writeFile(
      join(directory, "pnpm"),
      '#!/bin/sh\n"$XPORT_TEST_NODE" "$XPORT_TEST_WAIT" &\nwait\n',
      { mode: 0o755 },
    );
    let child;
    try {
      for (const signal of ["SIGINT", "SIGTERM"]) {
        child = spawn(process.execPath, [fileURLToPath(new URL("run.mjs", import.meta.url))], {
          env: {
            ...process.env,
            PATH: `${directory}:${process.env.PATH}`,
            XPORT_TEST_NODE: process.execPath,
            XPORT_TEST_WAIT: join(directory, "wait.mjs"),
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let output = "";
        child.stdout.on("data", (chunk) => {
          output += chunk;
        });
        child.stderr.on("data", (chunk) => {
          output += chunk;
        });
        const exited = once(child, "close");
        for (let attempts = 0; !output.includes("READY:"); attempts++) {
          assert.ok(attempts < 100 && child.exitCode === null, output);
          await delay(100);
        }
        const descendant = Number(output.match(/READY:(\d+)/)[1]);
        child.kill(signal);
        const [code] = await exited;
        assert.notEqual(code, 0);
        assert.match(output, /Test run interrupted/);
        assert.throws(() => process.kill(descendant, 0), { code: "ESRCH" });
        assert.deepEqual(containers(), before);
      }
    } finally {
      child?.kill("SIGTERM");
      await rm(directory, { recursive: true, force: true });
    }
  },
);
