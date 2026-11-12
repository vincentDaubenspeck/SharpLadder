import Ajv from "ajv";
import { checkedHintsView } from "../content/hints.ts";
import type { HintsView } from "../content/hints.ts";

// The closed shape of a hints view. A full hints record, a catalogue or any extra field fails
// here before a view is drawn; checkedHintsView then checks how the parts relate.
const hintsViewSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  additionalProperties: false,
  required: ["type", "options", "selectedIndex", "segments"],
  properties: {
    type: { const: "hints-view" },
    options: {
      type: "array",
      minItems: 1,
      maxItems: 26,
      items: { $ref: "#/definitions/option" },
    },
    selectedIndex: {
      oneOf: [{ type: "null" }, { $ref: "#/definitions/position" }],
    },
    selected: { $ref: "#/definitions/selected" },
    segments: {
      type: "array",
      maxItems: 1,
      items: { $ref: "#/definitions/segment" },
    },
  },
  definitions: {
    position: { type: "integer", minimum: 0, maximum: 25 },
    option: {
      type: "object",
      additionalProperties: false,
      required: ["id", "label"],
      properties: {
        id: { $ref: "#/definitions/position" },
        label: { type: "string", pattern: "^Approach [A-Z](?![\\s\\S])" },
      },
    },
    ladderId: {
      type: "string",
      pattern: "^ladder-[a-z0-9-]{1,41}(?![\\s\\S])",
    },
    selected: {
      type: "object",
      additionalProperties: false,
      required: ["id", "blockId", "cue"],
      properties: {
        id: { $ref: "#/definitions/ladderId" },
        blockId: {
          type: "string",
          pattern: "^ladder-[a-z0-9-]{1,41}/b1(?![\\s\\S])",
        },
        cue: { type: "string", minLength: 1 },
      },
    },
    segment: {
      type: "object",
      additionalProperties: false,
      required: ["target", "text"],
      properties: {
        target: {
          type: "object",
          additionalProperties: false,
          required: ["type", "blockId"],
          properties: {
            type: { const: "block" },
            blockId: { type: "string" },
          },
        },
        text: { type: "string", minLength: 1 },
      },
    },
  },
} as const;

// The strict options refuse a keyword, default or number the schema does not mean.
const ajv = new Ajv({
  allErrors: true,
  strictKeywords: true,
  strictDefaults: true,
  strictNumbers: true,
});
const validate = ajv.compile(hintsViewSchema);

/** The value as a hints view, or an error naming each way it leaves the closed shape. */
export function validHintsView(value: unknown): HintsView {
  const valid = validate(value);
  if (valid !== true)
    throw new Error(`not a hints view: ${ajv.errorsText(validate.errors)}`);
  return checkedHintsView(value as HintsView);
}
