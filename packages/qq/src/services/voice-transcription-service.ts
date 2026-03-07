import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type VoiceTranscript = {
  text: string;
  durationSec?: number;
  language?: string;
  audioPath?: string;
};

function tryParseJsonObject(raw: string): any | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {}
  const begin = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (begin >= 0 && end > begin) {
    const sliced = text.slice(begin, end + 1);
    try {
      return JSON.parse(sliced);
    } catch {}
  }
  return null;
}

function isLikelyVoiceFileUrl(url: string): boolean {
  const s = String(url || "").toLowerCase();
  return (
    s.startsWith("file://") &&
    (s.includes(".amr") ||
      s.includes(".wav") ||
      s.includes(".mp3") ||
      s.includes(".m4a") ||
      s.includes(".ogg") ||
      s.includes(".silk"))
  );
}

export async function transcribeInboundVoiceOnce(params: {
  workspaceRoot: string;
  localFileUrls: string[];
  route: string;
  msgId: string;
}): Promise<VoiceTranscript | null> {
  const { workspaceRoot, localFileUrls, route, msgId } = params;
  const scriptPath = `${workspaceRoot}/skills/whisper-stt-local/scripts/transcribe.sh`;
  try {
    await fs.access(scriptPath);
  } catch {
    return null;
  }
  const voiceUrl = localFileUrls.find((u) => isLikelyVoiceFileUrl(u));
  if (!voiceUrl) return null;
  let audioPath = "";
  try {
    audioPath = decodeURIComponent(new URL(voiceUrl).pathname);
  } catch {
    return null;
  }
  if (!audioPath) return null;
  const startedAt = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync("bash", [scriptPath, audioPath, "zh", "small", "int8"], {
      cwd: workspaceRoot,
      timeout: 30_000,
      maxBuffer: 1024 * 1024 * 8,
    });
    const parsed = tryParseJsonObject(stdout) || tryParseJsonObject(stderr) || {};
    const transcriptText = String(parsed?.text || "").trim();
    const durationSec = Number(parsed?.duration || 0) || undefined;
    const language = String(parsed?.language || "").trim() || undefined;
    const elapsedMs = Date.now() - startedAt;
    if (!transcriptText) {
      console.warn(`[QQ][voice-transcribe] route=${route} msg_id=${msgId} result=empty duration_ms=${elapsedMs}`);
      return null;
    }
    console.log(
      `[QQ][voice-transcribe] route=${route} msg_id=${msgId} result=ok duration_ms=${elapsedMs} audio_seconds=${durationSec ?? 0}`,
    );
    return {
      text: transcriptText,
      durationSec,
      language,
      audioPath,
    };
  } catch (err: any) {
    const elapsedMs = Date.now() - startedAt;
    console.warn(
      `[QQ][voice-transcribe] route=${route} msg_id=${msgId} result=failed duration_ms=${elapsedMs} error=${err?.message || err}`,
    );
    return null;
  }
}
