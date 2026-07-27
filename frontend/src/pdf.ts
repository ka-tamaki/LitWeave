export async function readPdfSignature(file: File) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      file.slice(0, 5).arrayBuffer().then(value => new TextDecoder("ascii").decode(value)),
      new Promise<string>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new DOMException("PDFの読み出しがタイムアウトしました。", "TimeoutError")),
          15_000,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
