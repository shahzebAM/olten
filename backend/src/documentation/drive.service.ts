import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { google } from 'googleapis';
import { Readable } from 'stream';
import * as dotenv from 'dotenv';

dotenv.config(); // 1. Force NestJS to load the .env variables!

@Injectable()
export class DriveService {
  private readonly logger = new Logger(DriveService.name);
  private drive: any;

  constructor() {
    // 2. We use .trim() to automatically delete any accidental spaces copied from the browser
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
      });

      return createRes.data.id;
    } catch (error: any) {
      // 3. This stops the terminal crash and prints only the ACTUAL 1-sentence error!
      const actualError = error.response?.data?.error?.message || error.message;
      this.logger.error(`Folder Creation Failed: ${actualError}`);
      throw new HttpException(actualError, HttpStatus.BAD_REQUEST);
    }
  }

  async getCompanyDirectory(companyName: string) {
    const companyFolderId = await this.getOrCreateCompanyFolder(companyName);

    const query = `'${companyFolderId}' in parents and trashed = false`;
    const res = await this.drive.files.list({
      q: query,
      fields: 'files(id, name, mimeType, webViewLink, createdTime, size)',
      spaces: 'drive',
    });

    const items = res.data.files || [];
    const folders = items.filter((item: any) => item.mimeType === 'application/vnd.google-apps.folder');
    const files = items.filter((item: any) => item.mimeType !== 'application/vnd.google-apps.folder');

    return { companyFolderId, folders, files };
  }

  async createSubFolder(companyName: string, folderName: string) {
    const parentId = await this.getOrCreateCompanyFolder(companyName);
    const createRes = await this.drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      },
      fields: 'id, name',
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
      });

      return response.data.webViewLink;
    } catch (error: any) {
      // This stops the terminal crash and prints only the ACTUAL 1-sentence error!
      const actualError = error.response?.data?.error?.message || error.message;
      this.logger.error(`Google Drive Upload Failed: ${actualError}`);
      throw new HttpException(actualError, HttpStatus.BAD_REQUEST);
    }
  }
}