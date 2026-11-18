// The process-group anchor for one supervised command on POSIX. The supervisor starts it
// detached, so it leads a new group, and the command it starts stays in that group. Every way it
// ends is its own SIGKILL to that group: from inside, while it is a member, the group's ID cannot
// belong to anyone else.
import { spawn } from "node:child_process";
import { readSync } from "node:fs";
import { Socket } from "node:net";

const [command, ...args] = process.argv.slice(2);
let ending = false;
let reported = false;

function end() {
  if (ending) return;
  ending = true;
  try {
    process.kill(0, "SIGKILL");
  } catch {
    // Only reached if the group could not be killed; this status is then a protocol failure.
  }
  process.exit(70);
}

for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) process.on(signal, end);
process.on("uncaughtException", end);

// The supervisor never writes here: any data, its end of the channel closing or an error is a stop.
const control = new Socket({ fd: 3, readable: true, writable: true });
control.on("data", end);
control.on("end", end);
control.on("error", end);
control.on("close", end);

// A stop seen before the spawn prevents the start; one racing the spawn is ended by the group KILL.
function stopPending() {
  try {
    readSync(3, Buffer.alloc(1));
    return true;
  } catch (error) {
    return error?.code !== "EAGAIN";
  }
}

const codeOf = (error) =>
  typeof error?.code === "string" && /^[A-Z][A-Z0-9_]*$/u.test(error.code)
    ? error.code
    : "UNKNOWN";

function report(record) {
  if (reported) return;
  reported = true;
  control.write(`${JSON.stringify(record)}\n`, end);
}

const carried = JSON.parse(
  process.env.SHARPLADDER_SUPERVISE_NODE_OPTIONS ?? "{}",
);
delete process.env.SHARPLADDER_SUPERVISE_NODE_OPTIONS;
for (const name of ["NODE_OPTIONS", "SHARPLADDER_SUPERVISE_NODE_OPTIONS"])
  if (typeof carried[name] === "string") process.env[name] = carried[name];

if (command === undefined || stopPending()) end();
else {
  try {
    // This end of the channel is close-on-exec from Node's startup, so the command never holds it.
    const child = spawn(command, args, {
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("error", (error) => {
      report({ v: 1, kind: "spawn-error", code: codeOf(error) });
    });
    child.on("exit", (code, signal) => {
      report({ v: 1, kind: "exit", code, signal });
    });
  } catch (error) {
    report({ v: 1, kind: "spawn-error", code: codeOf(error) });
  }
}
