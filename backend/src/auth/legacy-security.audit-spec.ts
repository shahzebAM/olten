import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppController } from '../app.controller';
import { AppService } from '../app.service';
import { EmployeesModule } from '../employees/employees.module';
import { EmployeesService } from '../employees/employees.service';
import { MasterInventoryController } from '../master-inventory/master-inventory.controller';
import { BooksController } from '../phase3/books.controller';
import { BooksService } from '../phase3/books.service';
import { Phase3AuthGuard } from '../phase3/phase3-auth.guard';
import { ProcurementController } from '../sales/purchase-orders.controller';
import { QuotationsController } from '../sales/quotations.controller';
import { SalesController } from '../sales/sales.controller';
import { AdminAuthGuard } from './admin-auth.guard';
import { AuthSessionService } from './auth-session.service';

// Dedicated security requirements audit. Every persistence boundary is mocked:
// this suite neither opens a database connection nor writes production data.
// Existing unsafe routes must FAIL these assertions until a fix is approved.
jest.mock('@prisma/client', () => {
  const actual =
    jest.requireActual<typeof import('@prisma/client')>('@prisma/client');
  const mockClient = {
    admin: { findMany: jest.fn().mockResolvedValue([]) },
    product: { findMany: jest.fn().mockResolvedValue([]) },
    customer: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    inventoryMovement: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    purchaseOrder: { findMany: jest.fn().mockResolvedValue([]) },
    quotation: { findMany: jest.fn().mockResolvedValue([]) },
    $disconnect: jest.fn().mockResolvedValue(undefined),
  };
  return { ...actual, PrismaClient: jest.fn(() => mockClient) };
});

describe('legacy endpoint authentication requirements audit', () => {
  let app: INestApplication<Server>;
  const employees = {
    getEmployees: jest.fn().mockResolvedValue([]),
    getPayrolls: jest.fn().mockResolvedValue([]),
    createPayroll: jest.fn().mockResolvedValue({ id: 1 }),
    deletePayroll: jest.fn().mockResolvedValue({ id: 1 }),
  };
  const sessions = {
    authenticate: jest
      .fn()
      .mockRejectedValue(
        new UnauthorizedException('A signed session is required.'),
      ),
  };
  const books = { overview: jest.fn().mockResolvedValue({}) };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      // The real AppModule imports EmployeesModule before registering its root
      // controllers. Keep this ordering so duplicate /admins routes are visible.
      imports: [EmployeesModule],
      controllers: [
        AppController,
        MasterInventoryController,
        SalesController,
        ProcurementController,
        QuotationsController,
        BooksController,
      ],
      providers: [
        AppService,
        AdminAuthGuard,
        Phase3AuthGuard,
        { provide: AuthSessionService, useValue: sessions },
        { provide: BooksService, useValue: books },
      ],
    })
      .overrideProvider(EmployeesService)
      .useValue(employees)
      .overrideProvider(AuthSessionService)
      .useValue(sessions)
      .compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    '/employees',
    '/employees/payroll/all?company=UnassignedCompany',
    '/products?company=UnassignedCompany',
    '/sales/customers?company=UnassignedCompany',
    '/procurement/purchase-orders?company=UnassignedCompany',
    '/sales/quotations?company=UnassignedCompany',
    '/admins',
  ])('requires a signed session for GET %s', async (path) => {
    await request(app.getHttpServer()).get(path).expect(401);
  });

  it('rejects unauthenticated payroll creation before calling the service', async () => {
    await request(app.getHttpServer())
      .post('/employees/payroll')
      .send({ employeeId: 1 })
      .expect(401);
    expect(employees.createPayroll).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated payroll deletion before calling the service', async () => {
    await request(app.getHttpServer())
      .delete('/employees/payroll/1')
      .expect(401);
    expect(employees.deletePayroll).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated inventory history clearing', async () => {
    await request(app.getHttpServer())
      .delete('/inventory-movements/clear/UnassignedCompany')
      .expect(401);
  });

  it('retains the existing authenticated /api/admins alias control', async () => {
    await request(app.getHttpServer()).get('/api/admins').expect(401);
  });

  it('retains the existing Books authentication control', async () => {
    await request(app.getHttpServer())
      .get('/phase3/books')
      .set('x-company', 'UnassignedCompany')
      .expect(401);
    expect(books.overview).not.toHaveBeenCalled();
  });
});
