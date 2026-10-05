import { ExpiryExtractorService } from './expiry-extractor.service';

describe('ExpiryExtractorService', () => {
  const service = new ExpiryExtractorService();

  it('extracts only an explicit expiry date without consuming following labels', () => {
    const result = service.extractViaRegex('Issue Date: 2026-10-01\nExpiry Date: 2026-10-06\nDocument Number: ABC123');
    expect(result?.expiryDate?.toISOString()).toBe('2026-10-06T00:00:00.000Z');
    expect(result?.expiryDateText).toBe('Expiry Date: 2026-10-06');
  });

  it.each(['Expiry Date: 2026-02-30', 'Expiry Date: 29 February 2025', 'Expiry Date: 05/06/2026', 'Renewal Date: 2026-10-01', 'Birth Date: 2000-01-01', 'Expiry Date: 2026-10-06\0'])('does not guess or accept %s', text => {
    expect(service.extractViaRegex(text)).toBeNull();
  });

  it.each([
    ['Valid Until: 29 February 2024', '2024-02-29'],
    ['Valid Through: October 6th, 2026', '2026-10-06'],
    ['Expiry Date: 13/06/2026', '2026-06-13'],
    ['Expiry Date: 06/13/2026', '2026-06-13'],
    ['Expiry Date: 05/05/2026', '2026-05-05'],
    ['Validity of License:06October2026', '2026-10-06'],
  ])('accepts unambiguous readable date %s', (text, expected) => {
    expect(service.extractViaRegex(text)?.expiryDate?.toISOString().slice(0, 10)).toBe(expected);
  });

  it('does not guess between different generic expiry labels', () => {
    const result = service.extractViaRegex('Expiry Date: 2027-01-10\nValid Until: 2026-12-31');
    expect(result).toBeNull();
  });

  it('prefers the primary license validity over an expired personnel government ID', () => {
    const text = 'License Number: CDRRHR-RVII-MDI/W-207349\nValidity of License:06October2026\nQualified Personnel\nGovernment ID: Professional Regulation Commission ID0083800\nExpiry Date16June2025';
    expect(service.extractPrimaryValidity(text)?.expiryDate?.toISOString().slice(0, 10)).toBe('2026-10-06');
    expect(service.extractViaRegex(text)?.expiryDate?.toISOString().slice(0, 10)).toBe('2026-10-06');
  });

  it('reads advance renewal notice without treating a period after expiry as notice', () => {
    expect(service.extractViaRegex('Expiry Date: 2026-10-06\nRenewal notice: 30 days before expiry')?.renewalDaysBeforeExpiry).toBe(30);
    expect(service.extractViaRegex('Expiry Date: 2026-10-06\nRenewed within 30 days after expiry')?.renewalDaysBeforeExpiry).toBeNull();
  });
});
