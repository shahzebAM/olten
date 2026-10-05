import { Injectable } from '@nestjs/common';
import { parseIsoDate } from './expiry-date.utils';

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
  public extractViaRegex(text: string): ExtractedExpiry | null {
    // This helper accepts extracted text only; PDF/image/Office binary bytes
    // must go through Gemini, never buffer.toString() and a date guess.
    if (!text || text.includes('\0')) return null;
    const datePattern = '(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/-]\\d{1,2}[/-]\\d{4}|\\d{1,2}(?:st|nd|rd|th)?[ \\t]+[A-Za-z]+[ \\t]+\\d{4}|[A-Za-z]+[ \\t]+\\d{1,2}(?:st|nd|rd|th)?[,]?[ \\t]+\\d{4})';
    const expiryRegex = new RegExp(`\\b(?:Expiry Date|Expiration Date|Date of Expiry|Valid Until|Valid Through|Validity of License|License Valid Until|Permit Expiry)\\s*[:\\-]?\\s*(${datePattern})(?![\\d/-])`, 'gi');
    const candidates = Array.from(text.matchAll(expiryRegex))
      .map(match => ({ date: this.parseDateString(match[1].trim()), evidence: match[0] }))
      .filter((candidate): candidate is { date: Date; evidence: string } => candidate.date !== null)
      .sort((left, right) => left.date.getTime() - right.date.getTime());
    if (!candidates.length) return null;
    const candidate = candidates[0];
    return {
        documentType: null,
        documentNumber: null,
        issueDate: null,
        expiryDate: candidate.date,
        renewalDate: null,
        renewalDaysBeforeExpiry: this.extractRenewalDays(text),
        expiryDateText: candidate.evidence,
        confidence: 0.95,
        reason: 'Explicit expiry label with an unambiguous calendar date in readable text.',
        method: 'REGEX'
    };
  }

  private parseDateString(dateStr: string): Date | null {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return parseIsoDate(dateStr);
    const numeric = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (numeric) {
      const first = Number(numeric[1]);
      const second = Number(numeric[2]);
      if (first <= 12 && second <= 12 && first !== second) return null;
      const day = first > 12 ? first : second;
      const month = first > 12 ? second : first;
      return parseIsoDate(`${numeric[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    }

    const named = dateStr.replace(/(\d)(?:st|nd|rd|th)\b/gi, '$1').match(/^(?:(\d{1,2})\s+([A-Za-z]+)|([A-Za-z]+)\s+(\d{1,2}),?)\s+(\d{4})$/);
    if (!named) return null;
    const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const monthText = (named[2] || named[3]).toLowerCase();
    const month = monthNames.findIndex(name => name === monthText || (monthText.length === 3 && name.startsWith(monthText))) + 1;
    const day = Number(named[1] || named[4]);
    return month ? parseIsoDate(`${named[5]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`) : null;
  }

  private extractRenewalDays(text: string): number | null {
    const renewalRegex = /\b(?:renew(?:al|ed)?|notice)\b[^\r\n.]{0,60}?\b(\d+)\s+days?\s+(?:before|prior to)\s+(?:the\s+)?(?:expiry|expiration)\b/i;
    const match = text.match(renewalRegex);
    const days = match ? Number(match[1]) : null;
    return days !== null && Number.isSafeInteger(days) ? days : null;
  }
}
