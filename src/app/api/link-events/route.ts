import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const LINK_MODEL = "claude-opus-4-5-20251101";

type EventRow = {
  id: string;
  time: string;
  title: string;
  cause: string;
};

type CatalogEntry = { id: string; time: string; title: string };

type LinkUpdate = { id: string; next_event_ids: string[] };

function sanitizeModelJsonText(raw: string): string {
  return raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
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
  catalog: CatalogEntry[]
): Promise<LinkUpdate[]> {
  const system =
    "あなたは世界観年表の因果リンク推定AIです。primary_events の各出来事について、時間的・因果的に直接続く出来事の id のみを next_event_ids に列挙してください。推測が難しい場合は空配列にしてください。必ず指定JSONのみを返します。";

  const user = `
全イベントの参照用カタログ（id は UUID 文字列）:
${JSON.stringify(catalog)}

このバッチで next_event_ids を決める対象（各 cause を重視）:
${JSON.stringify(primary)}

ルール:
- next_event_ids に入れるのはカタログに存在する id のみ。自分自身の id は含めない。
- 「直接の次の出来事」に限定（間に他の主要イベントが挟まる場合はリンクしない）。
- 複数の独立した次があり得る場合は複数 id 可。

次のJSONのみで返答:
{"updates":[{"id":"<uuid>","next_event_ids":["<uuid>",...]}]}
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
  if (!textBlock?.text) {
    throw new Error("Claude returned no text content.");
  }

  const sanitized = sanitizeModelJsonText(textBlock.text);
  let parsed: { updates?: unknown };
  try {
    parsed = JSON.parse(sanitized) as { updates?: unknown };
  } catch {
    throw new Error("Claude returned invalid JSON.");
  }
  if (!parsed || !Array.isArray(parsed.updates)) {
    throw new Error("Claude returned invalid JSON shape.");
  }

  const out: LinkUpdate[] = [];
  const validIds = new Set(catalog.map((c) => c.id));

  for (const item of parsed.updates) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id : "";
    if (!id || !validIds.has(id)) continue;
    const rawNext = rec.next_event_ids;
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

    for (let i = 0; i < events.length; i += chunkSize) {
      const primary = events.slice(i, i + chunkSize);
      batchIndex += 1;
      try {
        const updates = await inferLinksWithClaude(client, primary, catalog);
        const applied = await applyUpdates(supabase, updates);
        rowsUpdated += applied;
      } catch (err) {
        console.error(`[api/link-events] Batch ${batchIndex} failed:`, err);
        const message = err instanceof Error ? err.message : String(err);
        return Response.json(
          {
            error: "Link inference failed.",
            detail: message,
            batchesCompleted: batchIndex - 1,
            rowsUpdated,
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
