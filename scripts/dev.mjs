import { spawn } from "node:child_process";
import { createServer } from "node:net";

const defaultApiPort = 8787;
const apiPort = await resolveApiPort(defaultApiPort);
const shouldStartApi = !(await isHealthyApi(apiPort));

if (shouldStartApi) {
  console.log(`Starting API on http://127.0.0.1:${apiPort}`);
} else {
  console.log(`Reusing existing API on http://127.0.0.1:${apiPort}`);
}

const children = [];

if (shouldStartApi) {
  children.push(
    spawn("node", ["server.mjs"], {
      stdio: "inherit",
      shell: true,
      env: {
        ...process.env,
        PORT: String(apiPort),
      },
    }),
  );
}

children.push(
  spawn("node", ["./node_modules/vite/bin/vite.js"], {
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      API_PORT: String(apiPort),
    },
  }),
);

let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
  process.exit(code);
}

for (const child of children) {
  child.on("exit", (code) => {
    shutdown(code ?? 0);
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function resolveApiPort(preferredPort) {
  if (!(await isPortOpen(preferredPort))) {
    return preferredPort;
  }

  if (await isHealthyApi(preferredPort)) {
    return preferredPort;
  }

  return getFreePort();
}

async function isHealthyApi(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    if (!response.ok) {
      return false;
    }

    const payload = await response.json();
    return payload?.ok === true;
  } catch {
    return false;
  }
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = createServer();

    socket.once("error", () => resolve(true));
    socket.once("listening", () => {
      socket.close(() => resolve(false));
    });

    socket.listen(port, "127.0.0.1");
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const socket = createServer();

    socket.once("error", reject);
    socket.once("listening", () => {
      const address = socket.address();
      if (!address || typeof address === "string") {
        socket.close(() => reject(new Error("Could not resolve a free port.")));
        return;
      }

      socket.close(() => resolve(address.port));
    });

    socket.listen(0, "127.0.0.1");
  });
}
