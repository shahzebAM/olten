import { Controller, Post, Get, Body, Headers, UseInterceptors, UploadedFile, HttpException, HttpStatus } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentService } from './document.service';
import { diskStorage } from 'multer';
import { extname } from 'path';

@Controller('api/docs')
export class DocumentController {
  constructor(private readonly docService: DocumentService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: './uploads',
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + extname(file.originalname));
      }
    }),
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB limit
  }))
  async uploadDoc(
    @UploadedFile() file: Express.Multer.File,
    @Headers('x-company') company: string,
    @Headers('x-username') username: string,
  ) {
    if (!company) throw new HttpException('Company header required', HttpStatus.BAD_REQUEST);
    return this.docService.processNewDocument(file, company, username);
  }

  @Post('search')
  async search(
    @Body('query') query: string,
    @Headers('x-company') company: string,
    @Headers('x-username') username: string,
  ) {
    if (!company) throw new HttpException('Company header required', HttpStatus.BAD_REQUEST);
    return this.docService.searchDocuments(query, company, username);
  }
}