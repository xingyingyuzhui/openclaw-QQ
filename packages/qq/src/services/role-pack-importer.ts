import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { compactParagraph, extractBullets, sanitizeLine } from "./role-pack-defaults.js";

export type ImportedSeed = {
  name: string;
  identity: string;
  relationship: string;
  style: string;
  examples: string;
  tags: string[];
  sourceLabel: string;
};

function normalizeSeed(input: Partial<ImportedSeed>, fallbackLabel: string): ImportedSeed {
  return {
    name: sanitizeLine(input.name || "未命名角色", "未命名角色"),
    identity: compactParagraph(input.identity || "你是一个需要保持稳定风格和关系边界的角色。", 240),
    relationship: compactParagraph(input.relationship || "根据当前会话关系自然交流，避免脱离上下文。", 220),
    style: compactParagraph(input.style || "自然、克制、有一致性。", 1200),
    examples: compactParagraph(input.examples || "", 1200),
    tags: Array.isArray(input.tags) ? input.tags.slice(0, 12).map((it) => sanitizeLine(String(it))) : [],
    sourceLabel: sanitizeLine(input.sourceLabel || fallbackLabel, fallbackLabel),
  };
}

export function parseCharacterJson(raw: string, label: string): ImportedSeed {
  const parsed = JSON.parse(raw || "{}");
  const data = parsed?.data && typeof parsed.data === "object" ? parsed.data : parsed;
  const description = data.description || data.character_description || data.personality || "";
  const scenario = data.scenario || data.world_scenario || "";
  const firstMes = data.first_mes || data.first_message || "";
  const mesExample = data.mes_example || data.example_dialogue || data.example_dialogues || "";
  const creator = data.creator_notes || data.system_prompt || data.post_history_instructions || "";
  return normalizeSeed(
    {
      name: data.name || data.character_name,
      identity: `${description}`.trim() || `${scenario}`.trim(),
      relationship: `${scenario}`.trim() || `${creator}`.trim(),
      style: [description, creator].filter(Boolean).join("\n\n"),
      examples: [firstMes, mesExample].filter(Boolean).join("\n\n"),
      tags: Array.isArray(data.tags) ? data.tags : [],
      sourceLabel: label,
    },
    label,
  );
}

function extractPngTextChunks(buffer: Buffer): string[] {
  const out: string[] = [];
  const pngSig = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== pngSig) return out;
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const len = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("latin1");
    const dataStart = offset + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > buffer.length) break;
    if (type === "tEXt" || type === "iTXt" || type === "zTXt") {
      out.push(buffer.subarray(dataStart, dataEnd).toString("latin1"));
    }
    offset = dataEnd + 4;
    if (type === "IEND") break;
  }
  return out;
}

export function parseCharacterPng(buffer: Buffer, label: string): ImportedSeed {
  const chunks = extractPngTextChunks(buffer);
  for (const chunk of chunks) {
    const idx = chunk.indexOf("chara");
    if (idx === -1) continue;
    const maybe = chunk.slice(idx + 5).replace(/^\0+/, "");
    const candidate = maybe.includes("{") ? maybe.slice(maybe.indexOf("{")) : maybe;
    const raw = Buffer.from(candidate.trim(), "base64").toString("utf8");
    if (raw && raw.trim().startsWith("{")) return parseCharacterJson(raw, label);
  }
  return normalizeSeed({ sourceLabel: label }, label);
}

export async function importSeedFromSource(params: {
  source: string;
  sourceType: "text" | "file";
}): Promise<ImportedSeed> {
  if (params.sourceType === "file") {
    const filePath = path.resolve(String(params.source || "").trim());
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".json") return parseCharacterJson(await fs.readFile(filePath, "utf8"), path.basename(filePath));
    if (ext === ".png") return parseCharacterPng(readFileSync(filePath), path.basename(filePath));
    const raw = await fs.readFile(filePath, "utf8");
    return normalizeSeed({ identity: raw, relationship: raw, style: raw, examples: raw, sourceLabel: path.basename(filePath) }, path.basename(filePath));
  }
  const raw = String(params.source || "").trim();
  return normalizeSeed({ identity: raw, relationship: raw, style: raw, examples: raw, sourceLabel: "inline-text" }, "inline-text");
}

export function buildImportedPersonaBits(seed: ImportedSeed) {
  return {
    name: seed.name,
    identity: seed.identity,
    relationship: seed.relationship,
    tone: extractBullets(seed.style, 6),
    directives: extractBullets(seed.style, 6),
    tags: seed.tags,
    style: seed.style || seed.identity,
    examples: seed.examples,
    sourceLabel: seed.sourceLabel,
  };
}
