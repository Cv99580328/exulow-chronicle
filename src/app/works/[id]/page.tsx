"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";

type StoryRow = {
  id: string;
  source_file: string;
  display_title: string;
  era_primary: string | null;
  stage_summary: string | null;
  synopsis: string | null;
};

type CharacterEmbed = {
  display_name: string;
  profile: string | null;
  gender: string | null;
  abilities_summary: string | null;
};

type StoryCharacterRow = {
  id: string;
  character_id: string;
  is_main: boolean;
  sort_key: number;
  role_in_story: string | null;
  characters: CharacterEmbed | null;
};

type FactionEmbed = {
  name: string;
  faction_type: string | null;
  description: string | null;
  base_location: string | null;
};

type StoryFactionRow = {
  id: string;
  role_in_story: string | null;
  factions: FactionEmbed | null;
};

type RelationshipRow = {
  id: string;
  relation_type: string | null;
  summary: string | null;
  valid_from_era_label: string | null;
  from_character: { display_name: string } | null;
  to_character: { display_name: string } | null;
};

function normalizeCharacterEmbed(raw: unknown): CharacterEmbed | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    return normalizeCharacterEmbed(raw[0]);
  }
  if (typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const display_name = typeof o.display_name === "string" ? o.display_name : "";
  if (!display_name.trim()) return null;
  return {
    display_name: display_name.trim(),
    profile: typeof o.profile === "string" ? o.profile : null,
    gender: typeof o.gender === "string" ? o.gender : null,
    abilities_summary:
      typeof o.abilities_summary === "string" ? o.abilities_summary : null,
  };
}

function normalizeStoryCharacterRows(raw: unknown): StoryCharacterRow[] {
  if (!Array.isArray(raw)) return [];
  const out: StoryCharacterRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : "";
    if (!id) continue;
    const character_id = typeof r.character_id === "string" ? r.character_id : "";
    out.push({
      id,
      character_id,
      is_main: r.is_main === true,
      sort_key: typeof r.sort_key === "number" ? r.sort_key : 0,
      role_in_story: typeof r.role_in_story === "string" ? r.role_in_story : null,
      characters: normalizeCharacterEmbed(r.characters),
    });
  }
  return out;
}

function normalizeFactionEmbed(raw: unknown): FactionEmbed | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) return normalizeFactionEmbed(raw[0]);
  if (typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name : "";
  if (!name.trim()) return null;
  const factionTypeRaw =
    typeof o.faction_type === "string" && o.faction_type.trim()
      ? o.faction_type.trim()
      : typeof o.faction_kind === "string" && o.faction_kind.trim()
        ? o.faction_kind.trim()
        : null;
  const baseLocRaw =
    typeof o.base_location === "string" && o.base_location.trim()
      ? o.base_location.trim()
      : typeof o.headquarters === "string" && o.headquarters.trim()
        ? o.headquarters.trim()
        : null;
  return {
    name: name.trim(),
    faction_type: factionTypeRaw,
    description: typeof o.description === "string" ? o.description : null,
    base_location: baseLocRaw,
  };
}

function normalizeStoryFactionRows(raw: unknown): StoryFactionRow[] {
  if (!Array.isArray(raw)) return [];
  const out: StoryFactionRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : "";
    if (!id) continue;
    const f = normalizeFactionEmbed(r.factions);
    if (!f) continue;
    out.push({
      id,
      role_in_story: typeof r.role_in_story === "string" ? r.role_in_story : null,
      factions: f,
    });
  }
  return out;
}

function normalizeRelationshipRows(raw: unknown): RelationshipRow[] {
  if (!Array.isArray(raw)) return [];
  const out: RelationshipRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : "";
    if (!id) continue;

    const fromRaw = Array.isArray(r.from_character) ? r.from_character[0] : r.from_character;
    const toRaw = Array.isArray(r.to_character) ? r.to_character[0] : r.to_character;

    const from_character =
      fromRaw &&
      typeof fromRaw === "object" &&
      typeof (fromRaw as Record<string, unknown>).display_name === "string"
        ? {
            display_name: (
              (fromRaw as Record<string, unknown>).display_name as string
            ).trim(),
          }
        : null;
    const to_character =
      toRaw &&
      typeof toRaw === "object" &&
      typeof (toRaw as Record<string, unknown>).display_name === "string"
        ? {
            display_name: (
              (toRaw as Record<string, unknown>).display_name as string
            ).trim(),
          }
        : null;

    out.push({
      id,
      relation_type: typeof r.relation_type === "string" ? r.relation_type : null,
      summary: typeof r.summary === "string" ? r.summary : null,
      valid_from_era_label:
        typeof r.valid_from_era_label === "string" ? r.valid_from_era_label : null,
      from_character,
      to_character,
    });
  }
  return out;
}

function CharacterEntryCard({ row }: { row: StoryCharacterRow }) {
  const c = row.characters;
  if (!c) return null;
  const label = (v: string | null | undefined, empty = "—") =>
    v != null && String(v).trim() !== "" ? String(v).trim() : empty;

  return (
    <li className="rounded-xl border border-[#c9a84c]/25 bg-[#0d1323] px-4 py-3 shadow-[0_0_12px_rgba(201,168,76,0.06)]">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="text-base font-semibold text-[#f3e8c2]">{c.display_name}</h3>
        {row.role_in_story && row.role_in_story.trim() !== "" && (
          <span className="text-xs text-[#b8a97b]">（{row.role_in_story.trim()}）</span>
        )}
      </div>
      <dl className="mt-3 space-y-2 text-sm">
        <div>
          <dt className="font-medium text-[#c9a84c]">プロフィール</dt>
          <dd className="mt-0.5 leading-relaxed text-[#e6d9ae]">{label(c.profile, "（未設定）")}</dd>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <div>
            <dt className="font-medium text-[#c9a84c]">性別</dt>
            <dd className="mt-0.5 text-[#e6d9ae]">{label(c.gender)}</dd>
          </div>
          <div className="min-w-0 flex-1">
            <dt className="font-medium text-[#c9a84c]">能力・特筆</dt>
            <dd className="mt-0.5 leading-relaxed text-[#e6d9ae]">
              {label(c.abilities_summary, "（未設定）")}
            </dd>
          </div>
        </div>
      </dl>
    </li>
  );
}

function FactionEntryCard({ row }: { row: StoryFactionRow }) {
  const f = row.factions;
  if (!f) return null;
  const label = (v: string | null | undefined, empty = "—") =>
    v != null && String(v).trim() !== "" ? String(v).trim() : empty;
  return (
    <li className="rounded-xl border border-[#c9a84c]/25 bg-[#0d1323] px-4 py-3 shadow-[0_0_12px_rgba(201,168,76,0.06)]">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="text-base font-semibold text-[#f3e8c2]">{f.name}</h3>
        {f.faction_type && <span className="text-xs text-[#b8a97b]">【{f.faction_type}】</span>}
        {row.role_in_story && (
          <span className="text-xs text-[#b8a97b]">（{row.role_in_story}）</span>
        )}
      </div>
      <dl className="mt-3 space-y-2 text-sm">
        <div>
          <dt className="font-medium text-[#c9a84c]">説明</dt>
          <dd className="mt-0.5 leading-relaxed text-[#e6d9ae]">
            {label(f.description, "（未設定）")}
          </dd>
        </div>
        {f.base_location && (
          <div>
            <dt className="font-medium text-[#c9a84c]">拠点</dt>
            <dd className="mt-0.5 text-[#e6d9ae]">{f.base_location}</dd>
          </div>
        )}
      </dl>
    </li>
  );
}

export default function WorkDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const [story, setStory] = useState<StoryRow | null>(null);
  const [castRows, setCastRows] = useState<StoryCharacterRow[]>([]);
  const [factionRows, setFactionRows] = useState<StoryFactionRow[]>([]);
  const [relationshipRows, setRelationshipRows] = useState<RelationshipRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const { mainCast, supportingCast } = useMemo(() => {
    const valid = castRows.filter((r) => r.characters != null);
    return {
      mainCast: valid.filter((r) => r.is_main),
      supportingCast: valid.filter((r) => !r.is_main),
    };
  }, [castRows]);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setLoadError("無効な ID です。");
      setRelationshipRows([]);
      return;
    }

    let cancelled = false;
    void (async () => {
      setLoading(true);
      setLoadError(null);
      setCastRows([]);
      setFactionRows([]);
      setRelationshipRows([]);

      const [storyRes, castRes, factionRes] = await Promise.all([
        supabase
          .from("stories")
          .select("id,source_file,display_title,era_primary,stage_summary,synopsis")
          .eq("id", id)
          .maybeSingle(),
        supabase
          .from("story_characters")
          .select(
            `
            id,
            character_id,
            is_main,
            sort_key,
            role_in_story,
            characters (
              display_name,
              profile,
              gender,
              abilities_summary
            )
          `
          )
          .eq("story_id", id)
          .order("sort_key", { ascending: true }),
        supabase
          .from("story_factions")
          .select(
            `
            id,
            role_in_story,
            factions (
              name,
              faction_kind,
              description,
              headquarters
            )
          `
          )
          .eq("story_id", id)
          .order("sort_key", { ascending: true }),
      ]);

      if (cancelled) return;

      if (storyRes.error) {
        setLoadError(storyRes.error.message);
        setStory(null);
        setCastRows([]);
        setFactionRows([]);
        setRelationshipRows([]);
        setLoading(false);
        return;
      }
      if (!storyRes.data) {
        setLoadError("作品が見つかりません。");
        setStory(null);
        setCastRows([]);
        setFactionRows([]);
        setRelationshipRows([]);
        setLoading(false);
        return;
      }

      setStory(storyRes.data as StoryRow);

      let normalizedCast: StoryCharacterRow[] = [];
      if (castRes.error) {
        console.warn("[works/[id]] story_characters:", castRes.error.message);
        setCastRows([]);
      } else {
        normalizedCast = normalizeStoryCharacterRows(castRes.data ?? []);
        setCastRows(normalizedCast);
      }

      if (factionRes.error) {
        console.warn("[works/[id]] story_factions:", factionRes.error.message);
        setFactionRows([]);
      } else {
        setFactionRows(normalizeStoryFactionRows(factionRes.data));
      }

      const characterIds = normalizedCast.map((r) => r.character_id).filter(Boolean);
      let relRows: RelationshipRow[] = [];
      if (characterIds.length > 0) {
        const { data: relData, error: relErr } = await supabase
          .from("character_relationships")
          .select(
            `
            id, relation_type, summary, valid_from_era_label,
            from_character:characters!from_character_id(display_name),
            to_character:characters!to_character_id(display_name)
          `
          )
          .in("from_character_id", characterIds);
        if (relErr) {
          console.warn("[works/[id]] character_relationships:", relErr.message);
        } else {
          relRows = normalizeRelationshipRows(relData);
        }
      }
      if (cancelled) return;
      setRelationshipRows(relRows);

      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-[#f3e8c2]">
      <main className="mx-auto w-full max-w-3xl px-4 py-10 md:px-8">
        <p className="text-sm text-[#b8a97b]">
          <Link
            href="/"
            className="text-[#c9a84c] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c9a84c]"
          >
            ← トップへ
          </Link>
        </p>

        {loading && <p className="mt-6 text-sm text-[#b8a97b]">読み込み中...</p>}
        {!loading && loadError && (
          <p className="mt-6 text-sm text-[#d8a1a1]">{loadError}</p>
        )}
        {!loading && story && (
          <>
            <article className="mt-6 rounded-2xl border border-[#c9a84c]/30 bg-[#10182b] p-6 shadow-[0_0_24px_rgba(201,168,76,0.08)]">
              <h1 className="text-2xl font-bold tracking-wide text-[#c9a84c]">
                {story.display_title}
              </h1>
              <p className="mt-2 text-xs break-all text-[#b8a97b]">{story.source_file}</p>
              {story.era_primary && (
                <p className="mt-4 text-sm text-[#e6d9ae]">
                  <span className="font-medium text-[#c9a84c]">主な時代</span>{" "}
                  {story.era_primary}
                </p>
              )}
              {story.stage_summary && (
                <section className="mt-4">
                  <h2 className="text-sm font-semibold text-[#c9a84c]">舞台</h2>
                  <p className="mt-1 text-sm leading-relaxed text-[#e6d9ae]">
                    {story.stage_summary}
                  </p>
                </section>
              )}
              {story.synopsis && (
                <section className="mt-4">
                  <h2 className="text-sm font-semibold text-[#c9a84c]">あらすじ</h2>
                  <p className="mt-1 text-sm leading-relaxed text-[#e6d9ae]">
                    {story.synopsis}
                  </p>
                </section>
              )}
            </article>

            <section className="mt-8 rounded-2xl border border-[#c9a84c]/30 bg-[#10182b] p-6 shadow-[0_0_24px_rgba(201,168,76,0.08)]">
              <h2 className="text-lg font-semibold tracking-wide text-[#c9a84c]">登場人物</h2>

              {mainCast.length > 0 && (
                <div className="mt-5">
                  <h3 className="border-b border-[#c9a84c]/20 pb-2 text-sm font-semibold text-[#e6d9ae]">
                    主要キャラ
                  </h3>
                  <ul className="mt-4 space-y-4">
                    {mainCast.map((row) => (
                      <CharacterEntryCard key={row.id} row={row} />
                    ))}
                  </ul>
                </div>
              )}

              {supportingCast.length > 0 && (
                <div className={mainCast.length > 0 ? "mt-8" : "mt-5"}>
                  <h3 className="border-b border-[#c9a84c]/20 pb-2 text-sm font-semibold text-[#e6d9ae]">
                    脇役・その他
                  </h3>
                  <ul className="mt-4 space-y-4">
                    {supportingCast.map((row) => (
                      <CharacterEntryCard key={row.id} row={row} />
                    ))}
                  </ul>
                </div>
              )}

              {mainCast.length === 0 && supportingCast.length === 0 && (
                <p className="mt-4 text-sm text-[#b8a97b]">
                  登場人物はまだ登録されていません。作品管理から「詳細分析」を実行すると反映されます。
                </p>
              )}
            </section>

            <section className="mt-8 rounded-2xl border border-[#c9a84c]/30 bg-[#10182b] p-6 shadow-[0_0_24px_rgba(201,168,76,0.08)]">
              <h2 className="text-lg font-semibold tracking-wide text-[#c9a84c]">組織・勢力</h2>
              {factionRows.length > 0 ? (
                <ul className="mt-4 space-y-4">
                  {factionRows.map((row) => (
                    <FactionEntryCard key={row.id} row={row} />
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-[#b8a97b]">
                  組織・勢力はまだ登録されていません。作品管理から「詳細分析」を実行すると反映されます。
                </p>
              )}
            </section>

            <section className="mt-8 rounded-2xl border border-[#c9a84c]/30 bg-[#10182b] p-6 shadow-[0_0_24px_rgba(201,168,76,0.08)]">
              <h2 className="text-lg font-semibold tracking-wide text-[#c9a84c]">登場人物の関係</h2>
              {relationshipRows.length > 0 ? (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-[#c9a84c]/20">
                        <th className="py-2 pr-4 text-left font-medium text-[#c9a84c]">キャラA</th>
                        <th className="py-2 pr-4 text-left font-medium text-[#c9a84c]">関係</th>
                        <th className="py-2 pr-4 text-left font-medium text-[#c9a84c]">キャラB</th>
                        <th className="py-2 text-left font-medium text-[#c9a84c]">説明</th>
                      </tr>
                    </thead>
                    <tbody>
                      {relationshipRows.map((row) => (
                        <tr
                          key={row.id}
                          className="border-b border-[#c9a84c]/10 hover:bg-[#c9a84c]/5"
                        >
                          <td className="whitespace-nowrap py-2 pr-4 font-medium text-[#f3e8c2]">
                            {row.from_character?.display_name ?? "—"}
                          </td>
                          <td className="whitespace-nowrap py-2 pr-4">
                            <span className="rounded-full bg-[#c9a84c]/15 px-2 py-0.5 text-xs text-[#c9a84c]">
                              {row.relation_type ?? "—"}
                            </span>
                          </td>
                          <td className="whitespace-nowrap py-2 pr-4 font-medium text-[#f3e8c2]">
                            {row.to_character?.display_name ?? "—"}
                          </td>
                          <td className="py-2 leading-relaxed text-[#e6d9ae]">
                            {row.summary ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-4 text-sm text-[#b8a97b]">
                  関係データはまだ登録されていません。作品管理から「詳細分析」を実行すると反映されます。
                </p>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
