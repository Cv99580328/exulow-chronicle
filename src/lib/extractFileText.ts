function getExtensionLower(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
}

let pdfWorkerSrcConfigured = false;

function configurePdfWorker(pdfjs: typeof import("pdfjs-dist")) {
  if (typeof window === "undefined" || pdfWorkerSrcConfigured) return;
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.mjs`;
  pdfWorkerSrcConfigured = true;
}

async function extractTextFromPdf(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  configurePdfWorker(pdfjs);

  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const parts: string[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const textContent = await page.getTextContent();
    const line = textContent.items
      .map((item) => {
        if (item && typeof item === "object" && "str" in item && typeof item.str === "string") {
          return item.str;
        }
        return "";
      })
      .join(" ");
    parts.push(line);
  }

  return parts.join("\n\n").trim();
}

/**
 * .docx（OOXML）および旧 .doc を mammoth で解釈を試みる。
 * mammoth は .docx を主対象とし .doc は環境によって失敗しやすいため、
 * 例外または mammoth の error メッセージがある場合は file.text() にフォールバックする。
 */
async function extractWordWithMammothOrTextFallback(file: File): Promise<string> {
  try {
    const mammoth = (await import("mammoth")).default;
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });

    const hasMammothError =
      result.messages?.some((m) => m.type === "error") ?? false;
    if (hasMammothError) {
      return (await file.text()).trim();
    }

    return (result.value ?? "").trim();
  } catch {
    try {
      return (await file.text()).trim();
    } catch {
      return "";
    }
  }
}

/**
 * アップロードファイルからプレーンテキストを取り出す（クライアント専用想定）
 */
export async function extractUploadedFileText(file: File): Promise<string> {
  const ext = getExtensionLower(file.name);

  if (ext === "txt" || ext === "text") {
    return file.text();
  }

  if (ext === "docx" || ext === "doc") {
    return extractWordWithMammothOrTextFallback(file);
  }

  if (ext === "pdf") {
    return extractTextFromPdf(file);
  }

  return file.text();
}
