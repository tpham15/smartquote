import { htmlTableToGrid, markdownTableToGrid, tableGridToPredictionRows } from "./paddleocr-vl-normalize.mjs";

function pageNumber(page, index) {
  if (Number.isInteger(page?.page_index)) return page.page_index + 1;
  if (Number.isInteger(page?.pageIndex)) return page.pageIndex + 1;
  if (Number.isInteger(page?.page)) return page.page;
  if (Number.isInteger(page?.pageNo)) return page.pageNo;
  return index + 1;
}

function officialPages(raw) {
  if (Array.isArray(raw?.pages)) return raw.pages;
  if (Array.isArray(raw?.result?.pages)) return raw.result.pages;
  if (Array.isArray(raw?.data?.pages)) return raw.data.pages;
  if (Array.isArray(raw?.results)) return raw.results;
  return [];
}

function markdownOf(page) {
  return String(
    page?.markdownText ?? page?.markdown_text ?? page?.markdown ?? page?.content ?? ""
  );
}

export function markdownTablesToGrids(markdown) {
  const source = String(markdown || "");
  const out = [];
  for (const match of source.matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
    const grid = htmlTableToGrid(match[0]);
    if (grid.length >= 2) out.push(grid);
  }

  const lines = source.split(/\r?\n/);
  let group = [];
  const flush = () => {
    if (group.length >= 2) {
      const grid = markdownTableToGrid(group.join("\n"));
      if (grid.length >= 2) out.push(grid);
    }
    group = [];
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.includes("|") && /^\s*\|?.*\|.*\|?\s*$/.test(line)) group.push(line);
    else flush();
  }
  flush();
  return out;
}

export function normalizePaddleOfficialApiResult(raw) {
  const pages = officialPages(raw);
  return pages.flatMap((page, index) => {
    const pageNo = pageNumber(page, index);
    const markdown = markdownOf(page);
    return markdownTablesToGrids(markdown).flatMap((grid, tableIndex) =>
      tableGridToPredictionRows(grid, {
        page: pageNo,
        bbox: null,
        blockId: `official-api-page-${pageNo}-table-${tableIndex + 1}`,
        tableIndex,
      }).map((row) => ({
        ...row,
        meta: {
          ...(row.meta || {}),
          backend: "paddleocr-official-api",
          apiModel: "PaddleOCR-VL-1.6",
          groundingLevel: "page_table_only",
        },
      }))
    );
  });
}
