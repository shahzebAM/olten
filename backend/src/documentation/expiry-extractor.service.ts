import { Injectable, Logger } from '@nestjs/common';

export interface ExtractedExpiry {
  documentType: string | null;
  documentNumber: string | null;
  issueDate: Date | null;
  expiryDate: Date | null;
  renewalDate: Date | null;
  renewalDaysBeforeExpiry: number | null;
  expiryDateText: string;
  confidence: number;
  reason: string;
  method: 'REGEX' | 'GEMINI' | 'MANUAL';
}

@Injectable()
export class ExpiryExtractorService {
  private readonly logger = new Logger(ExpiryExtractorService.name);

  public extractViaRegex(text: string): ExtractedExpiry | null {
    if (!text) return null;

    const expiryRegex = /(?:Expiry Date|Expiration Date|Date of Expiry|Valid Until|Valid Through|Validity of License|License Valid Until|Permit Expiry|Renewal Date)\s*[:\-]?\s*([A-Za-z0-9\s,\/\-]+)/i;
    const match = text.match(expiryRegex);

    if (!match) return null;

    const dateText = match[1].trim();
    const parsedDate = this.parseDateString(dateText);

    if (parsedDate) {
      return {
        documentType: null,
        documentNumber: null,
        issueDate: null,
        expiryDate: parsedDate,
        renewalDate: null,
        renewalDaysBeforeExpiry: this.extractRenewalDays(text),
        expiryDateText: match[0],
        confidence: 0.95,
        reason: 'Deterministic regex match based on standard label.',
        method: 'REGEX'
      };
    }

    return null;
  }

  private parseDateString(dateStr: string): Date | null {
    const pd = new Date(dateStr);
    if (!isNaN(pd.getTime())) return pd;

    const euroMatch = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (euroMatch) {
      const [_, day, month, year] = euroMatch;
      return new Date(`${year}-${month}-${day}`);
    }
    return null;
  }

  private extractRenewalDays(text: string): number | null {
    const renewalRegex = /renew(?:ed)? within (\d+) days/i;
    const match = text.match(renewalRegex);
    return match ? parseInt(match[1], 10) : null;
  }
}