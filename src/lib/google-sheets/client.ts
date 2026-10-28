import "server-only";

import { google } from "googleapis";
import { normalizeHeader } from "./sync-plan";

export interface GoogleSheetsConfig {
  spreadsheetId: string;
  tabName: string;
  serviceAccountEmail: string;
  privateKey: string;
  headerMap: { headerRow: number; name: string; email: string; profileUrl: string };
  matchSecret: string;
}

export function getGoogleSheetsConfig(): GoogleSheetsConfig {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim() ?? "";
  const tabName = process.env.GOOGLE_SHEETS_TAB_NAME?.trim() ?? "";
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim() ?? "";
  const privateKey = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? "").replace(/\\n/g, "\n").trim();
  const matchSecret = process.env.PARTICIPANT_MATCH_HMAC_SECRET ?? "";
  const headerRow = Number(process.env.GOOGLE_SHEETS_HEADER_ROW ?? "1");
  const headerMap = {
    headerRow,
    name: process.env.GOOGLE_SHEETS_NAME_HEADER?.trim() ?? "",
    email: process.env.GOOGLE_SHEETS_EMAIL_HEADER?.trim() ?? "",
    profileUrl: process.env.GOOGLE_SHEETS_PROFILE_URL_HEADER?.trim() ?? "",
  };
  if (!/^[A-Za-z0-9_-]{20,}$/.test(spreadsheetId) || !tabName || !serviceAccountEmail || !privateKey.includes("PRIVATE KEY") || Buffer.byteLength(matchSecret, "utf8") < 32) {
    throw new Error("Google Sheets sync is not configured. Check the server environment variables in the setup guide.");
  }
  if (!Number.isInteger(headerRow) || headerRow < 1 || headerRow > 20 || !headerMap.name || !headerMap.email || !headerMap.profileUrl) {
    throw new Error("Google Sheets header mapping is incomplete. Set the exact response-sheet header names and header row.");
  }
  return { spreadsheetId, tabName, serviceAccountEmail, privateKey, headerMap, matchSecret };
}

function columnName(index: number) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

export async function readGoogleFormResponseRows(config: GoogleSheetsConfig) {
  const auth = new google.auth.JWT({
    email: config.serviceAccountEmail,
    key: config.privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const escapedTabName = config.tabName.replace(/'/g, "''");
  try {
    const sheets = google.sheets({ version: "v4", auth });
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: config.spreadsheetId,
      range: `'${escapedTabName}'!A${config.headerMap.headerRow}:ZZ${config.headerMap.headerRow}`,
      valueRenderOption: "FORMATTED_VALUE",
    });
    const header = (headerResponse.data.values?.[0] ?? []) as unknown[];
    const findColumn = (configured: string) => {
      const target = normalizeHeader(configured);
      const matches = header.flatMap((cell, index) => normalizeHeader(cell) === target ? [index] : []);
      return matches.length === 1 ? matches[0] : -1;
    };
    const columns = [
      findColumn(config.headerMap.name),
      findColumn(config.headerMap.email),
      findColumn(config.headerMap.profileUrl),
    ];
    const precedingBlankRows = Array.from({ length: config.headerMap.headerRow - 1 }, () => [] as unknown[]);
    if (columns.some((column) => column < 0)) return [...precedingBlankRows, header];

    const endRow = config.headerMap.headerRow + 501;
    const selectedValues = await Promise.all(columns.map(async (column) => {
      const letter = columnName(column);
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: config.spreadsheetId,
        range: `'${escapedTabName}'!${letter}${config.headerMap.headerRow + 1}:${letter}${endRow}`,
        valueRenderOption: "FORMATTED_VALUE",
      });
      return (response.data.values ?? []).map((row) => row?.[0] ?? "");
    }));
    const rowCount = Math.max(0, ...selectedValues.map((column) => column.length));
    return [...precedingBlankRows,
      columns.map((column) => header[column]),
      ...Array.from({ length: rowCount }, (_, index) => columns.map((_column, columnIndex) => selectedValues[columnIndex][index] ?? "")),
    ];
  } catch {
    throw new Error("Could not read the private Google Sheet. Check that the Sheets API is enabled and the service account has Viewer access to this spreadsheet.");
  }
}
