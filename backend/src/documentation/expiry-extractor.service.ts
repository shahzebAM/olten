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
  // Generic date labels can belong to staff identity cards or attachments. A
  // label naming the license/permit itself identifies the primary document.
  public extractPrimaryValidity(text: string): ExtractedExpiry | null {
    const candidates = this.findCandidates(text).filter(candidate => candidate.primary);
    const dates = new Set(candidates.map(candidate => candidate.date.toISOString()));
    return dates.size === 1 ? this.toResult(candidates[0], text) : null;
  }

  public hasAmbiguousPrimaryValidity(text: string): boolean {
    const labels = text.match(/\b(?:Validity\s*of\s*(?:the\s*)?(?:License|Licence|Permit)|(?:License|Licence|Permit)\s*(?:Valid\s*Until|Expiry(?:\s*Date)?|Expiration(?:\s*Date)?))\b/gi) || [];
    const candidates = this.findCandidates(text).filter(candidate => candidate.primary);
    // A null extraction can mean missing evidence OR conflicting/unreadable
    // dates. Do not treat the latter as permission to accept any quoted date.
    return labels.length > candidates.length || new Set(candidates.map(candidate => candidate.date.toISOString())).size > 1;
  }

  public extractViaRegex(text: string): ExtractedExpiry | null {
    // This helper accepts extracted text only; PDF/image/Office binary bytes
    // must go through Gemini, never buffer.toString() and a date guess.
    if (!text || text.includes('\0')) return null;
    const candidates = this.findCandidates(text);
    if (!candidates.length) return null;
    const primary = candidates.filter(candidate => candidate.primary);
    const relevant = primary.length ? primary : candidates;
    // Different dates require document context; never pick an expired staff ID
    // merely because it is the earliest date in a primary license's appendix.
    if (new Set(relevant.map(candidate => candidate.date.toISOString())).size > 1) return null;
    return this.toResult(relevant[0], text);
  }

  private findCandidates(text: string): { date: Date; evidence: string; primary: boolean }[] {
    if (!text || text.includes('\0')) return [];
    const datePattern = '(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/-]\\d{1,2}[/-]\\d{4}|\\d{1,2}(?:st|nd|rd|th)?\\s*[A-Za-z]+\\s*\\d{4}|[A-Za-z]+\\s*\\d{1,2}(?:st|nd|rd|th)?[,]?\\s*\\d{4})';
    const expiryRegex = new RegExp(`\\b(Expiry\\s*Date|Expiration\\s*Date|Date\\s*of\\s*Expiry|Valid\\s*Until|Valid\\s*Through|Validity\\s*of\\s*(?:the\\s*)?(?:License|Licence|Permit)|(?:License|Licence|Permit)\\s*(?:Valid\\s*Until|Expiry(?:\\s*Date)?|Expiration(?:\\s*Date)?))\\s*[:\\-]?\\s*(${datePattern})(?![\\d/-])`, 'gi');
    return Array.from(text.matchAll(expiryRegex))
      .map(match => ({ date: this.parseDateString(match[2].trim()), evidence: match[0], primary: /license|licence|permit/i.test(match[1]) }))
      .filter((candidate): candidate is { date: Date; evidence: string; primary: boolean } => candidate.date !== null);
  }

  private toResult(candidate: { date: Date; evidence: string }, text: string): ExtractedExpiry {
    return {
        documentType: null,
        documentNumber: null,
        issueDate: null,
        expiryDate: candidate.date,
        renewalDate: null,
        renewalDaysBeforeExpiry: this.extractRenewalDays(text),
        expiryDateText: candidate.evidence,
        confidence: 0.95,
        reason: 'Explicit document validity label with an unambiguous calendar date in readable text.',
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

    const named = dateStr.replace(/(\d)(?:st|nd|rd|th)\b/gi, '$1').match(/^(?:(\d{1,2})\s*([A-Za-z]+)|([A-Za-z]+)\s*(\d{1,2}),?)\s*(\d{4})$/);
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
