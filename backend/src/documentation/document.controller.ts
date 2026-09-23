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
    
    // 1. Fetch your existing directory logic
    const directoryData = await this.documentService.getCompanyDirectory(company);
    
    // 2. Fetch the new storage quota
    const storageQuota = await this.driveService.getStorageQuota();

    // 3. Merge them so the frontend gets exactly what it expects
    return {
      ...directoryData,
      storageQuota
    };
  }

  // --- THE NESTING FIX IS HERE ---
  @Post('folder')
  async createFolder(
    @Headers('x-company') company: string,
    @Body() body: { folderName: string; parentFolderId?: string; targetFolderId?: string },
  ) {
    if (!company || !body.folderName) {
      throw new BadRequestException('Company and Folder Name are required');
    }

    // Extract the parent ID sent from the frontend payload
    const targetId = body.targetFolderId || body.parentFolderId;

    // Call DriveService directly to properly nest the folder
    return this.driveService.createSubFolder(company, body.folderName, targetId);
  }

  // --- FOLDER RENAME ENDPOINT ---
  @Patch('folder/:id/rename')
  async renameFolder(@Param('id') id: string, @Body() body: { newName: string }) {
    if (!body.newName || body.newName.trim() === '') {
      throw new BadRequestException('New folder name is required.');
    }
    // We call DriveService directly here since it already handles the rename logic perfectly
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