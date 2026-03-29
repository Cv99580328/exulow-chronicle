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
  is_main: boolean;
  sort_key: number;
  role_in_story: string | null;
  characters: CharacterEmbed | null;
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
    out.push({
      id,
      is_main: r.is_main === true,
      sort_key: typeof r.sort_key === "number" ? r.sort_key : 0,
      role_in_story: typeof r.role_in_story === "string" ? r.role_in_story : null,
      characters: normalizeCharacterEmbed(r.characters),
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

export default function WorkDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const [story, setStory] = useState<StoryRow | null>(null);
  const [castRows, setCastRows] = useState<StoryCharacterRow[]>([]);
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
      return;
    }

    let cancelled = false;
    void (async () => {
      setLoading(true);
      setLoadError(null);

      const [storyRes, castRes] = await Promise.all([
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
      ]);

      if (cancelled) return;

      if (storyRes.error) {
        setLoadError(storyRes.error.message);
        setStory(null);
        setCastRows([]);
        setLoading(false);
        return;
      }
      if (!storyRes.data) {
        setLoadError("作品が見つかりません。");
        setStory(null);
        setCastRows([]);
        setLoading(false);
        return;
      }

      setStory(storyRes.data as StoryRow);

      if (castRes.error) {
        console.warn("[works/[id]] story_characters:", castRes.error.message);
        setCastRows([]);
      } else {
        setCastRows(normalizeStoryCharacterRows(castRes.data));
      }

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
          </>
        )}
      </main>
    </div>
  );
}
