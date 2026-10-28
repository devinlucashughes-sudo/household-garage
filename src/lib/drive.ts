/**
 * The small part of the Google Drive API the backups need. The app holds the connected account's refresh token
 * with the drive.file scope, so it can only see files it created itself.
 */

export const GOOGLE_STATE_COOKIE = "garage_google_state";
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

export class DriveError extends Error {}

type Google = { clientId: string; clientSecret: string };
export type DriveFile = { id: string; name: string };

export interface DriveFolder {
  list(): Promise<DriveFile[]>;
  upload(name: string, bytes: Uint8Array): Promise<DriveFile>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
  download(id: string): Promise<Uint8Array>;
}

export function consentUrl(google: Google, redirectUri: string, state: string) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: google.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: DRIVE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  }).toString();
  return url.toString();
}

async function token(body: Record<string, string>) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const data = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    error?: string;
  };
  if (!response.ok || !data.access_token)
    throw new DriveError(
      data.error === "invalid_grant"
        ? "Google Drive access has expired or was removed. Connect it again."
        : "Google didn't accept the sign-in.",
    );
  return data;
}

/** Trades the one-time code from Google's consent page for a lasting refresh token. */
export async function exchangeCode(google: Google, code: string, redirectUri: string) {
  const data = await token({
    client_id: google.clientId,
    client_secret: google.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  if (!data.refresh_token)
    throw new DriveError("Google didn't return lasting access. Remove the app's access in your Google account and connect again.");
  return data.refresh_token;
}

async function call(accessToken: string, url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...init.headers },
  });
  if (!response.ok) throw new DriveError(`Google Drive refused a request (${response.status}).`);
  return response.status === 204 ? null : response.json();
}

const quote = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/** Opens (creating if needed) a folder the app owns in Owner's Drive. */
export async function openFolder(
  google: Google,
  refreshToken: string,
  folderName: string,
): Promise<DriveFolder> {
  const { access_token: accessToken } = await token({
    client_id: google.clientId,
    client_secret: google.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const at = accessToken!;
  const search = async (q: string) => {
    const url = new URL(API);
    url.search = new URLSearchParams({ q, fields: "files(id,name)", pageSize: "100" }).toString();
    return ((await call(at, url.toString())) as { files: DriveFile[] }).files;
  };
  const found = await search(
    `name = ${quote(folderName)} and mimeType = '${FOLDER_MIME}' and trashed = false`,
  );
  const folderId =
    found[0]?.id ??
    ((await call(at, API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: folderName, mimeType: FOLDER_MIME }),
    })) as DriveFile).id;

  return {
    list: () => search(`${quote(folderId)} in parents and trashed = false`),
    async upload(name, bytes) {
      const boundary = `garage${crypto.randomUUID()}`;
      const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folderId] })}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`;
      const body = new Blob([head, bytes as BlobPart, `\r\n--${boundary}--`]);
      return (await call(at, `${UPLOAD}?uploadType=multipart&fields=id,name`, {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
      })) as DriveFile;
    },
    async rename(id, name) {
      await call(at, `${API}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
    },
    async remove(id) {
      await call(at, `${API}/${id}`, { method: "DELETE" });
    },
    async download(id) {
      const response = await fetch(`${API}/${id}?alt=media`, {
        headers: { Authorization: `Bearer ${at}` },
      });
      if (!response.ok) throw new DriveError(`Google Drive refused a download (${response.status}).`);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}
