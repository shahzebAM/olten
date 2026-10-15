import { Controller, Post, Get, Delete, Patch, Param, Body, Headers, Query, Res, StreamableFile, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { DocumentService } from './document.service';
import type { ReminderOptions } from './expiry-date.utils';
import { DriveService, DocumentRangeException } from './drive.service';
import { DocsAuthGuard } from '../auth/docs-auth.guard';

@Controller('api/docs')
@UseGuards(DocsAuthGuard)
export class DocumentController {
  private allowedSearchModels() {
    return new Set(['gemini-3.6-flash', 'gemini-3.5-flash-lite', process.env.GEMINI_MODEL?.trim(),
      ...(process.env.GEMINI_SEARCH_MODELS || '').split(',').map(model => model.trim())]
      .filter((model): model is string => !!model));
  }

  constructor(
    private readonly documentService: DocumentService,
    private readonly driveService: DriveService 
  ) {}

  @Get('import-links')
  async getImportLinks(@Headers('x-company') company: string) {
    return this.documentService.getImportLinks(company);
  }

  @Patch(':id/import-links')
  async updateImportLinks(
    @Param('id') id: string,
    @Headers('x-company') company: string,
    @Body()
    body: {
      importFileId?: string | null;
      shipmentId?: string | null;
      productId?: number | null;
      regulatoryStatus?: string;
      documentType?: string;
    },
  ) {
    return this.documentService.updateImportLinks(id, company, body);
  }

  @Get('directory')
  async getDirectory(@Headers('x-company') company: string) {
    if (!company) throw new BadRequestException('Company header missing');
    const directoryData = await this.documentService.getCompanyDirectory(company);
    const storageQuota = await this.driveService.getStorageQuota();
    return { ...directoryData, storageQuota };
  }

  @Post('folder')
  async createFolder(@Headers('x-company') company: string, @Body() body: { folderName: string; parentFolderId?: string; targetFolderId?: string }) {
    if (!company || !body?.folderName) throw new BadRequestException('Company and Folder Name are required');
    const targetId = body.targetFolderId || body.parentFolderId;
    return this.documentService.createFolder(company, body.folderName, targetId);
  }

  @Patch('folder/:id/rename')
  async renameFolder(@Param('id') id: string, @Headers('x-company') company: string, @Body() body: { newName: string }) {
    if (typeof body?.newName !== 'string' || body.newName.trim() === '') throw new BadRequestException('New folder name is required.');
    return this.documentService.renameFolder(id, company, body.newName);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 1 } }))
  async uploadFile(@UploadedFile() file: any, @Headers('x-company') company: string, @Headers('x-username') username: string, @Body() body: ReminderOptions & { targetFolderId?: string }) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.documentService.processNewDocument(file, company, username, body?.targetFolderId, body || {});
  }

  // --- NEW PHASE 8 ENDPOINTS ---
  @Patch(':id/manual-expiry')
  async updateManualExpiry(@Param('id') id: string, @Headers('x-company') company: string, @Body() body: ReminderOptions & { expiryDate?: string }) {
    return this.documentService.updateManualExpiry(id, company, body?.expiryDate, body || {});
  }

  @Post(':id/reanalyze')
  async reanalyzeDocument(@Param('id') id: string, @Headers('x-company') company: string) {
    return this.documentService.reanalyzeDocument(id, company);
  }

  @Post(':id/replace')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 1 } }))
  async replaceDocument(@Param('id') id: string, @UploadedFile() file: any,
    @Headers('x-company') company: string, @Headers('x-username') username: string,
    @Body('expectedDriveFileId') expectedDriveFileId?: string) {
    if (!file) throw new BadRequestException('No replacement file uploaded');
    return this.documentService.replaceDocument(id, file, company, username, expectedDriveFileId);
  }

  @Delete(':id/reminder')
  async clearReminder(@Param('id') id: string, @Headers('x-company') company: string) {
    return this.documentService.clearReminder(id, company);
  }

  @Get(':id/content')
  async getContent(@Param('id') id: string, @Headers('x-company') company: string,
    @Query('source') source: string | undefined, @Res({ passthrough: true }) response: Response,
    @Headers('range') range?: string, @Headers('if-range') ifRange?: string) {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-store');
    const content = await this.documentService.getDocumentContent(id, company, source, range, ifRange).catch(error => {
      if (error instanceof DocumentRangeException && error.totalSize !== undefined) {
        response.setHeader('Content-Range', `bytes */${error.totalSize}`);
        response.setHeader('Accept-Ranges', 'bytes');
      }
      throw error;
    });
    const allowedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp',
      'image/gif', 'image/bmp', 'image/avif']);
    const mime = String(content.mimeType || '').toLowerCase().split(';')[0].trim();
    const inline = allowedTypes.has(mime);
    const filename = String(content.name || 'document').replace(/[\u0000-\u001f\u007f\\/"<>]/g, '_')
      .slice(0, 180).replace(/[\uD800-\uDFFF]/gu, '_') || 'document';
    const encodedFilename = encodeURIComponent(filename).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    response.setHeader('Content-Type', inline ? mime : 'application/octet-stream');
    response.setHeader('Content-Encoding', 'identity');
    response.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="document"; filename*=UTF-8''${encodedFilename}`);
    if (Number.isSafeInteger(content.size) && content.size! >= 0) response.setHeader('Content-Length', content.size!);
    if (Number.isSafeInteger(content.totalSize) && content.totalSize! >= 0) response.setHeader('Accept-Ranges', 'bytes');
    if (content.etag) response.setHeader('ETag', content.etag);
    if (content.statusCode === 206 && content.contentRange) {
      response.status(206);
      response.setHeader('Content-Range', content.contentRange);
    }
    response.on('close', () => content.stream.destroy());
    return new StreamableFile(content.stream);
  }
  // -----------------------------

  @Post('analyze-expiry')
  async analyzeExpiry(@Body() body: { fileIds: any[] }, @Headers('x-company') company: string) {
    if (!Array.isArray(body?.fileIds)) throw new BadRequestException('Invalid file IDs');
    return this.documentService.analyzeExpiryDates(body.fileIds, company);
  }

  @Post('save-reminders')
  async saveReminders(@Body() body: { reminders: any[] }, @Headers('x-company') company: string) {
    if (!Array.isArray(body?.reminders)) throw new BadRequestException('Invalid reminders payload');
    return this.documentService.saveReminders(body.reminders, company);
  }

  @Get('notifications')
  async getNotifications(@Headers('x-company') company: string) {
    return this.documentService.getActiveNotifications(company);
  }

  @Patch('notifications/:id/status')
  async updateNotificationStatus(@Param('id') id: string, @Headers('x-company') company: string,
    @Body() body: { status: string; expectedExpiryDate?: string; expectedDriveFileId?: string }) {
    return this.documentService.updateNotificationStatus(Number(id), body?.status, company,
      { expectedExpiryDate: body?.expectedExpiryDate, expectedDriveFileId: body?.expectedDriveFileId });
  }

  @Post('search')
  async search(@Body('query') query: string, @Body('model') targetModel: string, @Headers('x-company') company: string, @Headers('x-username') username: string) {
    if (typeof query !== 'string' || !query.trim() || query.length > 8192) throw new BadRequestException('A query of at most 8192 characters is required');
    if (targetModel !== undefined && (typeof targetModel !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(targetModel))) throw new BadRequestException('Invalid AI model');
    if (targetModel !== undefined && !this.allowedSearchModels().has(targetModel)) throw new BadRequestException('This AI model is not enabled for document search');
    return this.documentService.searchDocuments(query, company, username, targetModel);
  }

  @Delete(':id')
  async deleteDocument(@Param('id') id: string, @Headers('x-company') company: string) {
    return this.documentService.deleteDocument(id, company);
  }
}
