import valueParser from "postcss-value-parser";

// No exponent, no leading zero, no trailing fractional zero and at most four places, so
// every accepted spelling names one exact multiple of 0.0001.
const magnitude = /^(?:0|[1-9][0-9]{0,5})(?:\.[0-9]{0,3}[1-9])?$/;

/** The value is an integer in units of 0.0001, built digit by digit so no float rounds it. */
export function decimalToken(word, { signed = false } = {}) {
  const u = valueParser.unit(word);
  if (!u) return undefined;
  let text = u.number;
  let negative = false;
  if (text.startsWith("-")) {
    if (!signed) return undefined;
    negative = true;
    text = text.slice(1);
  }
  if (!magnitude.test(text)) return undefined;
  const [whole, fraction = ""] = text.split(".");
  let scaled = 0;
  for (const digit of whole + fraction.padEnd(4, "0")) {
    scaled = scaled * 10 + (digit.charCodeAt(0) - 48);
  }
  if (negative && scaled === 0) return undefined;
  return { negative, scaled, unit: u.unit.toLowerCase() };
}

const maxThickness = 40000;

// Zero is spelled bare 0 only, so this agrees with length-zero-no-unit.
const inRange = (d) =>
  d.unit === "px" && d.scaled > 0 && d.scaled <= maxThickness;

/** Bare 0 or unsigned px above 0 up to 4px; every other unit, keyword and function fails. */
export function isThickness(word) {
  const d = decimalToken(word);
  if (d === undefined) return false;
  if (d.unit === "") return word === "0";
  return inRange(d);
}

/** Bare 0 or px from -4px to 4px; a negative zero never parses. */
export function isOutlineOffset(word) {
  const d = decimalToken(word, { signed: true });
  if (d === undefined) return false;
  if (d.unit === "") return word === "0";
  return inRange(d);
}

/** Only 100% is opaque, so this agrees with alpha-value-notation; 1, 1.0 and 100.0% are not. */
export function isOpaqueAlpha(word) {
  return word === "100%";
}
