"use client";

import * as React from "react";
import { DragEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { extractUploadedFileText } from "../lib/extractFileText";
import { supabase } from "../lib/supabase";

type EventCard = {
  time: string;
  title: string;
  cause: string;
  event: string;
  result: string;
};

type SourceFileRow = {
  source_file: string;
  content: string;
  char_count: number;
  synopsis: string | null;
};

type EventDbRow = EventCard & {
  source_file: string;
};

type WorldHistoryEra = {
  label: string;
  sortKey: number;
  events: EventCard[];
};

function isUnknownTime(time: string): boolean {
  return time.trim() === "不明";
}

/** 小さいほど古い（画面上は上）。不明は最下段で別処理 */
function eraSortKey(time: string): number {
  const t = time.trim();
  if (isUnknownTime(t)) return Number.MAX_SAFE_INTEGER;
  if (t.includes("現在")) return 0;
  const mMan = t.match(/(\d+(?:\.\d+)?)\s*万年前/);
  if (mMan) return -parseFloat(mMan[1]) * 10000;
  const mNen = t.match(/(\d+)\s*年前/);
  if (mNen) return -parseInt(mNen[1], 10);
  return 100;
}

function buildWorldHistoryEras(eventsList: EventCard[]): WorldHistoryEra[] {
  const known = new Map<string, EventCard[]>();
  const unknown: EventCard[] = [];
  for (const e of eventsList) {
    if (isUnknownTime(e.time)) {
      unknown.push(e);
    } else {
      const k = e.time.trim();
      if (!known.has(k)) known.set(k, []);
      known.get(k)!.push(e);
    }
  }
  const buckets: WorldHistoryEra[] = [...known.entries()].map(([label, evs]) => ({
    label,
    sortKey: eraSortKey(label),
    events: evs,
  }));
  buckets.sort((a, b) => a.sortKey - b.sortKey);
  if (unknown.length > 0) {
    buckets.push({
      label: "不明",
      sortKey: Number.MAX_SAFE_INTEGER,
      events: unknown,
    });
  }
  return buckets;
}

function worldHistoryCardClass(time: string): string {
  const t = time.trim();
  if (isUnknownTime(t)) {
    return "border-gray-500/50 bg-gray-900/50 text-[#e6d9ae]";
  }
  if (t.includes("万年前")) {
    return "border-sky-500/45 bg-sky-950/45 text-[#e0f2fe]";
  }
  if (t.includes("年前")) {
    return "border-emerald-500/45 bg-emerald-950/40 text-[#d1fae5]";
  }
  if (t.includes("現在")) {
    return "border-[#c9a84c]/55 bg-[#1a1508]/80 text-[#f3e8c2]";
  }
  return "border-[#c9a84c]/35 bg-[#0d1323] text-[#f3e8c2]";
}

export default function Home() {
  const [events, setEvents] = useState<EventCard[]>([]);
  const [sourceFiles, setSourceFiles] = useState<SourceFileRow[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [isLoadingSourceFiles, setIsLoadingSourceFiles] = useState(false);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [isDeletingSourceFile, setIsDeletingSourceFile] = useState(false);
  const [isSavingWork, setIsSavingWork] = useState(false);
  const [isReextracting, setIsReextracting] = useState(false);
  const [supabaseError, setSupabaseError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadFailedFiles, setUploadFailedFiles] = useState<string[]>([]);
  const [selectedWorks, setSelectedWorks] = useState<Record<string, boolean>>({});
  const [isBulkExtracting, setIsBulkExtracting] = useState(false);
  const [bulkExtractProgress, setBulkExtractProgress] = useState<string | null>(null);

  const [editingOriginalSourceFile, setEditingOriginalSourceFile] = useState<string | null>(
    null
  );
  const [editSourceFile, setEditSourceFile] = useState("");
  const [editSynopsis, setEditSynopsis] = useState("");
  const [editContent, setEditContent] = useState("");

  const [question, setQuestion] = useState("");
  const [chatAnswer, setChatAnswer] = useState(
    "ここにAIの回答が表示されます。まずは世界観について質問してみてください。"
  );

  const sourceFilesSummary = useMemo(() => {
    const workCount = sourceFiles.length;
    const totalChars = sourceFiles.reduce((sum, row) => sum + Number(row.char_count ?? 0), 0);
    return { workCount, totalChars };
  }, [sourceFiles]);

  const worldHistoryEras = useMemo(() => buildWorldHistoryEras(events), [events]);

  const loadSourceFiles = async () => {
    setIsLoadingSourceFiles(true);
    setSupabaseError(null);

    const { data, error } = await supabase
      .from("source_files")
      .select("source_file,content,char_count,synopsis")
      .order("source_file", { ascending: true });

    if (error) {
      setSupabaseError(error.message);
      setIsLoadingSourceFiles(false);
      return;
    }

    setSourceFiles((data ?? []) as SourceFileRow[]);
    setIsLoadingSourceFiles(false);
  };

  const loadEvents = async () => {
    setIsLoadingEvents(true);
    setSupabaseError(null);

    const { data, error } = await supabase
      .from("events")
      .select("source_file,time,title,cause,event,result")
      .order("time", { ascending: true });

    if (error) {
      setSupabaseError(error.message);
      setIsLoadingEvents(false);
      return;
    }

    const rows = (data ?? []) as EventDbRow[];
    setEvents(
      rows.map((row) => ({
        time: row.time,
        title: row.title,
        cause: row.cause,
        event: row.event,
        result: row.result,
      }))
    );
    setIsLoadingEvents(false);
  };

  useEffect(() => {
    void loadSourceFiles();
    void loadEvents();
  }, []);

  useEffect(() => {
    const valid = new Set(sourceFiles.map((s) => s.source_file));
    setSelectedWorks((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (!valid.has(k)) {
          delete next[k];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [sourceFiles]);

  /** DBの source_file キー用。全角記号などはそのまま維持し、NUL・パス区切りのみ除去・NFC正規化 */
  const sanitizeSourceFileKey = (raw: string, fallbackIndex: number): string => {
    let s = raw.normalize("NFC").trim().replace(/\0/g, "");
    s = s.replace(/[/\\]/g, "_");
    return s.length > 0 ? s : `unnamed-${fallbackIndex + 1}`;
  };

  const upsertSourceFile = async (
    sourceFileKey: string,
    content: string
  ): Promise<{ error: string | null }> => {
    const key = sourceFileKey.trim();
    if (!key) {
      return { error: "ファイル名が空です" };
    }

    const { error } = await supabase.from("source_files").upsert(
      {
        source_file: key,
        content,
        char_count: content.length,
      },
      { onConflict: "source_file" }
    );

    return { error: error ? error.message : null };
  };

  const extractAndSaveEvents = async (sourceFile: string, text: string) => {
    const trimmed = sourceFile.trim();
    if (!trimmed) return;

    const res = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => null);
      throw new Error(errBody?.error ? String(errBody.error) : `HTTP ${res.status}`);
    }

    const data = (await res.json()) as { events?: EventCard[] };
    const extractedEvents = Array.isArray(data.events) ? data.events : [];

    const { error: deleteError } = await supabase
      .from("events")
      .delete()
      .eq("source_file", trimmed);
    if (deleteError) throw new Error(deleteError.message);

    if (extractedEvents.length > 0) {
      const { error: insertError } = await supabase.from("events").insert(
        extractedEvents.map((e) => ({
          source_file: trimmed,
          time: e.time,
          title: e.title,
          cause: e.cause,
          event: e.event,
          result: e.result,
        }))
      );
      if (insertError) throw new Error(insertError.message);
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (isUploading) return;

    setUploadError(null);
    setUploadFailedFiles([]);
    setUploadProgress(null);
    setIsUploading(true);

    const failedNames: string[] = [];

    try {
      const fileArray = Array.from(files);

      for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i];
        const displayName = file.name;
        setUploadProgress(`${displayName} を処理中...`);

        let rawText: string;
        try {
          rawText = await extractUploadedFileText(file);
        } catch {
          failedNames.push(displayName);
          continue;
        }

        const key = sanitizeSourceFileKey(displayName, i);
        const { error } = await upsertSourceFile(key, rawText);
        if (error) {
          failedNames.push(displayName);
        }
      }

      await loadSourceFiles();

      if (failedNames.length > 0) {
        setUploadFailedFiles(failedNames);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setUploadError(message);
    } finally {
      setUploadProgress(null);
      setIsUploading(false);
    }
  };

  const deleteWork = async (sourceFile: string) => {
    const trimmed = sourceFile.trim();
    if (!trimmed) return;

    setIsDeletingSourceFile(true);
    setSupabaseError(null);

    const { error: eventsError } = await supabase
      .from("events")
      .delete()
      .eq("source_file", trimmed);

    if (eventsError) {
      setSupabaseError(eventsError.message);
      setIsDeletingSourceFile(false);
      return;
    }

    const { error: sourceError } = await supabase
      .from("source_files")
      .delete()
      .eq("source_file", trimmed);

    if (sourceError) {
      setSupabaseError(sourceError.message);
      setIsDeletingSourceFile(false);
      return;
    }

    if (editingOriginalSourceFile === trimmed) {
      setEditingOriginalSourceFile(null);
      setEditSourceFile("");
      setEditSynopsis("");
      setEditContent("");
    }

    await loadSourceFiles();
    await loadEvents();
    setIsDeletingSourceFile(false);
  };

  const openEditor = (work: SourceFileRow) => {
    setEditingOriginalSourceFile(work.source_file);
    setEditSourceFile(work.source_file);
    setEditSynopsis(work.synopsis ?? "");
    setEditContent(work.content ?? "");
  };

  const closeEditor = () => {
    setEditingOriginalSourceFile(null);
    setEditSourceFile("");
    setEditSynopsis("");
    setEditContent("");
  };

  const saveWorkMeta = async () => {
    if (!editingOriginalSourceFile) return;
    const newName = editSourceFile.trim();
    if (!newName) return;

    setIsSavingWork(true);
    setSupabaseError(null);

    const { error: sourceUpdateError } = await supabase
      .from("source_files")
      .update({
        source_file: newName,
        synopsis: editSynopsis.trim() ? editSynopsis.trim() : null,
      })
      .eq("source_file", editingOriginalSourceFile);

    if (sourceUpdateError) {
      setSupabaseError(sourceUpdateError.message);
      setIsSavingWork(false);
      return;
    }

    if (editingOriginalSourceFile !== newName) {
      const { error: eventsRenameError } = await supabase
        .from("events")
        .update({ source_file: newName })
        .eq("source_file", editingOriginalSourceFile);

      if (eventsRenameError) {
        setSupabaseError(eventsRenameError.message);
        setIsSavingWork(false);
        return;
      }
    }

    setEditingOriginalSourceFile(newName);
    await loadSourceFiles();
    await loadEvents();
    setIsSavingWork(false);
  };

  const reextractEventsForEditingWork = async () => {
    if (!editingOriginalSourceFile) return;

    const currentName = editSourceFile.trim();
    if (!currentName) return;

    const text = editContent ?? "";
    setIsReextracting(true);
    setSupabaseError(null);

    try {
      await extractAndSaveEvents(currentName, text);

      await loadEvents();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSupabaseError(message);
    } finally {
      setIsReextracting(false);
    }
  };

  const extractWorksSequentially = async (works: SourceFileRow[]) => {
    if (works.length === 0) return;
    setIsBulkExtracting(true);
    setBulkExtractProgress(null);
    setSupabaseError(null);
    try {
      for (const row of works) {
        setBulkExtractProgress(`${row.source_file} を抽出中...`);
        await extractAndSaveEvents(row.source_file, row.content ?? "");
      }
      await loadEvents();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSupabaseError(message);
    } finally {
      setBulkExtractProgress(null);
      setIsBulkExtracting(false);
    }
  };

  const extractSelectedWorks = () => {
    const selected = sourceFiles.filter((s) => selectedWorks[s.source_file]);
    void extractWorksSequentially(selected);
  };

  const extractAllWorks = () => {
    void extractWorksSequentially([...sourceFiles]);
  };

  const selectAllWorks = () => {
    const next: Record<string, boolean> = {};
    for (const s of sourceFiles) {
      next[s.source_file] = true;
    }
    setSelectedWorks(next);
  };

  const deselectAllWorks = () => {
    setSelectedWorks({});
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
          <h2 className="text-xl font-semibold text-[#c9a84c]">作品アップロードエリア</h2>
          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
            className="mt-4 rounded-xl border-2 border-dashed border-[#c9a84c]/60 bg-[#0d1323] p-8 text-center"
          >
            <p className="text-sm text-[#f3e8c2]">テキストファイルをここにドラッグ＆ドロップ</p>
            <p className="mt-2 text-xs text-[#b8a97b]">
              （.txt / .docx / .doc / .pdf 対応・複数ファイル可）
            </p>
          </div>
          {isUploading && (
            <p className="mt-4 text-sm text-[#b8a97b]">
              {uploadProgress ?? "アップロード処理中..."}
            </p>
          )}
          {!isUploading && uploadError && (
            <p className="mt-4 text-sm text-[#d8a1a1]">アップロードに失敗しました: {uploadError}</p>
          )}
          {!isUploading && uploadFailedFiles.length > 0 && (
            <div className="mt-4 rounded-xl border border-[#c9a84c]/30 bg-[#0d1323] p-4">
              <p className="text-sm font-medium text-[#d8a1a1]">
                以下のファイルは source_files への保存に失敗しました（他のファイルは処理済みです）
              </p>
              <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-[#e6d9ae]">
                {uploadFailedFiles.map((name, idx) => (
                  <li key={`${idx}-${name}`} className="break-all">
                    {name}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-[#c9a84c]/30 bg-[#10182b] p-6">
          <h2 className="text-xl font-semibold text-[#c9a84c]">作品管理</h2>
          <div className="mt-3 rounded-xl border border-[#c9a84c]/20 bg-[#0d1323] px-4 py-3 text-sm text-[#e6d9ae]">
            作品数: {sourceFilesSummary.workCount.toLocaleString()}作品 / 累計文字数:{" "}
            {sourceFilesSummary.totalChars.toLocaleString()}文字
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={selectAllWorks}
              disabled={isLoadingSourceFiles || sourceFiles.length === 0 || isBulkExtracting}
              className="rounded-lg border border-[#c9a84c]/40 bg-transparent px-3 py-1.5 text-xs font-semibold text-[#c9a84c] transition hover:bg-[#c9a84c]/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              全選択
            </button>
            <button
              type="button"
              onClick={deselectAllWorks}
              disabled={isLoadingSourceFiles || sourceFiles.length === 0 || isBulkExtracting}
              className="rounded-lg border border-[#c9a84c]/40 bg-transparent px-3 py-1.5 text-xs font-semibold text-[#c9a84c] transition hover:bg-[#c9a84c]/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              全解除
            </button>
            <button
              type="button"
              onClick={extractSelectedWorks}
              disabled={
                isLoadingSourceFiles ||
                sourceFiles.length === 0 ||
                isBulkExtracting ||
                !sourceFiles.some((s) => selectedWorks[s.source_file])
              }
              className="rounded-lg bg-[#c9a84c] px-3 py-1.5 text-xs font-semibold text-[#0a0e1a] transition hover:bg-[#d7ba67] disabled:cursor-not-allowed disabled:opacity-60"
            >
              選択した作品を抽出
            </button>
            <button
              type="button"
              onClick={extractAllWorks}
              disabled={isLoadingSourceFiles || sourceFiles.length === 0 || isBulkExtracting}
              className="rounded-lg border border-[#c9a84c]/40 bg-transparent px-3 py-1.5 text-xs font-semibold text-[#c9a84c] transition hover:bg-[#c9a84c]/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              全作品を一括抽出
            </button>
          </div>
          {isBulkExtracting && bulkExtractProgress && (
            <p className="mt-2 text-sm text-[#b8a97b]">{bulkExtractProgress}</p>
          )}

          <div className="mt-4 overflow-hidden rounded-xl border border-[#c9a84c]/30 bg-[#0d1323]">
            <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-3 border-b border-[#c9a84c]/20 px-4 py-3 text-xs text-[#b8a97b]">
              <div className="w-8 shrink-0" aria-hidden />
              <div>作品名</div>
              <div className="text-right">文字数</div>
              <div className="text-right">編集</div>
              <div className="text-right">削除</div>
            </div>
            {isLoadingSourceFiles ? (
              <div className="px-4 py-4 text-sm text-[#b8a97b]">読み込み中...</div>
            ) : sourceFiles.length === 0 ? (
              <div className="px-4 py-4 text-sm text-[#b8a97b]">まだ保存された作品がありません。</div>
            ) : (
              <ul className="divide-y divide-[#c9a84c]/10">
                {sourceFiles.map((row) => (
                  <li
                    key={row.source_file}
                    className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3 px-4 py-3"
                  >
                    <input
                      type="checkbox"
                      checked={!!selectedWorks[row.source_file]}
                      onChange={() =>
                        setSelectedWorks((prev) => ({
                          ...prev,
                          [row.source_file]: !prev[row.source_file],
                        }))
                      }
                      disabled={isBulkExtracting}
                      className="h-4 w-4 shrink-0 rounded border-[#c9a84c]/50 bg-[#0d1323] text-[#c9a84c] accent-[#c9a84c] disabled:opacity-50"
                      aria-label={`${row.source_file} を選択`}
                    />
                    <p className="min-w-0 truncate text-sm text-[#f3e8c2]">{row.source_file}</p>
                    <p className="text-right text-sm text-[#e6d9ae]">{row.char_count.toLocaleString()}</p>
                    <div className="text-right">
                      <button
                        type="button"
                        onClick={() => openEditor(row)}
                        disabled={isBulkExtracting}
                        className="rounded-lg border border-[#c9a84c]/40 bg-transparent px-3 py-1.5 text-xs font-semibold text-[#c9a84c] transition hover:bg-[#c9a84c]/10 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        編集
                      </button>
                    </div>
                    <div className="text-right">
                      <button
                        type="button"
                        onClick={() => void deleteWork(row.source_file)}
                        disabled={isDeletingSourceFile || isBulkExtracting}
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
        </section>

        {editingOriginalSourceFile && (
          <section className="rounded-2xl border border-[#c9a84c]/30 bg-[#10182b] p-6">
            <h2 className="text-xl font-semibold text-[#c9a84c]">作品編集</h2>
            <div className="mt-4 grid gap-4">
              <label className="text-sm text-[#e6d9ae]">
                作品名
                <input
                  type="text"
                  value={editSourceFile}
                  onChange={(e) => setEditSourceFile(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[#c9a84c]/40 bg-[#0d1323] px-3 py-2 text-sm text-[#f3e8c2] outline-none focus:border-[#c9a84c]"
                />
              </label>

              <label className="text-sm text-[#e6d9ae]">
                あらすじ
                <textarea
                  value={editSynopsis}
                  onChange={(e) => setEditSynopsis(e.target.value)}
                  className="mt-1 min-h-24 w-full rounded-lg border border-[#c9a84c]/40 bg-[#0d1323] px-3 py-2 text-sm text-[#f3e8c2] outline-none focus:border-[#c9a84c]"
                />
              </label>

              <label className="text-sm text-[#e6d9ae]">
                本文（表示のみ）
                <textarea
                  value={editContent}
                  readOnly
                  className="mt-1 min-h-48 w-full rounded-lg border border-[#c9a84c]/30 bg-[#0d1323] px-3 py-2 text-xs text-[#e6d9ae] opacity-90"
                />
              </label>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void saveWorkMeta()}
                  disabled={isSavingWork}
                  className="rounded-lg bg-[#c9a84c] px-4 py-2 text-sm font-semibold text-[#0a0e1a] transition hover:bg-[#d7ba67] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  保存
                </button>
                <button
                  type="button"
                  onClick={() => void reextractEventsForEditingWork()}
                  disabled={isReextracting || isBulkExtracting}
                  className="rounded-lg border border-[#c9a84c]/40 bg-transparent px-4 py-2 text-sm font-semibold text-[#c9a84c] transition hover:bg-[#c9a84c]/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  本文からイベント再抽出
                </button>
                <button
                  type="button"
                  onClick={closeEditor}
                  className="rounded-lg border border-[#c9a84c]/40 bg-transparent px-4 py-2 text-sm font-semibold text-[#c9a84c] transition hover:bg-[#c9a84c]/10"
                >
                  閉じる
                </button>
              </div>
            </div>
          </section>
        )}

        <section className="rounded-2xl border border-[#c9a84c]/30 bg-[#10182b] p-6">
          <h2 className="text-xl font-semibold text-[#c9a84c]">年表・因果関係ビューア</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {events.map((item, idx) => (
              <article
                key={`${item.time}-${item.title}-${idx}`}
                className="rounded-xl border border-[#c9a84c]/30 bg-[#0d1323] p-4"
              >
                <p className="text-xs text-[#b8a97b]">{item.time}</p>
                <p className="mt-2 text-base font-semibold text-[#f3e8c2]">{item.title}</p>
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
          {isLoadingEvents && <p className="mt-4 text-sm text-[#b8a97b]">イベントを読み込み中です...</p>}
          {!isLoadingEvents && events.length === 0 && (
            <p className="mt-4 text-sm text-[#b8a97b]">まだイベントがありません。</p>
          )}
        </section>

        <section className="rounded-2xl border border-[#c9a84c]/30 bg-[#10182b] p-6">
          <h2 className="text-xl font-semibold text-[#c9a84c]">世界史ビュー</h2>
          <p className="mt-2 text-sm leading-relaxed text-[#b8a97b]">
            縦軸は時代（古いほど上）。同時代の出来事は横に因果連鎖（実線→）。時代をまたぐ接続は点線です。
          </p>

          {isLoadingEvents && (
            <p className="mt-4 text-sm text-[#b8a97b]">イベントを読み込み中です...</p>
          )}
          {!isLoadingEvents && worldHistoryEras.length === 0 && (
            <p className="mt-4 text-sm text-[#b8a97b]">表示するイベントがありません。</p>
          )}
          {!isLoadingEvents && worldHistoryEras.length > 0 && (
            <div className="mt-6 space-y-0">
              {worldHistoryEras.map((era, eraIdx) => (
                <div key={era.label + eraIdx}>
                  <div className="flex flex-col gap-3 md:flex-row md:items-stretch md:gap-0">
                    <div className="flex w-full shrink-0 items-start border-b border-[#c9a84c]/25 pb-2 md:w-36 md:border-b-0 md:border-r md:border-[#c9a84c]/25 md:pb-0 md:pr-4">
                      <p className="text-sm font-semibold leading-snug text-[#c9a84c]">{era.label}</p>
                    </div>
                    <div className="min-w-0 flex-1 overflow-x-auto pb-1">
                      <div className="flex min-h-[5.5rem] flex-wrap items-center gap-y-2 md:flex-nowrap">
                        {era.events.map((ev, evIdx) => (
                          <React.Fragment key={`${era.label}-${ev.title}-${evIdx}`}>
                            {evIdx > 0 && (
                              <span
                                className="mx-1 shrink-0 select-none text-lg font-semibold text-[#c9a84c]"
                                aria-hidden
                              >
                                →
                              </span>
                            )}
                            <article
                              className={`min-w-[10rem] max-w-xs shrink-0 rounded-xl border px-3 py-2.5 shadow-[0_0_12px_rgba(201,168,76,0.08)] ${worldHistoryCardClass(ev.time)}`}
                            >
                              <p className="text-sm font-semibold leading-snug">{ev.title}</p>
                              <p className="mt-1 line-clamp-3 text-xs leading-relaxed opacity-90">
                                {ev.cause?.trim() ? ev.cause : ev.event}
                              </p>
                            </article>
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  </div>
                  {eraIdx < worldHistoryEras.length - 1 && (
                    <div
                      className="my-5 flex items-center gap-2 md:ml-36"
                      aria-hidden
                    >
                      <div className="h-0 min-w-[2rem] flex-1 border-t-2 border-dashed border-[#c9a84c]/40" />
                      <span className="shrink-0 text-lg font-medium text-[#c9a84c]/90" title="時代をまたぐ因果">
                        ⇢
                      </span>
                      <div className="h-0 min-w-[2rem] flex-1 border-t-2 border-dashed border-[#c9a84c]/40" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-[#c9a84c]/30 bg-[#10182b] p-6">
          <h2 className="text-xl font-semibold text-[#c9a84c]">AIに質問するチャット欄</h2>
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

        {supabaseError && <p className="text-sm text-[#d8a1a1]">Supabaseエラー: {supabaseError}</p>}
      </main>
    </div>
  );
}
