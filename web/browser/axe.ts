import { AxeBuilder } from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

// The engine has no wcag22a tag and an unknown tag selects nothing, so it is never passed.
const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** The WCAG A and AA violations found on the page, or only inside `include` when one is named. */
export async function scan(page: Page, include?: string) {
  const builder = new AxeBuilder({ page }).withTags(tags);
  if (include !== undefined) builder.include(include);
  const results = await builder.analyze();
  const report = (kind: string, rule: (typeof results.violations)[number]) =>
    `${kind} ${rule.id}: ${rule.help}; targets ${JSON.stringify(rule.nodes.map((node) => node.target))}`;
  const ran =
    results.passes.length +
    results.violations.length +
    results.incomplete.length +
    results.inapplicable.length;
  // A configuration that selects no rule reports no violation, which must not read as a pass.
  if (ran === 0) throw new Error("scan: the configuration selected no rule");
  // Nobody reviews an unresolved result by hand, so it blocks without being called a violation.
  expect
    .soft(
      results.incomplete.map((rule) => report("incomplete", rule)),
      "incomplete results",
    )
    .toEqual([]);
  return results.violations.map((rule) => ({
    id: rule.id,
    line: report("violation", rule),
  }));
}
