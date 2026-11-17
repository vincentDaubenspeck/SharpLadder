// Kept to plain data, with no file read, process or module lookup, so every rule can be judged
// without npm; the caller hands in the version library.

export const severities = ["info", "low", "moderate", "high", "critical"];
export const policyFile = "dependency-audit-policy.json";

const fields = ["advisoryId", "package", "versions", "reason", "removeWhen", "addedOn", "references"];
const group = "[23456789cfghjmpqrvwx]{4}";
const ghsa = `GHSA-${group}-${group}-${group}`;
const advisoryId = new RegExp(`^${ghsa}$`, "u");
// Only this exact form names an advisory, so an id can never come from a lookalike address.
const advisoryUrl = new RegExp(`^https://github\\.com/advisories/(${ghsa})$`, "u");
// Prereleases count as installed versions, so one can never fall out of an affected set.
const anyRelease = { includePrerelease: true };

const isRecord = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const oneLine = (v) => typeof v === "string" && v.trim() !== "" && !/[\r\n]/u.test(v);
const shown = (v) => JSON.stringify(v) ?? String(v);
const sameSet = (a, b) => JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());

// Date.parse accepts out-of-range days such as 02-30, so the round trip must give the same text.
const realDate = (day) =>
  typeof day === "string" &&
  /^\d{4}-\d{2}-\d{2}$/u.test(day) &&
  !Number.isNaN(Date.parse(day)) &&
  new Date(day).toISOString().slice(0, 10) === day;

// An unknown or missing key is a problem too, so a mistyped field is never quietly ignored.
export function policyProblems(policy) {
  const at = (where, problem) => `${policyFile}: ${where}${problem}`;
  if (!isRecord(policy)) return [at("", "must be an object")];
  const unknown = Object.keys(policy).filter((key) => key !== "exceptions");
  if (unknown.length > 0) return [at("", `unknown key ${shown(unknown[0])}`)];
  if (!Array.isArray(policy.exceptions)) return [at("", '"exceptions" must be an array')];
  const problems = [];
  const seen = new Set();
  policy.exceptions.forEach((record, index) => {
    const where = `exception ${String(index + 1)}: `;
    if (!isRecord(record)) {
      problems.push(at(where, "must be an object"));
      return;
    }
    for (const key of Object.keys(record)) {
      if (!fields.includes(key)) problems.push(at(where, `unknown key ${shown(key)}`));
    }
    for (const key of fields) {
      if (!Object.hasOwn(record, key)) problems.push(at(where, `missing key "${key}"`));
    }
    if (typeof record.advisoryId !== "string" || !advisoryId.test(record.advisoryId)) {
      problems.push(at(where, '"advisoryId" must be a GitHub advisory id (GHSA-xxxx-xxxx-xxxx)'));
    }
    if (typeof record.package !== "string" || record.package === "" || record.package.startsWith("-")) {
      problems.push(at(where, '"package" must be a package name'));
    }
    const versions = record.versions;
    if (
      !Array.isArray(versions) ||
      versions.length === 0 ||
      !versions.every((v) => typeof v === "string") ||
      new Set(versions).size !== versions.length
    ) {
      problems.push(at(where, '"versions" must be a non-empty list of distinct strings'));
    }
    for (const key of ["reason", "removeWhen"]) {
      if (!oneLine(record[key])) problems.push(at(where, `"${key}" must be one non-blank line`));
    }
    if (!realDate(record.addedOn)) problems.push(at(where, '"addedOn" must be a real YYYY-MM-DD date'));
    const refs = record.references;
    if (!Array.isArray(refs) || refs.length === 0 || !refs.every((r) => typeof r === "string" && URL.canParse(r))) {
      problems.push(at(where, '"references" must be a non-empty list of URLs'));
    }
    const pair = JSON.stringify([record.advisoryId, record.package]);
    if (seen.has(pair)) problems.push(at(where, "repeats the advisory and package of an earlier exception"));
    seen.add(pair);
  });
  return problems;
}

// Every installed and recorded version must be exact before a range is compared, so an odd one
// fails instead of quietly falling out of a set.
export function recordProblems(exceptions, installs, semver) {
  const problems = [];
  for (const i of installs) {
    if (semver.valid(i.version) !== i.version) {
      problems.push(`the lockfile gives ${i.location} the version ${shown(i.version)}, which is not exact`);
    }
  }
  const names = new Set(installs.map((i) => i.name));
  for (const record of exceptions) {
    for (const v of record.versions) {
      if (semver.valid(v) !== v) {
        problems.push(`${policyFile}: ${record.advisoryId} in ${record.package} records ${shown(v)}, not an exact version`);
      }
    }
    if (!names.has(record.package)) {
      problems.push(`${policyFile}: ${record.advisoryId} names ${record.package}, which is not installed`);
    }
  }
  return problems;
}

// Each entry's advisories, reached through via. An entry named in via stands for its own via;
// a cycle or a name with no entry fails, and finished entries are reused.
function reachedAdvisories(found, problems) {
  const done = new Map();
  const visit = (name, path) => {
    if (done.has(name)) return done.get(name);
    if (path.includes(name)) {
      problems.push(`npm audit report via has a cycle: ${[...path, name].map(shown).join(" > ")}`);
      return null;
    }
    const reached = new Set();
    for (const item of found[name].via) {
      if (typeof item !== "string") {
        reached.add(item);
        continue;
      }
      if (!Object.hasOwn(found, item)) {
        problems.push(`npm audit report entry ${shown(name)} names ${shown(item)} in via, which has no entry`);
        return null;
      }
      const inner = visit(item, [...path, name]);
      if (inner === null) return null;
      for (const advisory of inner) reached.add(advisory);
    }
    done.set(name, reached);
    return reached;
  };
  for (const name of Object.keys(found)) {
    const reached = visit(name, []);
    if (reached === null) return null;
    if (reached.size === 0) {
      problems.push(`npm audit report entry ${shown(name)} reaches no advisory`);
      return null;
    }
  }
  return done;
}

// The stage has judged the report's totals already, so only entry shape and per-severity counts remain.
function entryProblems(report) {
  const found = report.vulnerabilities;
  const problems = [];
  const counted = Object.fromEntries(severities.map((s) => [s, 0]));
  for (const [key, entry] of Object.entries(found)) {
    const at = `npm audit report entry ${shown(key)}`;
    if (!isRecord(entry)) {
      problems.push(`${at} is not an object`);
      continue;
    }
    if (entry.name !== key) problems.push(`${at} is named ${shown(entry.name)}`);
    if (severities.includes(entry.severity)) counted[entry.severity]++;
    else problems.push(`${at} has the severity ${shown(entry.severity)}`);
    const via = entry.via;
    if (!Array.isArray(via) || via.length === 0 || !via.every((v) => typeof v === "string" || isRecord(v))) {
      problems.push(`${at} has a malformed via`);
    }
    if (!Array.isArray(entry.nodes) || !entry.nodes.every((n) => typeof n === "string")) {
      problems.push(`${at} has malformed nodes`);
    }
  }
  for (const s of severities) {
    if (report.metadata.vulnerabilities[s] !== counted[s]) {
      problems.push(`npm audit report counts ${s} ${shown(report.metadata.vulnerabilities[s])}, but lists ${String(counted[s])}`);
    }
  }
  return problems;
}

// A problem is returned, not thrown, so one unreadable advisory is reported beside the others.
function readAdvisory(entryName, advisory, semver) {
  const url = typeof advisory.url === "string" ? advisory.url : "";
  const id = advisoryUrl.exec(url)?.[1];
  const label = `advisory ${shown(id ?? advisory.url)} in ${shown(entryName)}`;
  if (id === undefined) return { label, problem: "has no exact GitHub advisory address" };
  if (advisory.name !== entryName || advisory.dependency !== entryName) {
    return { label, problem: "names another package" };
  }
  const range = advisory.range;
  if (typeof range !== "string" || range.trim() === "" || semver.validRange(range) === null) {
    return { label, problem: `has the invalid range ${shown(range)}` };
  }
  return { label, id, name: entryName, range };
}

// A report with findings against the records. Every advisory needs one record whose versions
// are exactly the installed versions it affects, read from the lockfile and never from the
// report; every record needs an advisory. Returns the problems and each record's range.
export function findingProblems(report, installs, exceptions, semver) {
  const problems = entryProblems(report);
  if (problems.length > 0) return { problems, ranges: null };
  const found = report.vulnerabilities;
  const reached = reachedAdvisories(found, problems);
  if (reached === null) return { problems, ranges: null };

  const byLocation = new Map(installs.map((i) => [i.location, i]));
  const advisories = [];
  for (const [entryName, entry] of Object.entries(found)) {
    const own = entry.via.filter(isRecord).map((a) => readAdvisory(entryName, a, semver));
    if (own.length === 0) continue;
    advisories.push(...own);
    const affectedHere = new Set();
    for (const a of own) {
      if (a.problem !== undefined) continue;
      a.affected = installs.filter((i) => i.name === a.name && semver.satisfies(i.version, a.range, anyRelease));
      for (const i of a.affected) {
        affectedHere.add(i.location);
        if (!entry.nodes.includes(i.location)) {
          a.problem = `affects ${i.location}, which the report's nodes leave out`;
        }
      }
    }
    for (const node of entry.nodes) {
      const install = byLocation.get(node);
      if (install?.name !== entryName) {
        problems.push(`npm audit report entry ${shown(entryName)} lists ${shown(node)}, not an installation of it`);
      } else if (!affectedHere.has(node)) {
        problems.push(`npm audit report entry ${shown(entryName)} lists ${shown(node)}, which none of its advisories affects`);
      }
    }
  }

  // One id must mean one package and one range wherever it appears.
  const byId = new Map();
  for (const a of advisories.filter((x) => x.problem === undefined)) {
    const first = byId.get(a.id);
    if (first === undefined) byId.set(a.id, a);
    else if (first.name !== a.name || first.range !== a.range) {
      first.problem = "appears with another package or range";
      a.problem = first.problem;
    }
  }
  const ranges = new Map();
  for (const a of advisories) {
    if (a.problem !== undefined) {
      problems.push(`${a.label} is not covered: it ${a.problem}`);
      continue;
    }
    const record = exceptions.find((x) => x.advisoryId === a.id && x.package === a.name);
    const versions = [...new Set(a.affected.map((i) => i.version))].sort(semver.compare);
    if (record === undefined) {
      problems.push(`${a.label} is not covered: no exception records it`);
    } else if (!sameSet(record.versions, versions)) {
      problems.push(
        `${a.label} is not covered: the exception records ${record.versions.join(", ")}, ` +
          `but the installed versions it affects are ${versions.join(", ") || "none"}`,
      );
    } else {
      ranges.set(record, a.range);
    }
  }
  for (const record of exceptions) {
    if (!advisories.some((a) => a.id === record.advisoryId && a.name === record.package)) {
      problems.push(`${policyFile}: ${record.advisoryId} in ${record.package} matches no advisory in the report`);
    }
  }
  return { problems, ranges: problems.length > 0 ? null : ranges };
}

// The registry's version list for one record. A stable release outside the advisory's range that
// is newer than a recorded version means an upgrade exists, so the record is out of date.
export function registryProblems(record, range, stdout, semver) {
  const at = `npm view ${record.package} versions`;
  let listed;
  try {
    listed = JSON.parse(stdout);
  } catch {
    return [`${at} did not print JSON`];
  }
  if (!Array.isArray(listed) || listed.length === 0 || !listed.every((v) => typeof v === "string")) {
    return [`${at} did not print a non-empty list of versions`];
  }
  const odd = listed.filter((v) => semver.valid(v) !== v);
  if (odd.length > 0) return [`${at} lists ${shown(odd[0])}, not an exact version`];
  const problems = [];
  for (const v of record.versions) {
    if (!listed.includes(v)) problems.push(`${at} does not list the recorded version ${v}`);
  }
  const oldest = [...record.versions].sort(semver.compare)[0];
  for (const v of listed) {
    if (semver.prerelease(v) === null && !semver.satisfies(v, range, anyRelease) && semver.gt(v, oldest)) {
      problems.push(
        `${record.advisoryId} in ${record.package} is out of date: ${v} is published, outside the ` +
          `advisory's range ${shown(range)} and newer than the recorded ${oldest}`,
      );
    }
  }
  return problems;
}
