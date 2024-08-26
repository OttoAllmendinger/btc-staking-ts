import { Miniscript } from "@bitgo/wasm-miniscript";

function formatArg(arg: unknown): string {
  if (Buffer.isBuffer(arg)) {
    return arg.toString("hex");
  }

  if (arg instanceof Miniscript) {
    return arg.toString();
  }

  switch (typeof arg) {
    case "string":
    case "number":
      return arg.toString();
    default:
      throw new Error(`Unsupported type: ${typeof arg}`);
  }
}

function flatArray(arr: unknown[]): unknown {
  if (arr.every((e) => Buffer.isBuffer(e) || e instanceof Miniscript || typeof e === "string" || typeof e === "number")) {
    return arr.map((e) => formatArg(e)).join(",");
  }

  throw new Error("Unsupported type");
}

function formatMs(str: string, arg: unknown): string {
  console.log("formatMs", { str, arg });
  str = str.replace(/\s+/g, "");
  if (arg === undefined) {
    return str;
  }

  if (Array.isArray(arg)) {
    return formatMs(str, flatArray(arg));
  }

  return str + formatArg(arg);
}

function formatMsVararg(
  strings: TemplateStringsArray,
  ...args: unknown[]
): Miniscript {
  const msString = strings.reduce((acc, str, i) => {
    return acc + formatMs(str, args[i]);
  }, "");
  console.log("msString", msString);
  return Miniscript.fromString(msString, "tap");
}

export const miniscript = formatMsVararg;
