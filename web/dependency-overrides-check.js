// Every npm override needs a record saying why it exists and when it can go, so none outlives its cause.
// Usage: node dependency-overrides-check.js   (from the package root)
import { readFileSync } from "node:fs";

const problems = [];
const fields = ["spec", "reason", "removeWhen", "addedOn", "references"];
const isObject = (v) =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const oneLine = (v) =>
  typeof v === "string" && v.trim() !== "" && !/[\r\n]/.test(v);
const name = (path) => path.join(" > ");

function read(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    problems.push(`${file}: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}

function checkRecord(path, record, spec) {
  const at = name(path);
  for (const key of Object.keys(record)) {
    if (!fields.includes(key)) problems.push(`${at}: unknown field "${key}"`);
  }
  if (record.spec !== spec) {
    problems.push(
      `${at}: spec ${JSON.stringify(record.spec)} does not match override "${spec}"`,
    );
  }
  for (const key of ["reason", "removeWhen"]) {
    if (!oneLine(record[key]))
      problems.push(`${at}: "${key}" must be one non-blank line`);
  }
  const day = record.addedOn;
  // Date.parse accepts out-of-range days such as 02-30, so the round trip must give the same text.
  const valid =
    typeof day === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    !Number.isNaN(Date.parse(day)) &&
    new Date(day).toISOString().slice(0, 10) === day;
  if (!valid) problems.push(`${at}: "addedOn" must be a real YYYY-MM-DD date`);
  const refs = record.references;
  if (
    !Array.isArray(refs) ||
    !refs.every((r) => typeof r === "string" && URL.canParse(r))
  ) {
    problems.push(`${at}: "references" must be an array of URLs`);
  }
}

function walk(path, overrides, records) {
  for (const [key, value] of Object.entries(overrides)) {
    const here = [...path, key];
    const record = Object.hasOwn(records, key) ? records[key] : undefined;
    if (typeof value === "string") {
      if (record === undefined)
        problems.push(`${name(here)}: override has no record`);
      else if (!isObject(record))
        problems.push(`${name(here)}: record must be an object`);
      else checkRecord(here, record, value);
    } else if (isObject(value)) {
      // A package can be named "spec", so only a string spec marks a leaf record.
      if (record === undefined) walk(here, value, {});
      else if (!isObject(record) || typeof record.spec === "string") {
        problems.push(`${name(here)}: nested selector needs nested records`);
      } else walk(here, value, record);
    } else {
      problems.push(`${name(here)}: unsupported override value type`);
    }
  }
  for (const key of Object.keys(records)) {
    if (!Object.hasOwn(overrides, key))
      problems.push(`${name([...path, key])}: record has no override`);
  }
}

const pkg = read("package.json");
const records = read("dependency-overrides.json");
if (pkg !== undefined && records !== undefined) {
  const overrides = pkg.overrides ?? {};
  if (!isObject(overrides))
    problems.push('package.json: "overrides" must be an object');
  else if (!isObject(records))
    problems.push("dependency-overrides.json: must be an object");
  else walk([], overrides, records);
}
for (const p of problems) console.log(p);
process.exitCode = problems.length === 0 ? 0 : 1;
