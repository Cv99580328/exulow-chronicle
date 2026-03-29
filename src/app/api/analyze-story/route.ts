import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";

export const runtime = "nodejs";

const MODEL = "claude-sonnet-4-6";
const MAX_INPUT_CHARS = 180_000;

type AnalyzeRequestBody = {
  source_file?: string;
};

type ExtractedCharacter = {
  display_name: string;
  profile: string;
  gender: string | null;
  abilities_summary: string;
};

type ExtractedRelationship = {
  from_name: string;
  to_name: string;
  relation_type: string;
  summary: string;
};

type ExtractedFaction = {
  name: string;
  faction_kind: string;
  description: string;
};

type AnalyzeResult = {
  display_title: string;
  era_primary: string | null;
  stage_summary: string | null;
  synopsis: string | null;
  characters: ExtractedCharacter[];
  factions: ExtractedFaction[];
  relationships: ExtractedRelationship[];
};

function createSupabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return createClient(url, key);
}

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

function stableSlug(prefix: "c" | "f", sourceFile: string, key: string): string {
  const normalized = key.trim().toLowerCase();
  const h = createHash("sha256")
    .update(`${prefix}\n${sourceFile}\n${normalized}`)
    .digest("hex")
    .slice(0, 28);
  return `${prefix}_${h}`;
}

function parseAnalyzeResult(rawText: string): AnalyzeResult | null {
  const sanitized = sanitizeModelJsonText(rawText);
  if (!sanitized) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(sanitized);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;

  const display_title = typeof o.display_title === "string" ? o.display_title.trim() : "";
  if (!display_title) return null;

  const era_primary =
    typeof o.era_primary === "string" ? o.era_primary.trim() || null : null;
  const stage_summary =
    typeof o.stage_summary === "string" ? o.stage_summary.trim() || null : null;
  const synopsis =
    typeof o.synopsis === "string" ? o.synopsis.trim() || null : null;

  const characters: ExtractedCharacter[] = [];
  if (Array.isArray(o.characters)) {
    for (const item of o.characters) {
      if (!item || typeof item !== "object") continue;
      const c = item as Record<string, unknown>;
      const display_name =
        typeof c.display_name === "string" ? c.display_name.trim() : "";
      if (!display_name) continue;
      characters.push({
        display_name,
        profile: typeof c.profile === "string" ? c.profile.trim() : "",
        gender:
          typeof c.gender === "string" && c.gender.trim()
            ? c.gender.trim()
            : null,
        abilities_summary:
          typeof c.abilities_summary === "string" ? c.abilities_summary.trim() : "",
      });
    }
  }

  const factions: ExtractedFaction[] = [];
  if (Array.isArray(o.factions)) {
    for (const item of o.factions) {
      if (!item || typeof item !== "object") continue;
      const f = item as Record<string, unknown>;
      const name = typeof f.name === "string" ? f.name.trim() : "";
      if (!name) continue;
      factions.push({
        name,
        faction_kind:
          typeof f.faction_kind === "string" && f.faction_kind.trim()
            ? f.faction_kind.trim()
            : "other",
        description:
          typeof f.description === "string" ? f.description.trim() : "",
      });
    }
  }

  const relationships: ExtractedRelationship[] = [];
  if (Array.isArray(o.relationships)) {
    for (const item of o.relationships) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      const from_name = typeof r.from_name === "string" ? r.from_name.trim() : "";
      const to_name = typeof r.to_name === "string" ? r.to_name.trim() : "";
      if (!from_name || !to_name) continue;
      relationships.push({
        from_name,
        to_name,
        relation_type: typeof r.relation_type === "string" ? r.relation_type.trim() : "other",
        summary: typeof r.summary === "string" ? r.summary.trim() : "",
      });
    }
  }

  return {
    display_title,
    era_primary,
    stage_summary,
    synopsis,
    characters,
    factions,
    relationships,
  };
}

export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as AnalyzeRequestBody;
    const sourceFile =
      typeof body.source_file === "string" ? body.source_file.trim() : "";
    if (!sourceFile) {
      return Response.json(
        { error: "Invalid body. Expected { source_file: string }." },
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase: any = createSupabaseServer();

    const { data: row, error: fetchError } = await supabase
      .from("source_files")
      .select("source_file,content")
      .eq("source_file", sourceFile)
      .maybeSingle();

    if (fetchError) {
      return Response.json(
        { error: "Failed to load source file.", detail: fetchError.message },
        { status: 500 }
      );
    }
    if (!row || typeof row.content !== "string") {
      return Response.json(
        { error: "source_file not found or has no content." },
        { status: 404 }
      );
    }

    const fullText = row.content as string;
    const truncated = fullText.length > MAX_INPUT_CHARS;
    const textForModel = truncated ? fullText.slice(0, MAX_INPUT_CHARS) : fullText;

    const system = [
      "あなたは長編ファンタジー作品の構造化抽出AIです。",
      "ユーザーが渡す本文から、指定されたキーだけを持つ JSON オブジェクト 1 つを返してください。",
      "説明文・マークダウン・コードフェンスは禁止。標準 JSON のみ。",
      "synopsis はおおよそ 80〜120 文字の日本語で要約してください。",
      "登場人物・組織は作品に実際に現れる重要なものに絞って最大 30 件程度まで。",
    ].join("\n");

    const user = `
作品キー（識別用）: ${JSON.stringify(sourceFile)}
${truncated ? `（注意: 本文は先頭 ${MAX_INPUT_CHARS} 文字までに切り詰めています）\n` : ""}
--- 本文 ---
${textForModel}

次のキー構造の JSON のみを返してください:
{
  "display_title": "作品の正式タイトルまたは最も適切なタイトル",
  "era_primary": "物語の主な時代・年代表現（不明なら null）",
  "stage_summary": "舞台・世界の概要（2〜4文）",
  "synopsis": "あらすじ 80〜120 文字程度",
  "characters": [
    {
      "display_name": "名前",
      "profile": "人物像・立場の要約",
      "gender": "male | female | other | unknown など、不明なら null",
      "abilities_summary": "能力・特筆スキルの要約（なければ空文字）"
    }
  ],
  "factions": [
    {
      "name": "組織名",
      "faction_kind": "nation | religion | guild | military | clan | company | other のいずれか",
      "description": "勢力の概要"
    }
  ],
  "relationships": [
    {
      "from_name": "キャラクター名A",
      "to_name": "キャラクター名B",
      "relation_type": "家族 | 友人 | 恋人 | 師弟 | 敵対 | 主従 | 協力 | その他 のいずれか",
      "summary": "関係の説明（1〜2文）"
    }
  ]
}
`.trim();

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      temperature: 0,
      system,
      messages: [{ role: "user", content: user }],
    });

    const textBlock = response.content.find((b) => b.type === "text") as
      | { type: string; text?: string }
      | undefined;
    const rawText = textBlock?.text ?? "";
    const parsed = parseAnalyzeResult(rawText);
    if (!parsed) {
      console.error("[api/analyze-story] JSON parse failed, raw:\n", rawText);
      return Response.json(
        { error: "Failed to parse Claude response as JSON.", truncated },
        { status: 502 }
      );
    }

    const nowIso = new Date().toISOString();

    const { data: storyUpsert, error: storyErr } = await supabase
      .from("stories")
      .upsert(
        {
          source_file: sourceFile,
          display_title: parsed.display_title,
          era_primary: parsed.era_primary,
          stage_summary: parsed.stage_summary,
          synopsis: parsed.synopsis,
          metadata: { analyzed_at: nowIso, input_truncated: truncated },
          updated_at: nowIso,
        },
        { onConflict: "source_file" }
      )
      .select("id")
      .single();

    if (storyErr || !storyUpsert?.id) {
      console.error("[api/analyze-story] stories upsert:", storyErr);
      return Response.json(
        {
          error: "Failed to save story.",
          detail: storyErr?.message ?? "no id returned",
        },
        { status: 500 }
      );
    }

    const storyId = storyUpsert.id as string;

    const factionIdsInOrder: string[] = [];
    for (const fac of parsed.factions) {
      const slug = stableSlug("f", sourceFile, fac.name);
      const { data: facRow, error: facErr } = await supabase
        .from("factions")
        .upsert(
          {
            slug,
            name: fac.name,
            faction_kind: fac.faction_kind,
            description: fac.description || null,
            metadata: { source_file: sourceFile },
            updated_at: nowIso,
          },
          { onConflict: "slug" }
        )
        .select("id")
        .single();

      if (facErr || !facRow?.id) {
        console.error("[api/analyze-story] factions upsert:", facErr);
        return Response.json(
          { error: "Failed to save faction.", detail: facErr?.message },
          { status: 500 }
        );
      }
      factionIdsInOrder.push(facRow.id as string);
    }

    const { error: delSfErr } = await supabase
      .from("story_factions")
      .delete()
      .eq("story_id", storyId);

    if (delSfErr) {
      console.error("[api/analyze-story] story_factions delete:", delSfErr);
      return Response.json(
        { error: "Failed to reset story_factions.", detail: delSfErr.message },
        { status: 500 }
      );
    }

    let facSortKey = 0;
    for (const factionId of factionIdsInOrder) {
      const { error: sfInsErr } = await supabase.from("story_factions").insert({
        story_id: storyId,
        faction_id: factionId,
        role_in_story: null,
        sort_key: facSortKey++,
      });
      if (sfInsErr) {
        console.error("[api/analyze-story] story_factions insert:", sfInsErr);
        return Response.json(
          { error: "Failed to link story_factions.", detail: sfInsErr.message },
          { status: 500 }
        );
      }
    }

    const characterIdBySlug = new Map<string, string>();

    for (const ch of parsed.characters) {
      const slug = stableSlug("c", sourceFile, ch.display_name);
      const { data: chRow, error: chErr } = await supabase
        .from("characters")
        .upsert(
          {
            slug,
            display_name: ch.display_name,
            profile: ch.profile || null,
            gender: ch.gender,
            abilities_summary: ch.abilities_summary || null,
            life_status: "unknown",
            metadata: { source_file: sourceFile },
            updated_at: nowIso,
          },
          { onConflict: "slug" }
        )
        .select("id")
        .single();

      if (chErr || !chRow?.id) {
        console.error("[api/analyze-story] characters upsert:", chErr);
        return Response.json(
          { error: "Failed to save character.", detail: chErr?.message },
          { status: 500 }
        );
      }
      characterIdBySlug.set(slug, chRow.id as string);
    }

    const { error: delScErr } = await supabase
      .from("story_characters")
      .delete()
      .eq("story_id", storyId);

    if (delScErr) {
      console.error("[api/analyze-story] story_characters delete:", delScErr);
      return Response.json(
        { error: "Failed to reset story_characters.", detail: delScErr.message },
        { status: 500 }
      );
    }

    const seenCharSlugs = new Set<string>();
    let sortKey = 0;
    for (const ch of parsed.characters) {
      const slug = stableSlug("c", sourceFile, ch.display_name);
      if (seenCharSlugs.has(slug)) continue;
      seenCharSlugs.add(slug);
      const characterId = characterIdBySlug.get(slug);
      if (!characterId) continue;

      const { error: insErr } = await supabase.from("story_characters").insert({
        story_id: storyId,
        character_id: characterId,
        role_in_story: null,
        is_main: true,
        sort_key: sortKey++,
      });

      if (insErr) {
        console.error("[api/analyze-story] story_characters insert:", insErr);
        return Response.json(
          { error: "Failed to link story_characters.", detail: insErr.message },
          { status: 500 }
        );
      }
    }

    const charIdsForRelCleanup = Array.from(characterIdBySlug.values());
    if (charIdsForRelCleanup.length > 0) {
      const { error: delCrErr } = await supabase
        .from("character_relationships")
        .delete()
        .in("from_character_id", charIdsForRelCleanup);
      if (delCrErr) {
        console.error("[api/analyze-story] character_relationships delete:", delCrErr);
      }
    }

    for (const rel of parsed.relationships) {
      const fromSlug = stableSlug("c", sourceFile, rel.from_name);
      const toSlug = stableSlug("c", sourceFile, rel.to_name);
      const fromId = characterIdBySlug.get(fromSlug);
      const toId = characterIdBySlug.get(toSlug);
      if (!fromId || !toId) continue;
      const { error: crErr } = await supabase.from("character_relationships").insert({
        from_character_id: fromId,
        to_character_id: toId,
        relation_type: rel.relation_type,
        summary: rel.summary || null,
        valid_from_era_label: parsed.era_primary ?? null,
      });
      if (crErr) {
        console.error("[api/analyze-story] character_relationships insert:", crErr);
      }
    }

    return Response.json({
      ok: true,
      source_file: sourceFile,
      story_id: storyId,
      factions_saved: parsed.factions.length,
      characters_saved: parsed.characters.length,
      relationships_saved: parsed.relationships.length,
      truncated,
    });
  } catch (err) {
    console.error("[api/analyze-story]", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: "analyze-story failed.", detail: message },
      { status: 500 }
    );
  }
}
