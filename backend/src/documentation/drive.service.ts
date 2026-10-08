import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { google } from 'googleapis';
import { Readable } from 'stream';
import { createHash } from 'crypto';
import * as dotenv from 'dotenv';

dotenv.config();

export interface DriveFileContent {
  stream: Readable;
  mimeType: string;
  size?: number;
  name?: string;
  totalSize?: number;
  statusCode?: 206;
  contentRange?: string;
  etag?: string;
}

export class DocumentRangeException extends HttpException {
  constructor(readonly totalSize?: number) {
    super('The requested document range is not available', HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE);
  }
}

const PREVIEW_MIME_TYPES = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'image/gif',
  'image/webp', 'image/bmp', 'image/avif',
]);
const MAX_PREVIEW_BYTES = 100 * 1024 * 1024;
const MAX_PREVIEW_DEPTH = 64;
const FILE_METADATA_FIELDS = 'id,name,mimeType,size,trashed,parents,modifiedTime,md5Checksum,version';

const driveQueryLiteral = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

@Injectable()
export class DriveService {
  private readonly logger = new Logger(DriveService.name);
  private drive: any;
  private readonly companyFolderRequests = new Map<string, Promise<string>>();
  private readonly companyDirectoryRequests = new Map<string, Promise<{ companyFolderId: string; folders: any[]; files: any[] }>>();
  private readonly deletingCompanies = new Set<string>();
  private readonly deletedCompanies = new Map<string, () => Promise<boolean>>();

  constructor() {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID?.trim(),
      process.env.GOOGLE_CLIENT_SECRET?.trim(),
      'https://developers.google.com/oauthplayground'
    );

    oauth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN?.trim(),
    });

    this.drive = google.drive({ version: 'v3', auth: oauth2Client });
  }

  async getOrCreateCompanyFolder(companyName: string): Promise<string> {
    this.assertCompanyStorageAvailable(companyName);
    if (this.deletedCompanies.has(companyName)) await this.verifyRecreatedCompany(companyName);
    this.assertCompanyStorageAvailable(companyName);
    let request = this.companyFolderRequests.get(companyName);
    if (!request) {
      request = this.findOrCreateCompanyFolder(companyName);
      this.companyFolderRequests.set(companyName, request);
    }
    try {
      return await request;
    } finally {
      // Concurrent uploads share the lookup and cannot create duplicate roots.
      // Keep no lasting cache, so externally moved/deleted folders are refreshed.
      if (this.companyFolderRequests.get(companyName) === request) this.companyFolderRequests.delete(companyName);
    }
  }

  private assertCompanyStorageAvailable(companyName: string) {
    if (this.deletingCompanies.has(companyName)) {
      throw new HttpException('This workspace is being deleted. Please wait.', HttpStatus.CONFLICT);
    }
  }

  private async verifyRecreatedCompany(companyName: string) {
    const isRecreated = this.deletedCompanies.get(companyName);
    if (!isRecreated) return;
    let available: boolean;
    try { available = await isRecreated(); }
    catch { throw new HttpException('The workspace could not be verified. Please retry.', HttpStatus.SERVICE_UNAVAILABLE); }
    if (!available) throw new HttpException('This workspace was deleted.', HttpStatus.NOT_FOUND);
    this.assertCompanyStorageAvailable(companyName);
    const latest = this.deletedCompanies.get(companyName);
    if (latest && latest !== isRecreated) throw new HttpException('The workspace changed. Refresh and retry.', HttpStatus.CONFLICT);
    if (this.deletedCompanies.get(companyName) === isRecreated) this.deletedCompanies.delete(companyName);
  }

  // Keep the creation barrier until the caller has removed the database company.
  // Deletion only looks up existing roots; it must never create a missing folder.
  async deleteCompanyFolder<T>(companyName: string, completeDeletion: () => Promise<T>, isRecreated?: () => Promise<boolean>): Promise<T> {
    this.assertCompanyStorageAvailable(companyName);
    const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();
    if (!rootFolderId) throw new HttpException('Document storage is not configured', HttpStatus.SERVICE_UNAVAILABLE);
    this.validateFileId(rootFolderId);
    if (typeof companyName !== 'string' || !companyName.trim() || companyName.length > 200) {
      throw new HttpException('Invalid company name', HttpStatus.BAD_REQUEST);
    }
    this.deletingCompanies.add(companyName);
    try {
      // A lookup started before deletion may still be creating the root.
      await this.companyFolderRequests.get(companyName)?.catch(() => undefined);
      const folders = new Set<string>();
      let pageToken: string | undefined;
      do {
        const response = await this.drive.files.list({
          q: `name = '${driveQueryLiteral(companyName)}' and '${driveQueryLiteral(rootFolderId)}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
          fields: 'nextPageToken,incompleteSearch,files(id)', pageSize: 1000, pageToken,
          spaces: 'drive', includeItemsFromAllDrives: true, supportsAllDrives: true,
        }).catch(() => {
          throw new HttpException('Google Drive could not find the workspace folder. Please retry.', HttpStatus.BAD_GATEWAY);
        });
        if (response.data.incompleteSearch) {
          throw new HttpException('Google Drive returned an incomplete folder lookup. Please retry.', HttpStatus.BAD_GATEWAY);
        }
        for (const folder of response.data.files || []) {
          if (typeof folder.id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(folder.id) || folder.id === rootFolderId) {
            throw new HttpException('The workspace folder could not be verified. Please retry.', HttpStatus.BAD_GATEWAY);
          }
          folders.add(folder.id);
        }
        pageToken = response.data.nextPageToken || undefined;
      } while (pageToken);
      for (const fileId of folders) {
        // Fresh metadata protects against folders renamed or moved after lookup.
        let metadata: any;
        try {
          metadata = (await this.drive.files.get({
            fileId, fields: 'name,mimeType,trashed,parents', supportsAllDrives: true,
          })).data;
        } catch (error: any) {
          if (Number(error.code || error.response?.status || error.response?.data?.error?.code) === 404) continue;
          throw new HttpException('The workspace folder could not be verified. Please retry.', HttpStatus.BAD_GATEWAY);
        }
        if (metadata.trashed) continue;
        if (metadata.name !== companyName || metadata.mimeType !== 'application/vnd.google-apps.folder'
          || metadata.parents?.length !== 1 || metadata.parents[0] !== rootFolderId) {
          throw new HttpException('The workspace folder changed. Refresh and retry deletion.', HttpStatus.CONFLICT);
        }
        // Drive deletes the folder's owned descendants without a per-file scan.
        try { await this.deleteFile(fileId); }
        catch { throw new HttpException('Google Drive could not delete the workspace folder. Please retry.', HttpStatus.BAD_GATEWAY); }
      }
      const result = await completeDeletion();
      // Late requests which passed auth before deletion must not recreate a root.
      // Only a new database Company ID can release this process-local tombstone.
      this.deletedCompanies.set(companyName, isRecreated || (async () => false));
      return result;
    } finally {
      this.companyFolderRequests.delete(companyName);
      this.companyDirectoryRequests.delete(companyName);
      this.deletingCompanies.delete(companyName);
    }
  }

  private async findOrCreateCompanyFolder(companyName: string): Promise<string> {
    const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();
    if (!rootFolderId) throw new HttpException("Missing GOOGLE_DRIVE_FOLDER_ID in .env", HttpStatus.BAD_REQUEST);

    const query = `name = '${driveQueryLiteral(companyName)}' and '${driveQueryLiteral(rootFolderId)}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;

    try {
      const searchRes = await this.drive.files.list({
        q: query,
        fields: 'files(id, name)',
        spaces: 'drive',
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
      });

      if (searchRes.data.files && searchRes.data.files.length > 0) {
        return searchRes.data.files[0].id;
      }

      this.logger.log(`Creating root folder for ${companyName}...`);
      const createRes = await this.drive.files.create({
        requestBody: {
          name: companyName,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [rootFolderId],
        },
        fields: 'id',
        supportsAllDrives: true,
      });

      return createRes.data.id;
    } catch (error: any) {
      const actualError = error.response?.data?.error?.message || error.message;
      this.logger.error(`Folder Creation Failed: ${actualError}`);
      throw new HttpException(actualError, HttpStatus.BAD_REQUEST);
    }
  }

  async getCompanyDirectory(companyName: string) {
    this.assertCompanyStorageAvailable(companyName);
    let request = this.companyDirectoryRequests.get(companyName);
    if (!request) {
      request = this.loadCompanyDirectory(companyName);
      this.companyDirectoryRequests.set(companyName, request);
    }
    try {
      return structuredClone(await request);
    } finally {
      // Share only concurrent reads. New requests always recheck Drive, and a
      // completed mutation removes older scans before post-write refreshes.
      if (this.companyDirectoryRequests.get(companyName) === request) this.companyDirectoryRequests.delete(companyName);
    }
  }

  private async loadCompanyDirectory(companyName: string) {
    const companyFolderId = await this.getOrCreateCompanyFolder(companyName);

    const folders: any[] = [];
    const files: any[] = [];

    const pendingFolderIds: string[] = [companyFolderId];
    const seenIds = new Set<string>([companyFolderId]);

    for (let index = 0; index < pendingFolderIds.length; index += 1) {
      const parentId = pendingFolderIds[index];
      let pageToken: string | undefined;

      do {
        const response = await this.drive.files.list({
          q: `'${parentId}' in parents and trashed = false`,
          fields: 'nextPageToken,incompleteSearch,files(id,name,mimeType,webViewLink,createdTime,modifiedTime,md5Checksum,size,parents)',
          spaces: 'drive',
          pageSize: 1000,
          pageToken,
          includeItemsFromAllDrives: true,
          supportsAllDrives: true,
        });

        if (response.data.incompleteSearch) {
          throw new HttpException(
            'Google Drive returned an incomplete directory. Please retry.',
            HttpStatus.BAD_GATEWAY,
          );
        }

        for (const item of response.data.files || []) {
          if (!item.id || seenIds.has(item.id)) continue;

          seenIds.add(item.id);

          if (item.mimeType === 'application/vnd.google-apps.folder') {
            folders.push(item);
            pendingFolderIds.push(item.id);
          } else {
            files.push(item);
          }
        }

        pageToken = response.data.nextPageToken || undefined;
      } while (pageToken);
    }

    return { companyFolderId, folders, files };
  }

  

  // UPDATED: Now accepts an optional parentFolderId to allow nesting
  async createSubFolder(companyName: string, folderName: string, parentFolderId?: string) {
    this.assertCompanyStorageAvailable(companyName);
    if (this.deletedCompanies.has(companyName)) await this.verifyRecreatedCompany(companyName);
    this.assertCompanyStorageAvailable(companyName);
    // If a specific parent folder is passed, use it. Otherwise, default to the company's root folder.
    const parentId = parentFolderId || await this.getOrCreateCompanyFolder(companyName);
    
    try {
      const createRes = await this.drive.files.create({
        requestBody: {
          name: folderName,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [parentId],
        },
        fields: 'id, name',
        supportsAllDrives: true,
      });
      return createRes.data;
    } finally {
      this.companyDirectoryRequests.clear();
    }
  }

  async uploadFileToDrive(fileBuffer: Buffer, mimeType: string, originalName: string, company: string, targetFolderId?: string) {
    this.assertCompanyStorageAvailable(company);
    if (this.deletedCompanies.has(company)) await this.verifyRecreatedCompany(company);
    this.assertCompanyStorageAvailable(company);
    try {
      const destinationFolderId = targetFolderId || (await this.getOrCreateCompanyFolder(company));

      const fileMetadata = {
        name: originalName,
        parents: [destinationFolderId],
      };

      const media = {
        mimeType: mimeType,
        body: Readable.from(fileBuffer),
      };

      const response = await this.drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id, webViewLink',
        supportsAllDrives: true,
      });

      return response.data.webViewLink || `https://drive.google.com/file/d/${response.data.id}/view`;
    } catch (error: any) {
      const actualError = error.response?.data?.error?.message || error.message;
      this.logger.error(`Google Drive Upload Failed: ${actualError}`);
      throw new HttpException(actualError, HttpStatus.BAD_REQUEST);
    } finally {
      this.companyDirectoryRequests.clear();
    }
  }

  async deleteFile(fileId: string): Promise<void> {
    try {
      await this.drive.files.delete({ 
        fileId,
        supportsAllDrives: true 
      });
    } catch (error: any) {
      if (Number(error.code) === 404 || error.response?.status === 404 || error.response?.data?.error?.code === 404) return;
      this.logger.warn(`Could not delete file ${fileId} from Drive: ${error.message}`);
      throw new HttpException('Google Drive could not delete the document. Please retry.', HttpStatus.BAD_GATEWAY);
    } finally {
      this.companyDirectoryRequests.clear();
    }
  }

  // Gemini file URIs expire; the durable Drive copy is the source for reanalysis.
  async downloadFile(fileId: string): Promise<Buffer> {
    const response = await this.drive.files.get({
      fileId,
      alt: 'media',
      supportsAllDrives: true,
    }, { responseType: 'arraybuffer' });
    return Buffer.from(response.data);
  }

  private validateFileId(fileId: string) {
    if (typeof fileId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(fileId)) {
      throw new HttpException('Invalid document source ID', HttpStatus.BAD_REQUEST);
    }
  }

  private previewError(error: any): never {
    if (error instanceof HttpException) throw error;
    const code = Number(error.code || error.response?.status || error.response?.data?.error?.code);
    if (code === 404) throw new HttpException('Document source is no longer available', HttpStatus.NOT_FOUND);
    // Do not expose account details or Google API error payloads to clients.
    throw new HttpException('The document could not be loaded. Please retry.', HttpStatus.BAD_GATEWAY);
  }

  // Preview and replacement verify the exact current source. No ownership
  // result is cached, so external moves, renames and trash changes are checked.
  async getCompanyFileMetadata(fileId: string, companyName: string): Promise<any> {
    this.validateFileId(fileId);
    const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();
    if (!rootFolderId) throw new HttpException('Document storage is not configured', HttpStatus.SERVICE_UNAVAILABLE);
    this.validateFileId(rootFolderId);
    try {
      const metadata = await this.drive.files.get({
        fileId, fields: FILE_METADATA_FIELDS, supportsAllDrives: true,
      });
      if (metadata.data.mimeType === 'application/vnd.google-apps.folder') {
        throw new HttpException('Document not found in this company', HttpStatus.NOT_FOUND);
      }
      let item = metadata.data;
      const visited = new Set<string>([fileId]);
      let owned = false;
      for (let depth = 0; depth < MAX_PREVIEW_DEPTH; depth += 1) {
        if (item.trashed || !Array.isArray(item.parents) || item.parents.length !== 1) break;
        const parentId = item.parents[0];
        if (parentId === rootFolderId) {
          owned = item.mimeType === 'application/vnd.google-apps.folder' && item.name === companyName;
          break;
        }
        if (typeof parentId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(parentId) || visited.has(parentId)) break;
        visited.add(parentId);
        const parent = await this.drive.files.get({
          fileId: parentId, fields: 'name,mimeType,trashed,parents', supportsAllDrives: true,
        });
        item = parent.data;
        if (item.mimeType !== 'application/vnd.google-apps.folder') break;
      }
      if (!owned) throw new HttpException('Document not found in this company', HttpStatus.NOT_FOUND);
      return metadata.data;
    } catch (error: any) {
      this.previewError(error);
    }
  }

  async downloadCompanyFileStream(fileId: string, companyName: string, range?: string, ifRange?: string): Promise<DriveFileContent> {
    const metadata = await this.getCompanyFileMetadata(fileId, companyName);
    try { return await this.streamPreview(fileId, metadata, range, ifRange); }
    catch (error: any) { this.previewError(error); }
  }

  // Kept for callers which already authorize the original source themselves.
  async downloadFileStream(fileId: string, range?: string, ifRange?: string): Promise<DriveFileContent> {
    this.validateFileId(fileId);
    try {
      const metadata = await this.drive.files.get({
        fileId, fields: FILE_METADATA_FIELDS, supportsAllDrives: true,
      });
      return await this.streamPreview(fileId, metadata.data, range, ifRange);
    } catch (error: any) {
      this.previewError(error);
    }
  }

  private previewRange(range: string | undefined, size: number | undefined): { start: number; end: number } | undefined {
    if (range === undefined) return undefined;
    const match = typeof range === 'string' && range.length <= 200 ? /^bytes=(\d*)-(\d*)$/i.exec(range.trim()) : null;
    if (!match || (!match[1] && !match[2])) throw new DocumentRangeException(size);
    const first = match[1] ? Number(match[1]) : undefined;
    const last = match[2] ? Number(match[2]) : undefined;
    if ((first !== undefined && !Number.isSafeInteger(first)) || (last !== undefined && !Number.isSafeInteger(last))
      || (first !== undefined && last !== undefined && last < first) || (first === undefined && last === 0)) {
      throw new DocumentRangeException(size);
    }
    // Drive binary objects normally have a known length. An unknown length
    // keeps the ordinary full stream; it cannot be advertised as a partial one.
    if (size === undefined) return undefined;
    if (!size || (first !== undefined && first >= size)) throw new DocumentRangeException(size);
    return first === undefined
      ? { start: Math.max(0, size - last!), end: size - 1 }
      : { start: first, end: Math.min(last ?? size - 1, size - 1) };
  }

  private async streamPreview(fileId: string, metadata: any, range?: string, ifRange?: string): Promise<DriveFileContent> {
    if (metadata.trashed) {
      throw new HttpException('Document source is no longer available', HttpStatus.NOT_FOUND);
    }
    const mimeType = String(metadata.mimeType || '').split(';')[0].trim().toLowerCase();
    // Active HTML and SVG are deliberately never served as inline previews.
    if (!PREVIEW_MIME_TYPES.has(mimeType)) {
      throw new HttpException('This file type must be opened in Drive', HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    }
    const rawSize = Number(metadata.size);
    const size = metadata.size !== undefined && Number.isSafeInteger(rawSize) && rawSize >= 0 ? rawSize : undefined;
    if (size !== undefined && size > MAX_PREVIEW_BYTES) {
      throw new HttpException('This file is too large for an inline preview. Open it in Drive.', HttpStatus.PAYLOAD_TOO_LARGE);
    }
    const etag = metadata.md5Checksum || metadata.version ? `"${createHash('sha256')
      .update(JSON.stringify([fileId, metadata.md5Checksum, metadata.version, metadata.modifiedTime, size])).digest('hex')}"` : undefined;
    let partial = this.previewRange(range, size);
    if (ifRange !== undefined && ifRange !== etag) partial = undefined;
    const expectedContentRange = partial ? `bytes ${partial.start}-${partial.end}/${size}` : undefined;
    const response = await this.drive.files.get({
      fileId, alt: 'media', supportsAllDrives: true,
    }, { responseType: 'stream', headers: { 'Accept-Encoding': 'identity',
      ...(partial ? { Range: `bytes=${partial.start}-${partial.end}` } : {}) } });
    const header = (name: string): string => String(response.headers?.get?.(name) ?? response.headers?.[name] ?? '');
    const servedPartial = response.status === 206 ? partial : undefined;
    const upstreamSize = header('content-length') ? Number(header('content-length')) : undefined;
    const fullSize = size ?? (Number.isSafeInteger(upstreamSize) && upstreamSize! >= 0 ? upstreamSize : undefined);
    if (!servedPartial && fullSize !== undefined && fullSize > MAX_PREVIEW_BYTES) {
      response.data.destroy();
      throw new HttpException('This file is too large for an inline preview. Open it in Drive.', HttpStatus.PAYLOAD_TOO_LARGE);
    }
    const contentLength = servedPartial ? servedPartial.end - servedPartial.start + 1 : fullSize;
    if ((response.status === 206 && !servedPartial)
      || (servedPartial && header('content-range') !== expectedContentRange)
      || (upstreamSize !== undefined && upstreamSize !== contentLength)) {
      response.data.destroy();
      throw new HttpException('The document changed while loading. Please retry.', HttpStatus.BAD_GATEWAY);
    }
    return {
      stream: response.data,
      mimeType,
      ...(contentLength !== undefined ? { size: contentLength, totalSize: fullSize } : {}),
      ...(servedPartial ? { statusCode: 206 as const, contentRange: expectedContentRange } : {}),
      ...(typeof metadata.name === 'string' ? { name: metadata.name } : {}),
      ...(etag ? { etag } : {}),
    };
  }

  // Method to rename folders (or files)
  async renameFolder(folderId: string, newName: string) {
    try {
      const response = await this.drive.files.update({
        fileId: folderId,
        requestBody: {
          name: newName,
        },
        fields: 'id, name',
        supportsAllDrives: true,
      });
      return response.data;
    } catch (error: any) {
      const actualError = error.response?.data?.error?.message || error.message;
      this.logger.error(`Folder Rename Failed: ${actualError}`);
      throw new HttpException(actualError, HttpStatus.BAD_REQUEST);
    } finally {
      this.companyDirectoryRequests.clear();
    }
  }

  

  // --- NEW: Fetch exact storage quota from Google Drive ---
  async getStorageQuota() {
    try {
      const aboutRes = await this.drive.about.get({ fields: 'storageQuota' });
      return {
        usage: aboutRes.data.storageQuota?.usage || '0',
        limit: aboutRes.data.storageQuota?.limit || '0',
      };
    } catch (error: any) {
      this.logger.warn(`Could not fetch storage quota: ${error.message}`);
      return null;
    }
  }
}
