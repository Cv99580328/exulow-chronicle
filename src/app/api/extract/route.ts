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

export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as Partial<ExtractRequestBody>;
    if (!body || typeof body.text !== "string") {
      return Response.json(
        { error: "Invalid request body. Expected { text: string }." },
        { status: 400 }
      );
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: "Missing ANTHROPIC_API_KEY environment variable." },
        { status: 500 }
      );
    }

    const client = new Anthropic({ apiKey });

    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        events: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              time: { type: "string" },
              title: { type: "string" },
              cause: { type: "string" },
              event: { type: "string" },
              result: { type: "string" },
            },
            required: ["time", "title", "cause", "event", "result"],
          },
        },
      },
      required: ["events"],
    } as const;

    const systemPrompt =
      "あなたは『エクスロー』の世界観整理AIです。ユーザーが渡すテキストから、因果関係が明確な出来事を抽出してください。必ず、指定されたJSONスキーマに厳密に従ってください。";

    const userPrompt = `
以下のテキストから、年表として扱える因果イベントを抽出してください。

- events は 1〜6件程度
- time は物語内の年代表現（例:「1万年前」「87年前」）。推定できない場合は "不明" と明記。
- title は出来事の短い題名
- cause / event / result はそれぞれ原文の内容を要約した文章

必ず以下のJSON形式のみで返答してください。説明文は不要です：
{"events":[{"time":"...","title":"...","cause":"...","event":"...","result":"..."}]}

--- テキスト ---
${body.text}
`.trim();

    const response = await client.messages.create({
      model: "claude-opus-4-5-20251101",
      max_tokens: 1200,
      temperature: 0,
      system: systemPrompt,
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
      return Response.json(
        { error: "Claude returned no text content." },
        { status: 502 }
      );
    }

    const sanitized = textBlock.text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();

    const parsed = JSON.parse(sanitized) as ExtractResponse;
    if (!parsed || !Array.isArray(parsed.events)) {
      return Response.json(
        { error: "Claude returned invalid JSON shape." },
        { status: 502 }
      );
    }

    return Response.json(parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: "Failed to extract events.", detail: message },
      { status: 500 }
    );
  }
}

