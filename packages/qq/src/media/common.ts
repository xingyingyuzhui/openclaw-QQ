export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function normalizeInboundMediaSource(input: any): string {
  const v = String(input || "").trim().replace(/&amp;/g, "&");
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  if (/^base64:\/\//i.test(v)) return v;
  if (/^data:/i.test(v)) return v;
  if (/^file:\/\//i.test(v)) return v;
  if (v.startsWith("/")) return `file://${v}`;
  return "";
}

export function isImageFile(url: string): boolean {
  const l = url.toLowerCase();
  return l.endsWith(".jpg") || l.endsWith(".jpeg") || l.endsWith(".png") || l.endsWith(".gif") || l.endsWith(".webp");
}

export function isAudioFile(url: string): boolean {
  const l = url.toLowerCase();
  return l.endsWith(".mp3") || l.endsWith(".wav") || l.endsWith(".ogg") || l.endsWith(".m4a") || l.endsWith(".aac") || l.endsWith(".flac") || l.endsWith(".amr") || l.endsWith(".silk");
}

export function isVideoFile(url: string): boolean {
  const l = url.toLowerCase();
  return l.endsWith(".mp4") || l.endsWith(".mov") || l.endsWith(".m4v") || l.endsWith(".webm") || l.endsWith(".mkv") || l.endsWith(".avi");
}

export function isHttpLike(url: string): boolean {
  return /^https?:\/\//i.test(String(url || ""));
}

export function isBase64Like(url: string): boolean {
  return /^base64:\/\//i.test(String(url || ""));
}

export function isDataUriLike(url: string): boolean {
  return /^data:/i.test(String(url || ""));
}
