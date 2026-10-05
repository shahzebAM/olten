import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { google } from 'googleapis';
import { Readable } from 'stream';
import * as dotenv from 'dotenv';

dotenv.config();

export interface DriveFileContent {
  stream: Readable;
  mimeType: string;
  size?: number;
  name?: string;
}

const PREVIEW_MIME_TYPES = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'image/gif',
  'image/webp', 'image/bmp', 'image/avif',
]);
const MAX_PREVIEW_BYTES = 100 * 1024 * 1024;

const driveQueryLiteral = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

@Injectable()
export class DriveService {
  private readonly logger = new Logger(DriveService.name);
  private drive: any;
  private readonly companyFolderRequests = new Map<string, Promise<string>>();
  private readonly companyDirectoryRequests = new Map<string, Promise<{ companyFolderId: string; folders: any[]; files: any[] }>>();

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

  // The document service checks company ownership before calling this method.
  // Stream the durable original without Gemini or a third-party viewer page.
  async downloadFileStream(fileId: string): Promise<DriveFileContent> {
    if (!/^[A-Za-z0-9_-]+$/.test(fileId)) {
      throw new HttpException('Invalid document source ID', HttpStatus.BAD_REQUEST);
    }
    try {
      const metadata = await this.drive.files.get({
        fileId, fields: 'name,mimeType,size,trashed', supportsAllDrives: true,
      });
      if (metadata.data.trashed) {
        throw new HttpException('Document source is no longer available', HttpStatus.NOT_FOUND);
      }
      const mimeType = String(metadata.data.mimeType || '').split(';')[0].trim().toLowerCase();
      // Active HTML and SVG are deliberately never served as inline previews.
      if (!PREVIEW_MIME_TYPES.has(mimeType)) {
        throw new HttpException('This file type must be opened in Drive', HttpStatus.UNSUPPORTED_MEDIA_TYPE);
      }
      const size = Number(metadata.data.size);
      if (Number.isFinite(size) && size > MAX_PREVIEW_BYTES) {
        throw new HttpException('This file is too large for an inline preview. Open it in Drive.', HttpStatus.PAYLOAD_TOO_LARGE);
      }
      const response = await this.drive.files.get({
        fileId, alt: 'media', supportsAllDrives: true,
      }, { responseType: 'stream' });
      return {
        stream: response.data,
        mimeType,
        ...(Number.isSafeInteger(size) && size >= 0 ? { size } : {}),
        ...(typeof metadata.data.name === 'string' ? { name: metadata.data.name } : {}),
      };
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      const code = Number(error.code || error.response?.status || error.response?.data?.error?.code);
      if (code === 404) throw new HttpException('Document source is no longer available', HttpStatus.NOT_FOUND);
      // Do not expose account details or Google API error payloads to clients.
      throw new HttpException('The document could not be loaded. Please retry.', HttpStatus.BAD_GATEWAY);
    }
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
