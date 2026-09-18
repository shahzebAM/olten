import { Controller, Post, Get, Delete, Param, Body, Headers, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { DocumentService } from './document.service';

@Controller('api/docs')
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  @Get('directory')
  async getDirectory(@Headers('x-company') company: string) {
    if (!company) throw new BadRequestException('Company header missing');
    return this.documentService.getCompanyDirectory(company);
  }

  @Post('folder')
  async createFolder(
    @Headers('x-company') company: string,
    @Body('folderName') folderName: string,
  ) {
    if (!company || !folderName) throw new BadRequestException('Company and Folder Name are required');
    return this.documentService.createFolder(company, folderName);
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