"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

type StoryRow = {
  id: string;
  source_file: string;
  display_title: string;
  era_primary: string | null;
  stage_summary: string | null;
  synopsis: string | null;
};

export default function WorkDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const [story, setStory] = useState<StoryRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
      const { data, error } = await supabase
        .from("stories")
        .select("id,source_file,display_title,era_primary,stage_summary,synopsis")
        .eq("id", id)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        setLoadError(error.message);
        setStory(null);
      } else if (!data) {
        setLoadError("作品が見つかりません。");
        setStory(null);
      } else {
        setStory(data as StoryRow);
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
          <article className="mt-6 rounded-2xl border border-[#c9a84c]/30 bg-[#10182b] p-6 shadow-[0_0_24px_rgba(201,168,76,0.08)]">
            <h1 className="text-2xl font-bold tracking-wide text-[#c9a84c]">
              {story.display_title}
            </h1>
            <p className="mt-2 text-xs text-[#b8a97b] break-all">{story.source_file}</p>
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
        )}
      </main>
    </div>
  );
}
