import { constants, type BigIntStats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { extname } from "node:path";

export const MAX_EDITABLE_BYTES = 1_048_576;

export type EditableFormat = "markdown" | "plain-text" | "json" | "jsonc" | "toml" | "yaml";
export type NewlineStyle = "lf" | "crlf" | "mixed";
export type LineEnding = "\n" | "\r\n" | "\r";

export type FormatPolicy = {
  id: EditableFormat;
  label: "Markdown" | "Plain text" | "JSON" | "JSONC" | "TOML" | "YAML";
};

export type EditValidation =
  | { status: "not-required"; message: "No validation required" }
  | { status: "valid"; message: "Valid JSON" }
  | { status: "not-performed"; message: "Not validated; content will be preserved exactly" };

export type EncodingPolicy = {
  hasUtf8Bom: boolean;
  newlineStyle: NewlineStyle;
  lineEndings: readonly LineEnding[];
};

export type EditableTargetRevision = Readonly<{
  device: string;
  inode: string;
  size: string;
  mode: number;
  uid: number;
  gid: number;
  modifiedNs: string;
  changedNs: string;
}>;

export type EditableBytes = {
  bytes: Buffer;
  revision: EditableTargetRevision;
};

export type DecodedEditableBytes = {
  content: string;
  editorContent: string;
  hasUtf8Bom: boolean;
  newlineStyle: NewlineStyle;
  newlineByteOverheadMap: string;
  lineEndings: LineEnding[];
};

export class EditableArtifactError extends Error {
  readonly status: number;
  readonly code: string;
  readonly technicalDetails?: Readonly<Record<string, number>>;

  constructor(status: number, code: string, message: string, technicalDetails?: Readonly<Record<string, number>>) {
    super(message);
    this.status = status;
    this.code = code;
    this.technicalDetails = technicalDetails;
  }
}

const FORMAT_BY_EXTENSION = new Map<string, FormatPolicy>([
  [".md", { id: "markdown", label: "Markdown" }],
  [".txt", { id: "plain-text", label: "Plain text" }],
  [".json", { id: "json", label: "JSON" }],
  [".jsonc", { id: "jsonc", label: "JSONC" }],
  [".toml", { id: "toml", label: "TOML" }],
  [".yaml", { id: "yaml", label: "YAML" }],
  [".yml", { id: "yaml", label: "YAML" }],
]);

export function formatPolicyFor(artifactIdentity: string): FormatPolicy | undefined {
  return FORMAT_BY_EXTENSION.get(extname(artifactIdentity).toLowerCase());
}

function targetRevision(info: BigIntStats): EditableTargetRevision {
  return {
    device: info.dev.toString(),
    inode: info.ino.toString(),
    size: info.size.toString(),
    mode: Number(info.mode & 0o7777n),
    uid: Number(info.uid),
    gid: Number(info.gid),
    modifiedNs: info.mtimeNs.toString(),
    changedNs: info.ctimeNs.toString(),
  };
}

export async function readEditableBytes(path: string): Promise<EditableBytes> {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await file.stat({ bigint: true });
    if (!before.isFile()) throw new EditableArtifactError(409, "artifact-changed", "The selected artifact is no longer a regular file.");
    if (before.size > BigInt(MAX_EDITABLE_BYTES)) {
      throw new EditableArtifactError(413, "artifact-too-large", "The selected artifact is larger than one MiB.");
    }
    const buffer = Buffer.allocUnsafe(MAX_EDITABLE_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const after = await file.stat({ bigint: true });
    const beforeRevision = targetRevision(before);
    const afterRevision = targetRevision(after);
    const pathInfo = await lstat(path, { bigint: true }).catch(() => undefined);
    if (
      offset > MAX_EDITABLE_BYTES
      || after.size > BigInt(MAX_EDITABLE_BYTES)
      || JSON.stringify(beforeRevision) !== JSON.stringify(afterRevision)
      || !pathInfo?.isFile()
      || pathInfo.isSymbolicLink()
      || JSON.stringify(targetRevision(pathInfo)) !== JSON.stringify(afterRevision)
    ) {
      throw new EditableArtifactError(409, "artifact-changed", "The selected artifact changed while it was being opened.");
    }
    return {
      bytes: Buffer.from(buffer.subarray(0, offset)),
      revision: afterRevision,
    };
  } catch (error) {
    if (error instanceof EditableArtifactError) throw error;
    throw new EditableArtifactError(403, "artifact-unreadable", "The selected artifact could not be read.");
  } finally {
    await file?.close().catch(() => undefined);
  }
}

export function decodeEditableBytes(bytes: Buffer): DecodedEditableBytes {
  const hasUtf8Bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(hasUtf8Bom ? bytes.subarray(3) : bytes);
  } catch {
    throw new EditableArtifactError(415, "artifact-not-utf8", "The selected artifact is not valid UTF-8 text.");
  }
  if (content.includes("\0")) {
    throw new EditableArtifactError(415, "artifact-binary", "The selected artifact contains binary data.");
  }
  const lineEndings = content.match(/\r\n|\r|\n/g) as LineEnding[] | null;
  const endingKinds = new Set(lineEndings ?? []);
  const newlineStyle = endingKinds.size > 1 || endingKinds.has("\r")
    ? "mixed"
    : endingKinds.has("\r\n") ? "crlf" : "lf";
  return {
    content,
    editorContent: content.replaceAll("\r\n", "\n").replaceAll("\r", "\n"),
    hasUtf8Bom,
    newlineStyle,
    newlineByteOverheadMap: newlineStyle === "mixed"
      ? (lineEndings ?? []).map((ending) => ending === "\r\n" ? "1" : "0").join("")
      : "",
    lineEndings: lineEndings ?? [],
  };
}

export function encodePendingEdit(content: string, encoding: EncodingPolicy): Buffer {
  if (content.includes("\0")) {
    throw new EditableArtifactError(415, "artifact-binary", "The Pending Edit contains binary data.");
  }
  if (content.replaceAll("\r\n", "").includes("\r")) {
    throw new EditableArtifactError(422, "newline-invalid", "The pending edit contains unsupported carriage returns.");
  }
  const lfContent = content.replaceAll("\r\n", "\n");
  const lines = lfContent.split("\n");
  const defaultEnding = encoding.newlineStyle === "crlf" ? "\r\n" : "\n";
  let normalized = lines[0] ?? "";
  for (let index = 1; index < lines.length; index += 1) {
    normalized += (encoding.lineEndings[index - 1] ?? defaultEnding) + lines[index];
  }
  const textBytes = Buffer.from(normalized, "utf8");
  const bytes = encoding.hasUtf8Bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), textBytes]) : textBytes;
  if (bytes.length > MAX_EDITABLE_BYTES) {
    throw new EditableArtifactError(413, "edited-content-too-large", "The Pending Edit is larger than one MiB.");
  }
  return bytes;
}

export function validatePendingEdit(format: EditableFormat, content: string): EditValidation {
  if (format === "markdown" || format === "plain-text") {
    return { status: "not-required", message: "No validation required" };
  }
  if (format !== "json") {
    return { status: "not-performed", message: "Not validated; content will be preserved exactly" };
  }
  try {
    JSON.parse(content);
    return { status: "valid", message: "Valid JSON" };
  } catch {
    const position = jsonErrorPosition(content);
    const { line, column } = lineAndColumn(content, position);
    throw new EditableArtifactError(
      422,
      "json-invalid",
      "The Pending Edit is not valid JSON.",
      { line, column },
    );
  }
}

class JsonPositionError extends Error {
  readonly position: number;

  constructor(position: number) {
    super("invalid-json");
    this.position = position;
  }
}

function jsonErrorPosition(source: string): number {
  let position = 0;
  const fail = (at = position): never => { throw new JsonPositionError(at); };
  const whitespace = () => {
    while (position < source.length && (source[position] === " " || source[position] === "\t" || source[position] === "\r" || source[position] === "\n")) position += 1;
  };
  const literal = (value: string) => {
    for (const expected of value) {
      if (source[position] !== expected) fail();
      position += 1;
    }
  };
  const string = () => {
    if (source[position] !== '"') fail();
    position += 1;
    while (position < source.length) {
      const character = source[position]!;
      if (character === '"') {
        position += 1;
        return;
      }
      if (character.charCodeAt(0) <= 0x1f) fail();
      if (character !== "\\") {
        position += 1;
        continue;
      }
      position += 1;
      const escaped = source[position];
      if (escaped === "u") {
        position += 1;
        for (let count = 0; count < 4; count += 1) {
          if (!/[0-9a-f]/i.test(source[position] ?? "")) fail();
          position += 1;
        }
      } else if (escaped && '"\\/bfnrt'.includes(escaped)) {
        position += 1;
      } else {
        fail();
      }
    }
    fail(source.length);
  };
  const number = () => {
    if (source[position] === "-") position += 1;
    if (source[position] === "0") {
      position += 1;
      if (/\d/.test(source[position] ?? "")) fail();
    } else {
      if (!/[1-9]/.test(source[position] ?? "")) fail();
      while (/\d/.test(source[position] ?? "")) position += 1;
    }
    if (source[position] === ".") {
      position += 1;
      if (!/\d/.test(source[position] ?? "")) fail();
      while (/\d/.test(source[position] ?? "")) position += 1;
    }
    if (source[position] === "e" || source[position] === "E") {
      position += 1;
      if (source[position] === "+" || source[position] === "-") position += 1;
      if (!/\d/.test(source[position] ?? "")) fail();
      while (/\d/.test(source[position] ?? "")) position += 1;
    }
  };
  const value = (): void => {
    whitespace();
    const character = source[position];
    if (character === '"') return string();
    if (character === "t") return literal("true");
    if (character === "f") return literal("false");
    if (character === "n") return literal("null");
    if (character === "-" || /\d/.test(character ?? "")) return number();
    if (character === "[") {
      position += 1;
      whitespace();
      if (source[position] === "]") {
        position += 1;
        return;
      }
      while (true) {
        value();
        whitespace();
        if (source[position] === "]") {
          position += 1;
          return;
        }
        if (source[position] !== ",") fail();
        position += 1;
        whitespace();
      }
    }
    if (character === "{") {
      position += 1;
      whitespace();
      if (source[position] === "}") {
        position += 1;
        return;
      }
      while (true) {
        string();
        whitespace();
        if (source[position] !== ":") fail();
        position += 1;
        value();
        whitespace();
        if (source[position] === "}") {
          position += 1;
          return;
        }
        if (source[position] !== ",") fail();
        position += 1;
        whitespace();
      }
    }
    fail();
  };
  try {
    value();
    whitespace();
    if (position !== source.length) fail();
  } catch (error) {
    if (error instanceof JsonPositionError) return error.position;
    return Math.min(position, source.length);
  }
  return source.length;
}

function lineAndColumn(source: string, position: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let index = 0; index < position; index += 1) {
    if (source[index] === "\r" && source[index + 1] === "\n") {
      line += 1;
      column = 1;
      index += 1;
    } else if (source[index] === "\n" || source[index] === "\r") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}
