export class CreateEmployeeDto {
  firstName: string;
  lastName: string;
  dateOfBirth: string | Date;
  civilStatus: string;
  address: string;
  baseRate: number;
  employmentStatus: string;
  bankAccount: string;
  
  tin?: string | null;
  sssNumber?: string | null;
  philhealth?: string | null;
  pagIbig?: string | null;
}