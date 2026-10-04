import { Controller, Post, Get, Delete, Patch, Param, Body, Headers, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { DocumentService } from './document.service';
import { DriveService } from './drive.service';

@Controller('api/docs')
export class DocumentController {
  constructor(
    private readonly documentService: DocumentService,
    private readonly driveService: DriveService 
  ) {}

  @Get('directory')
  async getDirectory(@Headers('x-company') company: string) {
    if (!company) throw new BadRequestException('Company header missing');
    
    const directoryData = await this.documentService.getCompanyDirectory(company);
    const storageQuota = await this.driveService.getStorageQuota();

    return {
      ...directoryData,
      storageQuota
    };
  }

  @Post('folder')
  async createFolder(
    @Headers('x-company') company: string,
    @Body() body: { folderName: string; parentFolderId?: string; targetFolderId?: string },
  ) {
    if (!company || !body.folderName) {
      throw new BadRequestException('Company and Folder Name are required');
    }

    const targetId = body.targetFolderId || body.parentFolderId;
    return this.driveService.createSubFolder(company, body.folderName, targetId);
  }

  @Patch('folder/:id/rename')
  async renameFolder(@Param('id') id: string, @Body() body: { newName: string }) {
    if (!body.newName || body.newName.trim() === '') {
      throw new BadRequestException('New folder name is required.');
    }
    return this.driveService.renameFolder(id, body.newName);
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(), 
    }),
  )
  async uploadFile(
    @UploadedFile() file: any,
    @Headers('x-company') company: string,
    @Headers('x-username') username: string,
    @Body('targetFolderId') targetFolderId?: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.documentService.processNewDocument(file, company, username, targetFolderId);
  }

  // --- NEW: ANALYZE EXPIRY DATES ---
// --- NEW: ANALYZE EXPIRY DATES ---
// --- NEW: ANALYZE EXPIRY DATES ---
  @Post('analyze-expiry')
  async analyzeExpiry(@Body() body: { fileIds: any[] }, @Headers('x-company') company: string) {
    if (!body.fileIds || !Array.isArray(body.fileIds)) throw new BadRequestException('Invalid file IDs');
    
    // Pass the IDs to the service to trigger Gemini
    return this.documentService.analyzeExpiryDates(body.fileIds, company);
  }
  // --- NEW: SAVE REMINDERS ---
  @Post('save-reminders')
  async saveReminders(@Body() body: { reminders: any[] }, @Headers('x-company') company: string) {
    if (!body.reminders || !Array.isArray(body.reminders)) throw new BadRequestException('Invalid reminders payload');
    return this.documentService.saveReminders(body.reminders, company);
  }

  @Post('search')
  async search(
    @Body('query') query: string,
    @Body('model') targetModel: string,
    @Headers('x-company') company: string,
    @Headers('x-username') username: string,
  ) {
    if (!query) throw new BadRequestException('Query cannot be empty');
    return this.documentService.searchDocuments(query, company, username, targetModel);
  }

  @Delete(':id')
  async deleteDocument(@Param('id') id: string) {
    return this.documentService.deleteDocument(id);
  }
}