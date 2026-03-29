import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const LINK_MODEL = "claude-sonnet-4-6";

type EventRow = {
  id: string;
  time: string;
  title: string;
  cause: string;
};

type CatalogEntry = { id: string; time: string; title: string };

type LinkUpdate = { id: string; next_event_ids: string[] };

type InferBatchResult =
  | { ok: true; updates: LinkUpdate[] }
  | { ok: false; rawText: string; reason: string };

/**
 * Claude 返答から JSON オブジェクト部分を取り出す。
 * - ```json ... ``` / ``` ... ``` ブロックがあれば中身を優先
 * - 先頭・末尾のフェンス行を除去
 * - 最初の `{` から最後の `}` までをスライス（前置き・後書きの除去）
 */
function sanitizeModelJsonText(raw: string): string {
  let s = raw.trim();
  const fenceBlock = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceBlock?.[1] != null) {
    s = fenceBlock[1].trim();
  } else {
    s = s
      .replace(/^```json\s*/gim, "")
      .replace(/^```\s*/gim, "")
      .replace(/\s*```\s*$/gim, "")
      .trim();
  }
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end > start) {
    s = s.slice(start, end + 1);
  }
  return s.trim();
}

function buildLinkUpdatesFromParsed(
  parsed: unknown,
  catalog: CatalogEntry[]
): LinkUpdate[] | null {
  if (!parsed || typeof parsed !== "object") return null;
  const rec = parsed as Record<string, unknown>;
  if (!Array.isArray(rec.updates)) return null;

  const validIds = new Set(catalog.map((c) => c.id));
  const out: LinkUpdate[] = [];

  for (const item of rec.updates) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : "";
    if (!id || !validIds.has(id)) continue;
    const rawNext = row.next_event_ids;
    const nextIds: string[] = [];
    if (Array.isArray(rawNext)) {
      for (const x of rawNext) {
        if (typeof x === "string" && validIds.has(x) && x !== id) {
          nextIds.push(x);
        }
      }
    }
    out.push({ id, next_event_ids: nextIds });
  }

  return out;
}

function parseLinkUpdatesFromModelText(
  rawText: string,
  catalog: CatalogEntry[]
): { updates: LinkUpdate[] } | null {
  const sanitized = sanitizeModelJsonText(rawText);
  if (!sanitized) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(sanitized);
  } catch {
    return null;
  }
  const updates = buildLinkUpdatesFromParsed(parsed, catalog);
  if (updates === null) return null;
  return { updates };
}

function createSupabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return createClient(url, key);
}

async function inferLinksWithClaude(
  client: Anthropic,
  primary: EventRow[],
  catalog: CatalogEntry[],
  batchIndex: number
): Promise<InferBatchResult> {
  const system = [
    "あなたは世界観年表の因果リンク推定AIです。",
    "ユーザーが渡す primary_events の各出来事について、時間的・因果的に「直接」続く出来事の id だけを next_event_ids に入れてください。該当がなければ next_event_ids は [] にしてください。",
    "",
    "【出力の厳守事項】",
    "- 返答本文はパース可能な JSON オブジェクト 1 つだけ。それ以外の文字（説明文、見出し、マークダウン、コードフェンス ``` や ```json）は一切書かない。",
    "- トップレベルのキーは updates のみ。値は配列。",
    "- 配列の各要素は { \"id\": string, \"next_event_ids\": string[] }。キー名と型を厳守。",
    "- 文字列は必ず二重引用符。末尾カンマやコメントは禁止（標準 JSON）。",
    "- id と next_event_ids の要素は、ユーザーが提示したカタログに存在する UUID 文字列のみ。自分自身の id は next_event_ids に含めない。",
  ].join("\n");

  const schemaExample =
    '{"updates":[{"id":"00000000-0000-4000-8000-000000000001","next_event_ids":["00000000-0000-4000-8000-000000000002"]},{"id":"00000000-0000-4000-8000-000000000003","next_event_ids":[]}]}';

  const user = `
全イベントの参照用カタログ（id は UUID。リンク先はここに含まれる id のみ使用）:
${JSON.stringify(catalog)}

このバッチで next_event_ids を決める対象（cause を重視）:
${JSON.stringify(primary)}

因果ルール:
- next_event_ids にはカタログに存在する id のみ。自分自身は不可。
- 「直接の次の出来事」に限定（間に他の主要イベントが挟まる場合はリンクしない）。
- 複数の独立した次があり得る場合は複数 id 可。

上記に従い、次と同じ構造の JSON のみを出力すること（例の UUID はダミー。実際はカタログの id を使う）:
${schemaExample}
`.trim();

  const response = await client.messages.create({
    model: LINK_MODEL,
    max_tokens: 8192,
    temperature: 0,
    system,
    messages: [{ role: "user", content: user }],
  });

  const textBlock = response.content.find((b) => b.type === "text") as
    | { type: string; text?: string }
    | undefined;
  const rawText = textBlock?.text ?? "";

  if (!rawText.trim()) {
    console.error(
      `[api/link-events] Batch ${batchIndex}: empty Claude text response (raw length 0)`
    );
    return { ok: false, rawText: "", reason: "empty_response" };
  }

  const parsed = parseLinkUpdatesFromModelText(rawText, catalog);
  if (!parsed) {
    console.error(
      `[api/link-events] Batch ${batchIndex}: JSON parse failed, raw response:\n`,
      rawText
    );
    return { ok: false, rawText, reason: "parse_error" };
  }

  return { ok: true, updates: parsed.updates };
}

async function applyUpdates(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  updates: LinkUpdate[]
): Promise<number> {
  let n = 0;
  for (const u of updates) {
    const { error } = await supabase
      .from("events")
      .update({ next_event_ids: u.next_event_ids })
      .eq("id", u.id);
    if (error) {
      console.error("[api/link-events] Update failed for", u.id, error.message);
      continue;
    }
    n += 1;
  }
  return n;
}

export async function POST(): Promise<Response> {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: "Missing ANTHROPIC_API_KEY environment variable." },
        { status: 500 }
      );
    }

    const supabase = createSupabaseServer();
    const { data: rows, error: fetchError } = await supabase
      .from("events")
      .select("id,time,title,cause")
      .order("time", { ascending: true });

    if (fetchError) {
      return Response.json(
        { error: "Failed to load events.", detail: fetchError.message },
        { status: 500 }
      );
    }

    const events = (rows ?? []) as EventRow[];
    if (events.length === 0) {
      return Response.json({ ok: true, total: 0, batches: 0, rowsUpdated: 0 });
    }

    const catalog: CatalogEntry[] = events.map((e) => ({
      id: e.id,
      time: e.time,
      title: e.title,
    }));

    const client = new Anthropic({ apiKey });
    const total = events.length;
    const chunkSize = total > 1000 ? 100 : total;
    let rowsUpdated = 0;
    let batchIndex = 0;
    let batchesSkipped = 0;

    for (let i = 0; i < events.length; i += chunkSize) {
      const primary = events.slice(i, i + chunkSize);
      batchIndex += 1;
      try {
        const result = await inferLinksWithClaude(client, primary, catalog, batchIndex);
        if (!result.ok) {
          batchesSkipped += 1;
          continue;
        }
        const applied = await applyUpdates(supabase, result.updates);
        rowsUpdated += applied;
      } catch (err) {
        console.error(`[api/link-events] Batch ${batchIndex} API error:`, err);
        const message = err instanceof Error ? err.message : String(err);
        return Response.json(
          {
            error: "Link inference failed.",
            detail: message,
            batchesCompleted: batchIndex - 1,
            rowsUpdated,
            batchesSkipped,
          },
          { status: 500 }
        );
      }
    }

    return Response.json({
      ok: true,
      total,
      batches: batchIndex,
      rowsUpdated,
      batchesSkipped,
    });
  } catch (err) {
    console.error("[api/link-events] Failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: "Failed to link events.", detail: message },
      { status: 500 }
    );
  }
}
