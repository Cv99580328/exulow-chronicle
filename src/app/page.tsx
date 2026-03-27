"use client";

import * as React from "react";
import { DragEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type UploadedFileInfo = {
  name: string;
  charCount: number;
};

type EventCard = {
  time: string;
  title: string;
  cause: string;
  event: string;
  result: string;
};

type DbEventRow = EventCard & {
  id: string;
  created_at: string;
};

type SourceFileSummary = {
  source_file: string | null;
  char_count: number | null;
};

const initialEvents: EventCard[] = [
  {
    time: "1万年前",
    title: "カイネが神を滅ぼす",
    cause: "神々による禁術の濫用で大地が崩壊寸前になる",
    event: "カイネが神を滅ぼす",
    result: "世界の法則が再編され、エクスロー暦が始まる",
  },
  {
    time: "3200年前",
    title: "灰燼戦役が勃発",
    cause: "七王国間の資源争奪が激化する",
    event: "灰燼戦役が勃発",
    result: "北方交易路が断絶し、記録文明が急速に衰退",
  },
  {
    time: "87年前",
    title: "フェブスタークが記憶を失う",
    cause: "禁書庫調査中の魔導暴走事故",
    event: "フェブスタークが記憶を失う",
    result: "王立史書院の正史に欠落が発生し、陰謀論が拡大",
  },
];

export default function Home() {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFileInfo[]>([]);
  const [events, setEvents] = useState<EventCard[]>(initialEvents);
  const [question, setQuestion] = useState("");
  const [chatAnswer, setChatAnswer] = useState(
    "ここにAIの回答が表示されます。まずは世界観について質問してみてください。"
  );
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractProgress, setExtractProgress] = useState<string | null>(null);
  const [supabaseError, setSupabaseError] = useState<string | null>(null);
  const [isLoadingFromDb, setIsLoadingFromDb] = useState(false);
  const [isSavingToDb, setIsSavingToDb] = useState(false);
  const [sourceFiles, setSourceFiles] = useState<
    { displayName: string; count: number; totalChars: number; deleteSourceFile: string }[]
  >([]);
  const [isLoadingSourceFiles, setIsLoadingSourceFiles] = useState(false);
  const [isDeletingSourceFile, setIsDeletingSourceFile] = useState(false);

  const totalChars = useMemo(
    () => uploadedFiles.reduce((sum, file) => sum + file.charCount, 0),
    [uploadedFiles]
  );

  const sourceFilesSummary = useMemo(() => {
    const workCount = sourceFiles.length;
    const totalEvents = sourceFiles.reduce((sum, row) => sum + (row.count ?? 0), 0);
    const totalChars = sourceFiles.reduce(
      (sum, row) => sum + (Number.isFinite(row.totalChars) ? row.totalChars : 0),
      0
    );
    return { workCount, totalEvents, totalChars };
  }, [sourceFiles]);

  const normalizeSourceFile = (sourceFile: string) =>
    sourceFile
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
      .filter((name, index, arr) => arr.indexOf(name) === index)
      .sort((a, b) => a.localeCompare(b, "ja"))
      .join(",");

  const formatMaybeDecimal = (value: number) =>
    Number.isFinite(value)
      ? Number.isInteger(value)
        ? value.toLocaleString()
        : value.toFixed(1)
      : "0";

  const loadEventsFromDb = async (isCancelled?: () => boolean) => {
    if (isCancelled?.()) return;
    setIsLoadingFromDb(true);
    setSupabaseError(null);

    const { data, error } = await supabase
      .from("events")
      .select("id,time,title,cause,event,result,created_at")
      .order("created_at", { ascending: false })
      .limit(200);

    if (isCancelled?.()) return;
    if (error) {
      setSupabaseError(error.message);
      setIsLoadingFromDb(false);
      return;
    }

    const rows = (data ?? []) as DbEventRow[];
    if (isCancelled?.()) return;
    setEvents(
      rows.map(({ time, title, cause, event, result }) => ({
        time,
        title,
        cause,
        event,
        result,
      }))
    );

    if (isCancelled?.()) return;
    setIsLoadingFromDb(false);
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      await loadEventsFromDb(() => cancelled);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadSourceFiles = async () => {
    setIsLoadingSourceFiles(true);
    setSupabaseError(null);

    const { data, error } = await supabase
      .from("events")
      .select("source_file,char_count")
      .not("source_file", "is", null)
      .order("source_file", { ascending: true });

    if (error) {
      setSupabaseError(error.message);
      setIsLoadingSourceFiles(false);
      return;
    }

    const rows = (data ?? []) as SourceFileSummary[];

    // まずは「元の source_file 文字列」単位で件数を集計
    const perOriginal = new Map<string, { count: number; charCountSum: number }>();
    for (const row of rows) {
      const original = String(row.source_file ?? "").trim();
      if (!original) continue;
      const prev = perOriginal.get(original) ?? { count: 0, charCountSum: 0 };
      perOriginal.set(original, {
        count: prev.count + 1,
        charCountSum: prev.charCountSum + Number(row.char_count ?? 0),
      });
    }

    // 表示は、カンマ区切りなら分割して個別行として並べる（件数は分割数で割る）
    const displayRows: {
      displayName: string;
      count: number;
      totalChars: number;
      deleteSourceFile: string;
    }[] = [];

    for (const [original, dataBySource] of perOriginal.entries()) {
      const parts = original
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);

      const n = parts.length > 0 ? parts.length : 1;
      const perWork = dataBySource.count / n;
      const perWorkChars = dataBySource.charCountSum / n;

      if (parts.length === 0) {
        displayRows.push({
          displayName: original,
          count: dataBySource.count,
          totalChars: dataBySource.charCountSum,
          deleteSourceFile: original,
        });
        continue;
      }

      for (const part of parts) {
        displayRows.push({
          displayName: part,
          count: perWork,
          totalChars: perWorkChars,
          deleteSourceFile: original,
        });
      }
    }

    setSourceFiles(
      displayRows.sort((a, b) => a.displayName.localeCompare(b.displayName, "ja"))
    );

    setIsLoadingSourceFiles(false);
  };

  useEffect(() => {
    void loadSourceFiles();
  }, []);

  const deleteSourceFile = async (sourceFile: string) => {
    const trimmed = sourceFile.trim();
    if (!trimmed) return;

    setIsDeletingSourceFile(true);
    setSupabaseError(null);

    const { error } = await supabase
      .from("events")
      .delete()
      .eq("source_file", trimmed);

    if (error) {
      setSupabaseError(error.message);
      setIsDeletingSourceFile(false);
      return;
    }

    await loadSourceFiles();
    setIsDeletingSourceFile(false);
  };

  const deleteUploadedFile = async (fileName: string, index: number) => {
    const trimmed = fileName.trim();
    if (!trimmed) return;

    setIsDeletingSourceFile(true);
    setSupabaseError(null);

    const { error } = await supabase
      .from("events")
      .delete()
      .eq("source_file", trimmed);

    if (error) {
      setSupabaseError(error.message);
      setIsDeletingSourceFile(false);
      return;
    }

    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
    await loadSourceFiles();
    await loadEventsFromDb();
    setIsDeletingSourceFile(false);
  };

  const saveEventsToDb = async (
    newEvents: EventCard[],
    sourceFile: string,
    charCount: number
  ) => {
    setIsSavingToDb(true);
    setSupabaseError(null);

    const trimmedSourceFile = normalizeSourceFile(sourceFile);
    if (!trimmedSourceFile) {
      setSupabaseError("source_file is required to save events.");
      setIsSavingToDb(false);
      return;
    }

    const { error: deleteError } = await supabase
      .from("events")
      .delete()
      .eq("source_file", trimmedSourceFile);

    if (deleteError) {
      setSupabaseError(deleteError.message);
      setIsSavingToDb(false);
      return;
    }

    const { error } = await supabase.from("events").insert(
      newEvents.map((e) => ({
        source_file: trimmedSourceFile,
        char_count: charCount,
        time: e.time,
        title: e.title,
        cause: e.cause,
        event: e.event,
        result: e.result,
      }))
    );

    if (error) {
      setSupabaseError(error.message);
    }

    setIsSavingToDb(false);
    await loadSourceFiles();
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    if (isExtracting) return;
    setExtractError(null);
    setExtractProgress(null);
    setIsExtracting(true);

    try {
      const fileArray = Array.from(files);
      const fileTexts = await Promise.all(fileArray.map((file) => file.text()));

      const fileInfos: UploadedFileInfo[] = fileArray.map((file, idx) => ({
        name: file.name,
        charCount: fileTexts[idx].length,
      }));

      setUploadedFiles((prev) => [...prev, ...fileInfos]);

      // MVP: 応答速度とトークン量を考慮して、先頭のみ送る（ファイルごと）
      const MAX_INPUT_CHARS = 20000;

      for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i];
        const sourceFile = file.name.trim();
        const rawText = fileTexts[i] ?? "";
        const sourceFileCharCount = rawText.length;
        const textForClaude =
          rawText.length > MAX_INPUT_CHARS ? rawText.slice(0, MAX_INPUT_CHARS) : rawText;

        setExtractProgress(`${sourceFile} を処理中...`);

        const res = await fetch("/api/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: textForClaude }),
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => null);
          throw new Error(
            errBody?.error ? String(errBody.error) : `HTTP ${res.status}`
          );
        }

        const data = (await res.json()) as { events?: EventCard[] };
        const extractedEvents = Array.isArray(data.events) ? data.events : [];

        if (extractedEvents.length > 0) {
          await saveEventsToDb(extractedEvents, sourceFile, sourceFileCharCount);
        }
      }

      await loadEventsFromDb();
      await loadSourceFiles();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setExtractError(message);
    } finally {
      setExtractProgress(null);
      setIsExtracting(false);
    }
  };

  const onDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    await handleFiles(event.dataTransfer.files);
  };

  const onSubmitQuestion = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!question.trim()) return;

    setChatAnswer(
      `ダミー回答: 「${question}」については、現在インデックスされた資料をもとに整理中です。MVP段階では固定応答ですが、将来的には時系列と因果関係を根拠付きで回答します。`
    );
    setQuestion("");
  };

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-[#f3e8c2]">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 md:px-8">
        <header className="rounded-2xl border border-[#c9a84c]/40 bg-[#10182b] p-6 shadow-[0_0_24px_rgba(201,168,76,0.12)]">
          <h1 className="text-3xl font-bold tracking-wide text-[#c9a84c]">
            エクスロー・クロニクル
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-[#e6d9ae]">
            1000万文字を超える物語群から、人物・出来事・因果を整理する世界観データベース
          </p>
        </header>

        <section className="rounded-2xl border border-[#c9a84c]/30 bg-[#10182b] p-6">
          <h2 className="text-xl font-semibold text-[#c9a84c]">
            作品アップロードエリア
          </h2>
          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
            className="mt-4 rounded-xl border-2 border-dashed border-[#c9a84c]/60 bg-[#0d1323] p-8 text-center"
          >
            <p className="text-sm text-[#f3e8c2]">
              テキストファイルをここにドラッグ＆ドロップ
            </p>
            <p className="mt-2 text-xs text-[#b8a97b]">
              （.txt 推奨 / 複数ファイル対応）
            </p>
          </div>

          <div className="mt-4 space-y-2 text-sm">
            <p className="text-[#e6d9ae]">合計文字数: {totalChars.toLocaleString()} 文字</p>
            {uploadedFiles.length === 0 ? (
              <p className="text-[#b8a97b]">まだファイルがアップロードされていません。</p>
            ) : (
              <ul className="space-y-2">
                {uploadedFiles.map((file, index) => (
                  <li
                    key={`${file.name}-${index}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[#c9a84c]/30 bg-[#0d1323] px-3 py-2"
                  >
                    <span className="min-w-0 truncate">
                      {file.name} - {file.charCount.toLocaleString()} 文字
                    </span>
                    <button
                      type="button"
                      aria-label={`${file.name} を一覧から削除`}
                      onClick={() => void deleteUploadedFile(file.name, index)}
                      disabled={isDeletingSourceFile}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#c9a84c]/40 text-sm font-semibold text-[#c9a84c] transition hover:bg-[#c9a84c]/10 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-[#c9a84c]/30 bg-[#10182b] p-6">
          <h2 className="text-xl font-semibold text-[#c9a84c]">作品管理</h2>
          <p className="mt-2 text-sm text-[#b8a97b]">
            source_file ごとのイベント件数を表示します。
          </p>
          <div className="mt-3 rounded-xl border border-[#c9a84c]/20 bg-[#0d1323] px-4 py-3 text-sm text-[#e6d9ae]">
            作品数: {sourceFilesSummary.workCount.toLocaleString()}作品 / 累計イベント数:{" "}
            {formatMaybeDecimal(sourceFilesSummary.totalEvents)}件 / 累計文字数:{" "}
            {Math.round(sourceFilesSummary.totalChars).toLocaleString()}文字
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-[#c9a84c]/30 bg-[#0d1323]">
            <div className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-[#c9a84c]/20 px-4 py-3 text-xs text-[#b8a97b]">
              <div>作品名</div>
              <div className="text-right">件数</div>
              <div className="text-right">操作</div>
            </div>

            {isLoadingSourceFiles ? (
              <div className="px-4 py-4 text-sm text-[#b8a97b]">
                読み込み中...
              </div>
            ) : sourceFiles.length === 0 ? (
              <div className="px-4 py-4 text-sm text-[#b8a97b]">
                まだ保存された作品がありません。
              </div>
            ) : (
              <ul className="divide-y divide-[#c9a84c]/10">
                {sourceFiles.map((row, idx) => (
                  <li
                    key={`${row.deleteSourceFile}::${row.displayName}::${idx}`}
                    className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-[#f3e8c2]">
                        {row.displayName}
                      </p>
                    </div>
                    <div className="text-right text-sm text-[#e6d9ae] tabular-nums">
                      {formatMaybeDecimal(row.count)}
                    </div>
                    <div className="text-right">
                      <button
                        type="button"
                        onClick={() => void deleteSourceFile(row.deleteSourceFile)}
                        disabled={isDeletingSourceFile}
                        className="rounded-lg border border-[#c9a84c]/40 bg-transparent px-3 py-1.5 text-xs font-semibold text-[#c9a84c] transition hover:bg-[#c9a84c]/10 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        削除
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => void loadSourceFiles()}
              disabled={isLoadingSourceFiles}
              className="rounded-lg bg-[#c9a84c] px-4 py-2 text-sm font-semibold text-[#0a0e1a] transition hover:bg-[#d7ba67] disabled:cursor-not-allowed disabled:opacity-60"
            >
              一覧を更新
            </button>
            {isDeletingSourceFile && (
              <p className="text-sm text-[#b8a97b]">削除中...</p>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-[#c9a84c]/30 bg-[#10182b] p-6">
          <h2 className="text-xl font-semibold text-[#c9a84c]">
            年表・因果関係ビューア
          </h2>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {events.map((item) => (
              <article
                key={`${item.time}-${item.title}`}
                className="rounded-xl border border-[#c9a84c]/30 bg-[#0d1323] p-4"
              >
                <p className="text-xs text-[#b8a97b]">{item.time}</p>
                <p className="mt-2 text-base font-semibold text-[#f3e8c2]">
                  {item.title}
                </p>
                <dl className="mt-3 space-y-2 text-sm">
                  <div>
                    <dt className="font-medium text-[#c9a84c]">原因</dt>
                    <dd className="text-[#e6d9ae]">{item.cause}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-[#c9a84c]">出来事</dt>
                    <dd className="text-[#e6d9ae]">{item.event}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-[#c9a84c]">結果</dt>
                    <dd className="text-[#e6d9ae]">{item.result}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
          {isExtracting && (
            <p className="mt-4 text-sm text-[#b8a97b]">Claudeが抽出中です...</p>
          )}
          {isExtracting && extractProgress && (
            <p className="mt-2 text-sm text-[#b8a97b]">{extractProgress}</p>
          )}
          {isSavingToDb && (
            <p className="mt-2 text-sm text-[#b8a97b]">
              Supabaseへ保存中です...
            </p>
          )}
          {isLoadingFromDb && (
            <p className="mt-2 text-sm text-[#b8a97b]">
              Supabaseから読み込み中です...
            </p>
          )}
          {!isExtracting && !isSavingToDb && !isLoadingFromDb && supabaseError && (
            <p className="mt-4 text-sm text-[#d8a1a1]">
              Supabaseエラー: {supabaseError}
            </p>
          )}
          {!isExtracting && extractError && (
            <p className="mt-4 text-sm text-[#d8a1a1]">
              抽出に失敗しました: {extractError}
            </p>
          )}
          {!isExtracting && events.length === 0 && (
            <p className="mt-4 text-sm text-[#b8a97b]">
              まだイベントがありません。テキストをアップロードしてください。
            </p>
          )}
        </section>

        <section className="rounded-2xl border border-[#c9a84c]/30 bg-[#10182b] p-6">
          <h2 className="text-xl font-semibold text-[#c9a84c]">
            AIに質問するチャット欄
          </h2>
          <form onSubmit={onSubmitQuestion} className="mt-4 flex flex-col gap-3">
            <label htmlFor="question" className="text-sm text-[#e6d9ae]">
              例: フェブスタークはいつ記憶を失ったか？
            </label>
            <input
              id="question"
              type="text"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              className="rounded-lg border border-[#c9a84c]/40 bg-[#0d1323] px-4 py-3 text-sm text-[#f3e8c2] outline-none placeholder:text-[#8c7a4a] focus:border-[#c9a84c]"
              placeholder="世界観について質問を入力..."
            />
            <button
              type="submit"
              className="w-fit rounded-lg bg-[#c9a84c] px-4 py-2 text-sm font-semibold text-[#0a0e1a] transition hover:bg-[#d7ba67]"
            >
              質問する
            </button>
          </form>
          <div className="mt-4 rounded-lg border border-[#c9a84c]/30 bg-[#0d1323] p-4 text-sm text-[#e6d9ae]">
            {chatAnswer}
          </div>
        </section>
      </main>
    </div>
  );
}
