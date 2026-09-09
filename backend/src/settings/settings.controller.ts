import { Controller, Get, Post, Body, Query, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@Controller('settings')
export class SettingsController {
  
  @Get()
  async getSettings(@Query('company') company: string) {
    if (!company) return []; 
    
    try {
      // findMany automatically returns an array, which prevents frontend mapping errors
      const settingsArray = await prisma.settings.findMany({
        where: { company: company }
      });
      
      return settingsArray;
    } catch (error) {
      console.error("GET Settings Error:", error);
      return [];
    }
  }

  @Post()
  async updateSettings(@Body() data: { company: string, shiftStart: string, shiftEnd: string }) {
    if (!data.company) {
      throw new HttpException("Company is required", HttpStatus.BAD_REQUEST);
    }
    
    try {
      // 1. Find if this specific company already has a shift saved
      const existing = await prisma.settings.findFirst({
        where: { company: data.company }
      });

      if (existing) {
        // 2. Update the existing record using its unique ID
        return await prisma.settings.update({
          where: { id: existing.id },
          data: { 
            shiftStart: data.shiftStart, 
            shiftEnd: data.shiftEnd 
          }
        });
      } else {
        // 3. Create a brand new record for this company
        return await prisma.settings.create({
          data: { 
            company: data.company, 
            shiftStart: data.shiftStart, 
            shiftEnd: data.shiftEnd 
          }
        });
      }
    } catch (error: any) {
      console.error("POST Settings Error:", error);
      throw new HttpException(`Database error: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}