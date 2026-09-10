import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { PrismaClient } from '@prisma/client';
import { lastValueFrom } from 'rxjs';

const prisma = new PrismaClient();

@Injectable()
export class SentryIntegrationService {
  private readonly logger = new Logger(SentryIntegrationService.name);
  
  // The internal API endpoint we found in your Network tab
  private readonly SENTRY_API_URL = 'http://192.168.0.151:5000/api/TimeLog/RecentLogs'; 

  constructor(private readonly httpService: HttpService) {}

  async syncBiometrics(company: string, targetDate: string) {
    try {
      this.logger.log(`Pulling internal Sentry logs for ${company} on ${targetDate}`);
      
      const response = await lastValueFrom(
        this.httpService.get(this.SENTRY_API_URL)
      );

      // Explicitly type as 'any' to satisfy Strict TypeScript rules
      let rawLogs: any[] = response.data?.data || response.data; 
      if (!Array.isArray(rawLogs)) {
        rawLogs = [rawLogs];
      }

      // OPTIMIZATION: Fetch all employees for this company once
      const companyEmployees = await prisma.employee.findMany({
        where: { company: company }
      });

      let successCount = 0;

      for (const log of rawLogs) {
        if (!log) continue;

        // Defensive Mapping: Scans for common Sentry Name and Time keys instead of IDs
        const rawName = log.EmployeeName || log.Name || log.FullName || log.UserName || log.employee_name || log.user;
        const rawTime = log.LogDate || log.DateTime || log.timestamp || log.Time;
        const rawType = log.Status ?? log.Type ?? log.PunchType ?? log.state; 

        if (!rawName || !rawTime) {
          this.logger.warn(`Missing Name or Time in log. Sentry sent: ${JSON.stringify(log)}`);
          continue;
        }

        // Ensure we only process logs for the specific date selected in the UI
        const logDateObj = new Date(rawTime);
        const year = logDateObj.getFullYear();
        const month = String(logDateObj.getMonth() + 1).padStart(2, '0');
        const day = String(logDateObj.getDate()).padStart(2, '0');
        const logDateString = `${year}-${month}-${day}`;

        if (logDateString !== targetDate) continue;

        // Data Isolation & Smart Name Matching 
        const sentryNameFormatted = String(rawName).trim().toLowerCase();
        
        const employee = companyEmployees.find(e => {
          const first = e.firstName.toLowerCase();
          const last = e.lastName.toLowerCase();
          
          // Check standard "First Last" and "First Middle Last" combinations
          const dbFullName1 = `${first} ${last}`;
          const dbFullName2 = `${first} ${e.middleName ? e.middleName.toLowerCase() : ''} ${last}`.replace(/\s+/g, ' ');
          
          return sentryNameFormatted === dbFullName1 || 
                 sentryNameFormatted === dbFullName2 || 
                 (sentryNameFormatted.includes(first) && sentryNameFormatted.includes(last));
        });

        if (!employee) {
          this.logger.debug(`No match found for Sentry name: ${rawName}`);
          continue; 
        }

        const timeFormatted = logDateObj.toLocaleTimeString('en-US', {
          hour12: false, hour: '2-digit', minute: '2-digit'
        });

        // '0' or 'IN' typically represents a Time In punch
        const isTimeIn = rawType === 0 || rawType === 'IN' || rawType === '0' || rawType === 'I';

        const existingRecord = await prisma.attendance.findFirst({
          where: { employeeId: employee.id, date: targetDate }
        });

        if (existingRecord) {
          await prisma.attendance.update({
            where: { id: existingRecord.id },
            data: isTimeIn ? { timeIn: timeFormatted } : { timeOut: timeFormatted }
          });
        } else {
          await prisma.attendance.create({
            data: {
              employeeId: employee.id,
              date: targetDate,
              timeIn: isTimeIn ? timeFormatted : '',
              timeOut: !isTimeIn ? timeFormatted : '',
              hours: 0,
            }
          });
        }
        successCount++;
      }
      return { success: true, importedLogs: successCount };
      
    } catch (error: any) {
      this.logger.error('Sentry connection failed', error.message || error);
      throw new HttpException('Sentry Server Offline or Invalid Response', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}