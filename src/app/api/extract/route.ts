import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";

type ExtractRequestBody = {
  text: string;
};

type ExtractEvent = {
  time: string;
  title: string;
  cause: string;
  event: string;
  result: string;
};

type ExtractResponse = {
  events: ExtractEvent[];
};

const MAX_CHUNK_CHARS = 8000;
const PARA_JOIN = "\n\n";

/**
 * 空行2行以上で段落分割：改行が3回以上連続する箇所（空行が2行続く）を区切りとする。
 */
function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/(?:\r?\n){3,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** 段落を順に結合し、8000文字を超えたらチャンクを確定 */
function buildChunks(paragraphs: string[]): string[] {
  const chunks: string[] = [];
  let parts: string[] = [];
  let len = 0;

  for (const p of paragraphs) {
    if (p.length > MAX_CHUNK_CHARS) {
      if (parts.length > 0) {
        chunks.push(parts.join(PARA_JOIN));
        parts = [];
        len = 0;
      }
      chunks.push(p);
      continue;
    }

    const addLen = len > 0 ? PARA_JOIN.length + p.length : p.length;
    if (len + addLen > MAX_CHUNK_CHARS && parts.length > 0) {
      chunks.push(parts.join(PARA_JOIN));
      parts = [p];
      len = p.length;
    } else {
      parts.push(p);
      len += addLen;
    }
  }

  if (parts.length > 0) {
    chunks.push(parts.join(PARA_JOIN));
  }

  return chunks;
}

function dedupeEventsByTitle(events: ExtractEvent[]): ExtractEvent[] {
  const seen = new Set<string>();
  const out: ExtractEvent[] = [];
  for (const e of events) {
    const t = (e.title ?? "").trim();
    if (t.length === 0) {
      out.push(e);
      continue;
    }
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(e);
  }
  return out;
}

function sanitizeModelJsonText(raw: string): string {
  return raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

const SYSTEM_PROMPT =
  "あなたは『エクスロー』の世界観整理AIです。ユーザーが渡すテキストから、因果関係が明確な出来事を抽出してください。必ず、指定されたJSONスキーマに厳密に従ってください。";

const USER_PROMPT_PREFIX = `
以下のテキストから、年表として扱える因果イベントを抽出してください。

- events は 1〜6件程度
- time は物語内の年代表現（例:「1万年前」「87年前」）。推定できない場合は "不明" と明記。
- title は出来事の短い題名
- cause / event / result はそれぞれ原文の内容を要約した文章

必ず以下のJSON形式のみで返答してください。説明文は不要です：
{"events":[{"time":"...","title":"...","cause":"...","event":"...","result":"..."}]}
`.trim();

async function extractEventsFromChunk(
  client: Anthropic,
  chunkText: string
): Promise<ExtractEvent[]> {
  const userPrompt = `${USER_PROMPT_PREFIX}

--- テキスト ---
${chunkText}`.trim();

  const response = await client.messages.create({
    model: "claude-opus-4-5-20251101",
    max_tokens: 1200,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: userPrompt,
      },
    ],
  });

  const textBlock = response.content.find(
    (block) => block.type === "text"
  ) as { type: string; text?: string } | undefined;

  if (!textBlock?.text) {
    throw new Error("Claude returned no text content.");
  }

  const sanitized = sanitizeModelJsonText(textBlock.text);
  let parsed: ExtractResponse;
  try {
    parsed = JSON.parse(sanitized) as ExtractResponse;
  } catch {
    throw new Error("Claude returned invalid JSON.");
  }
  if (!parsed || !Array.isArray(parsed.events)) {
    throw new Error("Claude returned invalid JSON shape.");
  }

  return parsed.events;
}

export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as Partial<ExtractRequestBody>;
    if (!body || typeof body.text !== "string") {
      return Response.json(
        { error: "Invalid request body. Expected { text: string }." },
        { status: 400 }
      );
    }

    if (body.text.length < 100) {
      return Response.json({ events: [] } satisfies ExtractResponse);
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: "Missing ANTHROPIC_API_KEY environment variable." },
        { status: 500 }
      );
    }

    const client = new Anthropic({ apiKey });

    const paragraphs = splitIntoParagraphs(body.text);
    const chunks =
      paragraphs.length > 0
        ? buildChunks(paragraphs)
        : [body.text.trim()].filter((s) => s.length > 0);

    if (chunks.length === 0) {
      return Response.json({ events: [] } satisfies ExtractResponse);
    }

    const allEvents: ExtractEvent[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      try {
        const events = await extractEventsFromChunk(client, chunk);
        allEvents.push(...events);
      } catch (chunkErr) {
        console.error(
          `[api/extract] Chunk ${i + 1}/${chunks.length} failed (skipped):`,
          chunkErr
        );
      }
    }

    const merged = dedupeEventsByTitle(allEvents);
    return Response.json({ events: merged } satisfies ExtractResponse);
  } catch (err) {
    console.error("[api/extract] Failed to extract events:", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: "Failed to extract events.", detail: message },
      { status: 500 }
    );
  }
}
