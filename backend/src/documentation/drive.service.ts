import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { google } from 'googleapis';
import { Readable } from 'stream';
import * as dotenv from 'dotenv';

dotenv.config();

@Injectable()
export class DriveService {
  private readonly logger = new Logger(DriveService.name);
  private drive: any;

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
    const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();
    if (!rootFolderId) throw new HttpException("Missing GOOGLE_DRIVE_FOLDER_ID in .env", HttpStatus.BAD_REQUEST);

    const query = `name = '${companyName}' and '${rootFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;

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
          fields: 'nextPageToken,incompleteSearch,files(id,name,mimeType,webViewLink,createdTime,size,parents)',
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

      return response.data.webViewLink;
    } catch (error: any) {
      const actualError = error.response?.data?.error?.message || error.message;
      this.logger.error(`Google Drive Upload Failed: ${actualError}`);
      throw new HttpException(actualError, HttpStatus.BAD_REQUEST);
    }
  }

  async deleteFile(fileId: string): Promise<void> {
    try {
      await this.drive.files.delete({ 
        fileId,
        supportsAllDrives: true 
      });
    } catch (error: any) {
      this.logger.warn(`Could not delete file ${fileId} from Drive: ${error.message}`);
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