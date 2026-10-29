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

export class GoogleSheetsConfigError extends Error {
  readonly missingOrInvalid: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "GoogleSheetsConfigError";
    this.missingOrInvalid = field;
  }
}

export class GoogleSheetsReadError extends Error {
  readonly code: string;
  readonly status?: number;
  constructor(message: string, code: string, status?: number) {
    super(message);
    this.name = "GoogleSheetsReadError";
    this.code = code;
    this.status = status;
  }
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

  if (!spreadsheetId || !/^[A-Za-z0-9_-]{20,}$/.test(spreadsheetId)) {
    throw new GoogleSheetsConfigError("GOOGLE_SHEETS_SPREADSHEET_ID", "GOOGLE_SHEETS_SPREADSHEET_ID is missing or not a valid Google Spreadsheet ID.");
  }
  if (!tabName) {
    throw new GoogleSheetsConfigError("GOOGLE_SHEETS_TAB_NAME", "GOOGLE_SHEETS_TAB_NAME is missing.");
  }
  if (!serviceAccountEmail) {
    throw new GoogleSheetsConfigError("GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_SERVICE_ACCOUNT_EMAIL is missing.");
  }
  if (!privateKey || !privateKey.includes("PRIVATE KEY")) {
    throw new GoogleSheetsConfigError("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is missing or does not contain a PRIVATE KEY header.");
  }
  if (Buffer.byteLength(matchSecret, "utf8") < 32) {
    throw new GoogleSheetsConfigError("PARTICIPANT_MATCH_HMAC_SECRET", "PARTICIPANT_MATCH_HMAC_SECRET is missing or must be at least 32 bytes.");
  }
  if (!Number.isInteger(headerRow) || headerRow < 1 || headerRow > 20) {
    throw new GoogleSheetsConfigError("GOOGLE_SHEETS_HEADER_ROW", "GOOGLE_SHEETS_HEADER_ROW must be an integer between 1 and 20.");
  }
  if (!headerMap.name) {
    throw new GoogleSheetsConfigError("GOOGLE_SHEETS_NAME_HEADER", "GOOGLE_SHEETS_NAME_HEADER is missing.");
  }
  if (!headerMap.email) {
    throw new GoogleSheetsConfigError("GOOGLE_SHEETS_EMAIL_HEADER", "GOOGLE_SHEETS_EMAIL_HEADER is missing.");
  }
  if (!headerMap.profileUrl) {
    throw new GoogleSheetsConfigError("GOOGLE_SHEETS_PROFILE_URL_HEADER", "GOOGLE_SHEETS_PROFILE_URL_HEADER is missing.");
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
  } catch (err: unknown) {
    const error = err as {
      code?: string | number;
      status?: number;
      message?: string;
      response?: {
        status?: number;
        data?: {
          error?: string | { code?: number; message?: string; status?: string };
          error_description?: string;
        };
      };
    };
    const status = error.response?.status ?? (typeof error.status === "number" ? error.status : (typeof error.code === "number" ? error.code : undefined));
    const rawCode = typeof error.code === "string" ? error.code : undefined;
    const responseError = typeof error.response?.data?.error === "string" ? error.response.data.error : error.response?.data?.error?.message;
    const errorDesc = error.response?.data?.error_description;
    const rawMessage = error.message ?? "";

    let code = typeof rawCode === "string" ? rawCode : (status ? String(status) : "READ_FAILED");
    let safeMessage = "Could not read the private Google Sheet. Check that the Sheets API is enabled and the service account has Viewer access to this spreadsheet.";

    if (errorDesc?.includes("invalid_grant") || responseError?.includes("invalid_grant") || rawMessage.includes("invalid_grant")) {
      code = "invalid_grant";
      safeMessage = "Google service account authentication failed (invalid_grant). Check service account email and private key formatting/newlines.";
    } else if (rawMessage.includes("PEM") || rawCode?.includes("PEM") || rawMessage.includes("DEK-Info") || rawMessage.includes("key format")) {
      code = "INVALID_KEY_FORMAT";
      safeMessage = "Google service account private key format is invalid. Check private key PEM formatting and newlines.";
    } else if (status === 403) {
      code = "PERMISSION_DENIED";
      safeMessage = "Google Sheets API returned 403 Forbidden. Confirm Sheets API is enabled in Google Cloud Console and the spreadsheet is shared with the service account as Viewer.";
    } else if (status === 404) {
      code = "SPREADSHEET_NOT_FOUND";
      safeMessage = "Google Sheets API returned 404 Not Found. Check GOOGLE_SHEETS_SPREADSHEET_ID.";
    } else if (status === 400) {
      code = "BAD_REQUEST";
      safeMessage = "Google Sheets API returned 400 Bad Request. Check GOOGLE_SHEETS_TAB_NAME matches the tab name in the spreadsheet exactly.";
    } else if (rawCode === "ENOTFOUND" || rawCode === "ETIMEDOUT" || rawCode === "ECONNREFUSED") {
      code = rawCode;
      safeMessage = `Network error connecting to Google Sheets API (${rawCode}).`;
    }

    throw new GoogleSheetsReadError(safeMessage, code, status);
  }
}
