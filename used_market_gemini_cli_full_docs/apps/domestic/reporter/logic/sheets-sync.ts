import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { google } from "googleapis";
import { parseRunIdTimestamp, toKstDateKey } from "../../merge/logic/run-retention.js";
import { buildSheetsWorkbook, type SheetsWorkbookTab } from "./sheets-dashboard.js";
import type { ReporterCandidate, ReporterSourceData } from "./types.js";

const CLEAR_RANGE = "A:ZZ";

export interface SheetsSyncResult {
  success: boolean;
  rowsWritten: number;
  reason?: string;
}

function isMockUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.hostname === "example.com" || parsed.hostname.endsWith(".example.com");
  } catch {
    return false;
  }
}

function isMockCandidate(candidate: ReporterCandidate) {
  return isMockUrl(candidate.url)
    || candidate.seller.toLowerCase().includes("mock")
    || candidate.title.toLowerCase().includes("mock");
}

function shouldBlockMockSheetUploads() {
  return process.env.REPORTER_BLOCK_MOCK_SHEET_UPLOADS === "true";
}

function toColumnLetter(columnIndex: number) {
  let dividend = columnIndex + 1;
  let columnName = "";

  while (dividend > 0) {
    const modulo = (dividend - 1) % 26;
    columnName = String.fromCharCode(65 + modulo) + columnName;
    dividend = Math.floor((dividend - modulo) / 26);
  }

  return columnName;
}

function hexColor(hex: string) {
  const normalized = hex.replace("#", "");
  const red = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const green = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  return { red, green, blue };
}

function tabColorForTitle(title: string) {
  if (title === "recommendations") return hexColor("#2563EB");
  if (title === "criteria") return hexColor("#0F766E");
  if (title === "price_history") return hexColor("#0EA5E9");
  if (title === "deal_board") return hexColor("#16A34A");
  if (title === "dashboard" || title === "build_board" || title === "component_market") return hexColor("#0284C7");
  if (title === "gpu_market" || title === "cpu_market" || title === "memory_market" || title === "platform_market") {
    return hexColor("#0284C7");
  }
  if (title === "keyword_watchlist") return hexColor("#EA580C");
  if (title === "listing_components") return hexColor("#7C3AED");
  if (title === "raw_listings") return hexColor("#64748B");
  return hexColor("#334155");
}

function buildGridRange(
  sheetId: number,
  startRowIndex: number,
  endRowIndex: number,
  startColumnIndex: number,
  endColumnIndex: number
) {
  return {
    sheetId,
    startRowIndex,
    endRowIndex,
    startColumnIndex,
    endColumnIndex
  };
}

async function ensureSheetMap(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  titles: string[]
) {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetIdByTitle = new Map<string, number>();
  for (const sheet of spreadsheet.data.sheets ?? []) {
    const title = sheet.properties?.title;
    const sheetId = sheet.properties?.sheetId;
    if (title && typeof sheetId === "number") {
      sheetIdByTitle.set(title, sheetId);
    }
  }

  const missingTitles = titles.filter((title) => !sheetIdByTitle.has(title));
  if (missingTitles.length > 0) {
    const response = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: missingTitles.map((title, index) => ({
          addSheet: {
            properties: {
              title,
              index
            }
          }
        }))
      }
    });

    for (let index = 0; index < missingTitles.length; index += 1) {
      const replySheetId = response.data.replies?.[index]?.addSheet?.properties?.sheetId;
      if (typeof replySheetId === "number") {
        sheetIdByTitle.set(missingTitles[index], replySheetId);
      }
    }
  }

  return sheetIdByTitle;
}

function buildFormattingRequests(
  tabs: SheetsWorkbookTab[],
  sheetIdByTitle: Map<string, number>
) {
  const requests: Array<Record<string, unknown>> = [];
  const dashboardTitles = new Set(tabs.map((tab) => tab.title));
  const legacyTitles = new Set([
    "dashboard",
    "build_board",
    "deal_board",
    "component_market",
    "gpu_market",
    "cpu_market",
    "memory_market",
    "platform_market"
  ]);

  for (let tabIndex = 0; tabIndex < tabs.length; tabIndex += 1) {
    const tab = tabs[tabIndex];
    const sheetId = sheetIdByTitle.get(tab.title);
    if (typeof sheetId !== "number") continue;

    const rowCount = tab.values.length;
    const columnCount = tab.values.reduce((max, row) => Math.max(max, row.length), 0);
    if (columnCount === 0) continue;

    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId,
          index: tabIndex,
          hidden: tab.hidden ?? false,
          tabColorStyle: {
            rgbColor: tabColorForTitle(tab.title)
          },
          gridProperties: {
            frozenRowCount: tab.freezeRows ?? (tab.freezeHeader ? 1 : 0),
            frozenColumnCount: tab.freezeColumns ?? 0,
            hideGridlines: tab.hideGridlines ?? false
          }
        },
        fields: "index,hidden,tabColorStyle,gridProperties.frozenRowCount,gridProperties.frozenColumnCount,gridProperties.hideGridlines"
      }
    });

    const headerRows = tab.headerRows ?? [0];
    for (const headerRow of headerRows) {
      requests.push({
        repeatCell: {
          range: buildGridRange(sheetId, headerRow, headerRow + 1, 0, columnCount),
          cell: {
            userEnteredFormat: {
              backgroundColor: hexColor("#0F172A"),
              textFormat: {
                bold: true,
                foregroundColor: hexColor("#F8FAFC")
              },
              horizontalAlignment: "CENTER"
            }
          },
          fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)"
        }
      });
    }

    if (tab.useFilter !== false && headerRows.length === 1 && headerRows[0] === 0) {
      requests.push({
        setBasicFilter: {
          filter: {
            range: buildGridRange(sheetId, 0, rowCount, 0, columnCount)
          }
        }
      });
    }

    if (tab.currencyColumns) {
      for (const columnIndex of tab.currencyColumns) {
        requests.push({
          repeatCell: {
            range: buildGridRange(sheetId, 1, rowCount, columnIndex, columnIndex + 1),
            cell: {
              userEnteredFormat: {
                numberFormat: {
                  type: "NUMBER",
                  pattern: "#,##0"
                }
              }
            },
            fields: "userEnteredFormat.numberFormat"
          }
        });
      }
    }

    if (tab.percentColumns) {
      for (const columnIndex of tab.percentColumns) {
        requests.push({
          repeatCell: {
            range: buildGridRange(sheetId, 1, rowCount, columnIndex, columnIndex + 1),
            cell: {
              userEnteredFormat: {
                numberFormat: {
                  type: "PERCENT",
                  pattern: "0.0%"
                }
              }
            },
            fields: "userEnteredFormat.numberFormat"
          }
        });
      }
    }

    if (tab.wrapColumns) {
      for (const columnIndex of tab.wrapColumns) {
        requests.push({
          repeatCell: {
            range: buildGridRange(sheetId, 1, rowCount, columnIndex, columnIndex + 1),
            cell: {
              userEnteredFormat: {
                wrapStrategy: "WRAP"
              }
            },
            fields: "userEnteredFormat.wrapStrategy"
          }
        });
      }
    }

    if (tab.centerColumns) {
      for (const columnIndex of tab.centerColumns) {
        requests.push({
          repeatCell: {
            range: buildGridRange(sheetId, 1, rowCount, columnIndex, columnIndex + 1),
            cell: {
              userEnteredFormat: {
                horizontalAlignment: "CENTER"
              }
            },
            fields: "userEnteredFormat.horizontalAlignment"
          }
        });
      }
    }

    if (tab.titleRows) {
      for (const rowIndex of tab.titleRows) {
        requests.push({
          repeatCell: {
            range: buildGridRange(sheetId, rowIndex, rowIndex + 1, 0, columnCount),
            cell: {
              userEnteredFormat: {
                backgroundColor: hexColor("#0F172A"),
                textFormat: {
                  bold: true,
                  fontSize: 14,
                  foregroundColor: hexColor("#F8FAFC")
                }
              }
            },
            fields: "userEnteredFormat(backgroundColor,textFormat)"
          }
        });
      }
    }

    if (tab.sectionRows) {
      for (const rowIndex of tab.sectionRows) {
        requests.push({
          repeatCell: {
            range: buildGridRange(sheetId, rowIndex, rowIndex + 1, 0, columnCount),
            cell: {
              userEnteredFormat: {
                backgroundColor: hexColor("#E2E8F0"),
                textFormat: {
                  bold: true,
                  foregroundColor: hexColor("#0F172A")
                }
              }
            },
            fields: "userEnteredFormat(backgroundColor,textFormat)"
          }
        });
      }
    }

    if (typeof tab.decisionColumn === "number") {
      for (let rowIndex = 1; rowIndex < rowCount; rowIndex += 1) {
        const decisionValue = String(tab.values[rowIndex]?.[tab.decisionColumn] ?? "").toUpperCase();
        const backgroundColor = decisionValue === "BUY"
          ? "#DCFCE7"
          : decisionValue === "WATCH"
            ? "#DBEAFE"
          : decisionValue === "CHECK"
            ? "#FEF3C7"
            : "#FEE2E2";
        const foregroundColor = decisionValue === "BUY"
          ? "#166534"
          : decisionValue === "WATCH"
            ? "#1D4ED8"
          : decisionValue === "CHECK"
            ? "#92400E"
            : "#991B1B";

        requests.push({
          repeatCell: {
            range: buildGridRange(sheetId, rowIndex, rowIndex + 1, tab.decisionColumn, tab.decisionColumn + 1),
            cell: {
              userEnteredFormat: {
                backgroundColor: hexColor(backgroundColor),
                textFormat: {
                  bold: true,
                  foregroundColor: hexColor(foregroundColor)
                },
                horizontalAlignment: "CENTER"
              }
            },
            fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)"
          }
        });
      }
    }

    requests.push({
      autoResizeDimensions: {
        dimensions: {
          sheetId,
          dimension: "COLUMNS",
          startIndex: 0,
          endIndex: columnCount
        }
      }
    });

    if (tab.columnWidths) {
      for (const widthSetting of tab.columnWidths) {
        requests.push({
          updateDimensionProperties: {
            range: {
              sheetId,
              dimension: "COLUMNS",
              startIndex: widthSetting.columnIndex,
              endIndex: widthSetting.columnIndex + 1
            },
            properties: {
              pixelSize: widthSetting.width
            },
            fields: "pixelSize"
          }
        });
      }
    }
  }

  for (const [title, sheetId] of sheetIdByTitle.entries()) {
    if (dashboardTitles.has(title)) continue;
    if (legacyTitles.has(title)) {
      requests.push({
        updateSheetProperties: {
          properties: {
            sheetId,
            hidden: true
          },
          fields: "hidden"
        }
      });
      continue;
    }
    if (title !== "Sheet1" && title !== "시트1" && title !== "opportunities") continue;

    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId,
          hidden: true
        },
        fields: "hidden"
      }
    });
  }

  return requests;
}

async function pruneSheetCacheFiles(cacheDir: string, retentionDays: number) {
  if (!Number.isFinite(retentionDays) || retentionDays < 1) return;

  const allowedDateKeys = new Set<string>();
  const now = new Date();
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const startUtcMs = Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate()) - 9 * 60 * 60 * 1000;
  for (let index = 0; index < retentionDays; index += 1) {
    allowedDateKeys.add(toKstDateKey(new Date(startUtcMs - index * 24 * 60 * 60 * 1000)));
  }
  const entries = await readdir(cacheDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const timestamp = parseRunIdTimestamp(entry.name.replace(/\.json$/i, ""));
    if (!timestamp || allowedDateKeys.has(toKstDateKey(timestamp))) continue;
    await rm(path.join(cacheDir, entry.name), { force: true });
  }
}

export async function syncToSheets(
  runId: string,
  source: ReporterSourceData,
  spreadsheetId?: string,
  credentialsPath?: string
): Promise<SheetsSyncResult> {
  if (!spreadsheetId) {
    return {
      success: false,
      rowsWritten: 0,
      reason: "missing GOOGLE_SHEETS_SPREADSHEET_ID"
    };
  }

  const workbook = buildSheetsWorkbook(runId, source);

  if (shouldBlockMockSheetUploads() && source.candidates.some((candidate) => isMockCandidate(candidate))) {
    return {
      success: false,
      rowsWritten: 0,
      reason: "mock_candidate_rows_blocked"
    };
  }

  if (!credentialsPath) {
    return {
      success: false,
      rowsWritten: 0,
      reason: "missing GOOGLE_SHEETS_CREDENTIALS_JSON"
    };
  }

  const cacheDir = path.resolve(process.cwd(), "merge/result/reporter/sheets-cache");
  await mkdir(cacheDir, { recursive: true });
  await writeFile(
    path.join(cacheDir, `${runId}.json`),
    JSON.stringify({ spreadsheetId, source, workbook }, null, 2),
    "utf-8"
  );
  const cacheRetentionDays = Number(process.env.REPORTER_SHEETS_CACHE_RETENTION_DAYS ?? "30");
  if (Number.isFinite(cacheRetentionDays) && cacheRetentionDays >= 1) {
    await pruneSheetCacheFiles(cacheDir, Math.floor(cacheRetentionDays));
  }

  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: path.resolve(credentialsPath),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });

    const sheets = google.sheets({ version: "v4", auth });
    const sheetIdByTitle = await ensureSheetMap(
      sheets,
      spreadsheetId,
      workbook.tabs.map((tab) => tab.title)
    );

    for (const tab of workbook.tabs) {
      const lastColumn = toColumnLetter(
        tab.values.reduce((max, row) => Math.max(max, row.length), 1) - 1
      );
      await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: `${tab.title}!${CLEAR_RANGE}`
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${tab.title}!A1:${lastColumn}${tab.values.length}`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: tab.values
        }
      });
    }

    const requests = buildFormattingRequests(workbook.tabs, sheetIdByTitle);
    if (requests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests
        }
      });
    }
  } catch (error) {
    return {
      success: false,
      rowsWritten: 0,
      reason: error instanceof Error ? error.message : String(error)
    };
  }

  return {
    success: true,
    rowsWritten: source.candidates.length
  };
}
