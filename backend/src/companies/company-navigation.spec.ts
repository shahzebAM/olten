import {
  BadRequestException,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AuthSessionService } from '../auth/auth-session.service';
import { CompanyAuthGuard } from '../auth/company-auth.guard';
import { DocumentService } from '../documentation/document.service';
import { CompaniesController } from './companies.controller';
import {
  validateCompanyNavigation,
  WORKSPACE_MODULE_IDS,
} from './company-navigation';

jest.mock('@prisma/client', () => {
  const mockClient = {
    company: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn() },
    companyNavigation: {
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  return { PrismaClient: jest.fn(() => mockClient), mockClient };
});

const prisma = jest.requireMock<{
  mockClient: {
    company: { findUnique: jest.Mock; findMany: jest.Mock; create: jest.Mock };
    companyNavigation: {
      findUnique: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
}>('@prisma/client').mockClient;
const groups = () => [
  { id: 'all-modules', title: 'All modules', items: [...WORKSPACE_MODULE_IDS] },
];

describe('company navigation validation', () => {
  it('accepts all 17 presentation IDs exactly once and trims titles without mutating the input', () => {
    const body = {
      groups: [...groups(), { id: 'empty', title: '  Later  ', items: [] }],
      version: 0,
    };
    const before = structuredClone(body);
    expect(validateCompanyNavigation(body)).toEqual({
      groups: [...groups(), { id: 'empty', title: 'Later', items: [] }],
      version: 0,
    });
    expect(body).toEqual(before);
  });

  it.each([
    undefined,
    null,
    [],
    {},
    { groups: groups() },
    { groups: groups(), version: '0' },
    { groups: groups(), version: -1 },
    { groups: groups(), version: 0.5 },
    { groups: groups(), version: 2147483647 },
    { groups: groups(), version: 0, updatedBy: 99 },
    { groups: [], version: 0 },
    { groups: [null], version: 0 },
    { groups: [...groups(), ...groups()], version: 0 },
    { groups: [{ ...groups()[0], id: '../unsafe' }], version: 0 },
    { groups: [{ ...groups()[0], id: 'a'.repeat(65) }], version: 0 },
    { groups: [{ ...groups()[0], title: ' ' }], version: 0 },
    { groups: [{ ...groups()[0], title: 'a'.repeat(61) }], version: 0 },
    { groups: [{ ...groups()[0], title: 'Hello\nWorld' }], version: 0 },
    { groups: [{ ...groups()[0], items: 'inventory' }], version: 0 },
    {
      groups: [{ ...groups()[0], items: [...WORKSPACE_MODULE_IDS, 'users'] }],
      version: 0,
    },
    {
      groups: [{ ...groups()[0], items: WORKSPACE_MODULE_IDS.slice(1) }],
      version: 0,
    },
    {
      groups: [
        { ...groups()[0], items: [...WORKSPACE_MODULE_IDS, 'inventory'] },
      ],
      version: 0,
    },
    { groups: [{ ...groups()[0], extra: 'unrecognized' }], version: 0 },
    {
      groups: [
        ...groups(),
        ...Array.from({ length: 30 }, (_, index) => ({
          id: `empty-${index}`,
          title: 'Empty',
          items: [],
        })),
      ],
      version: 0,
    },
  ])(
    'rejects incomplete, duplicate, unknown or malformed layouts: %j',
    (body) => {
      expect(() => validateCompanyNavigation(body)).toThrow(
        BadRequestException,
      );
    },
  );

  it('accepts the maximum 30 distinct groups, 64-character IDs and 60-character titles', () => {
    const body = {
      groups: [
        { ...groups()[0], id: 'a'.repeat(64), title: 't'.repeat(60) },
        ...Array.from({ length: 29 }, (_, index) => ({
          id: `empty-${index}`,
          title: 'Empty',
          items: [],
        })),
      ],
      version: 2147483646,
    };
    expect(validateCompanyNavigation(body).groups).toHaveLength(30);
  });
});

describe('company navigation HTTP authorization and optimistic persistence', () => {
  let app: INestApplication<Server>;
  let actor: { id: number; username: string; role: string; modules: unknown };
  let saved: {
    company: string;
    groups: unknown;
    version: number;
    updatedBy: number;
  } | null;
  const sessions = { authenticate: jest.fn() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CompaniesController],
      providers: [
        CompanyAuthGuard,
        { provide: AuthSessionService, useValue: sessions },
        { provide: DocumentService, useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    jest.resetAllMocks();
    actor = {
      id: 7,
      username: 'verified-admin',
      role: 'Super Admin',
      modules: {},
    };
    saved = null;
    sessions.authenticate.mockImplementation((authorization: unknown) => {
      if (authorization !== 'Bearer valid') throw new UnauthorizedException();
      return actor;
    });
    prisma.company.findUnique.mockResolvedValue({ id: 'company-id' });
    prisma.company.findMany.mockResolvedValue([{ name: 'Surgicom' }]);
    prisma.companyNavigation.findUnique.mockImplementation(
      ({ where }: { where: { company: string } }) =>
        saved?.company === where.company ? saved : null,
    );
    prisma.companyNavigation.create.mockImplementation(
      ({ data }: { data: NonNullable<typeof saved> }) => {
        if (saved)
          throw Object.assign(new Error('Already exists'), { code: 'P2002' });
        saved = structuredClone(data);
        return saved;
      },
    );
    prisma.companyNavigation.updateMany.mockImplementation(
      ({
        where,
        data,
      }: {
        where: { company: string; version: number };
        data: {
          groups: unknown;
          updatedBy: number;
          version: { increment: number };
        };
      }) => {
        if (
          !saved ||
          saved.company !== where.company ||
          saved.version !== where.version
        )
          return { count: 0 };
        saved = {
          ...saved,
          groups: structuredClone(data.groups),
          updatedBy: data.updatedBy,
          version: saved.version + data.version.increment,
        };
        return { count: 1 };
      },
    );
    prisma.$transaction.mockImplementation(
      (work: (tx: typeof prisma) => unknown) =>
        Promise.resolve().then(() => work(prisma)),
    );
  });

  const read = (company = 'Surgicom') =>
    request(app.getHttpServer())
      .get('/companies/navigation')
      .query({ company })
      .set('Authorization', 'Bearer valid');
  const write = (body: object, company = 'Surgicom') =>
    request(app.getHttpServer())
      .put('/companies/navigation')
      .query({ company })
      .set('Authorization', 'Bearer valid')
      .send(body);

  it.each(['get', 'put'] as const)(
    'requires a session for %s before reading or writing any company layout',
    async (method) => {
      await request(app.getHttpServer())
        [method]('/companies/navigation?company=Surgicom')
        .send({ groups: groups(), version: 0 })
        .expect(401);
      expect(prisma.company.findUnique).not.toHaveBeenCalled();
      expect(prisma.companyNavigation.findUnique).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('returns null/version0 when no customized company layout exists', async () => {
    const response = await read().expect(200);
    expect(response.body).toEqual({ groups: null, version: 0 });
    expect(prisma.companyNavigation.findUnique).toHaveBeenCalledWith({
      where: { company: 'Surgicom' },
    });
  });

  it('allows assigned ordinary users to read but only Super Admin to save', async () => {
    actor = {
      ...actor,
      role: 'Admin',
      modules: { companies: { Surgicom: true } },
    };
    await read().expect(200);
    await write({ groups: groups(), version: 0 }).expect(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { companies: {} },
    { companies: { Surgicom: false } },
    { companies: { Surgicom: 'true' } },
    { companies: ['Surgicom'] },
    { companies: { Another: true } },
  ])('rejects unassigned or malformed company access: %j', async (modules) => {
    actor = { ...actor, role: 'Admin', modules };
    await read().expect(403);
    expect(prisma.companyNavigation.findUnique).not.toHaveBeenCalled();
  });

  it('rejects nonexistent company access even for Super Admin', async () => {
    prisma.company.findUnique.mockResolvedValue(null);
    await read('Missing').expect(404);
    await write({ groups: groups(), version: 0 }, 'Missing').expect(404);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(['', 'x'.repeat(101), 'Surgicom\n'])(
    'rejects malformed company query values',
    async (company) => {
      await read(company).expect(400);
      expect(prisma.companyNavigation.findUnique).not.toHaveBeenCalled();
    },
  );

  it('rejects missing, repeated or conflicting company scopes and normalizes surrounding spaces', async () => {
    await request(app.getHttpServer())
      .get('/companies/navigation')
      .set('Authorization', 'Bearer valid')
      .expect(400);
    await request(app.getHttpServer())
      .get('/companies/navigation?company=Surgicom&company=Other')
      .set('Authorization', 'Bearer valid')
      .expect(400);
    await read().set('x-company', 'Other').expect(400);
    await read(' Surgicom ').set('x-company', ' Surgicom ').expect(200);
    expect(prisma.companyNavigation.findUnique).toHaveBeenLastCalledWith({
      where: { company: 'Surgicom' },
    });
  });

  it('keeps existing authenticated company-list reads available without company assignment', async () => {
    actor = { ...actor, role: 'Admin', modules: {} };
    const response = await request(app.getHttpServer())
      .get('/companies')
      .set('Authorization', 'Bearer valid')
      .expect(200);
    expect(response.body).toEqual([{ name: 'Surgicom' }]);
  });

  it('creates at version1 and updates conditionally using the verified actor, never an upsert', async () => {
    const first = await write({ groups: groups(), version: 0 }).expect(200);
    expect(first.body).toEqual({ groups: groups(), version: 1 });
    expect(prisma.companyNavigation.create).toHaveBeenCalledWith({
      data: { company: 'Surgicom', groups: groups(), version: 1, updatedBy: 7 },
    });
    actor.id = 8;
    const changed = [{ ...groups()[0], title: 'Renamed' }];
    const second = await write({ groups: changed, version: 1 }).expect(200);
    expect(second.body).toEqual({ groups: changed, version: 2 });
    expect(prisma.companyNavigation.updateMany).toHaveBeenCalledWith({
      where: { company: 'Surgicom', version: 1 },
      data: { groups: changed, updatedBy: 8, version: { increment: 1 } },
    });
    expect(saved?.updatedBy).toBe(8);
    const reload = await read().expect(200);
    expect(reload.body).toEqual(second.body);
  });

  it('rejects incomplete layouts and client-supplied metadata before any write', async () => {
    await write({ groups: [{ ...groups()[0], items: [] }], version: 0 }).expect(
      400,
    );
    await write({ groups: groups(), version: 0, updatedBy: 99 }).expect(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns409 for stale or missing update versions while preserving the saved layout', async () => {
    await write({ groups: groups(), version: 0 }).expect(200);
    const before = structuredClone(saved);
    await write({
      groups: [{ ...groups()[0], title: 'Stale' }],
      version: 0,
    }).expect(409);
    await write({
      groups: [{ ...groups()[0], title: 'Stale' }],
      version: 8,
    }).expect(409);
    expect(saved).toEqual(before);
  });

  it('allows exactly one concurrent first-save request and reports the other conflict', async () => {
    const alternate = [{ ...groups()[0], title: 'Alternate' }];
    const responses = await Promise.all([
      write({ groups: groups(), version: 0 }),
      write({ groups: alternate, version: 0 }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    expect(saved?.version).toBe(1);
    expect(saved?.groups).toEqual(
      (
        responses.find((response) => response.status === 200)?.body as {
          groups: unknown;
        }
      )?.groups,
    );
  });

  it('allows exactly one concurrent edit for the same version and preserves the winner', async () => {
    await write({ groups: groups(), version: 0 }).expect(200);
    const first = [{ ...groups()[0], title: 'First edit' }];
    const second = [{ ...groups()[0], title: 'Second edit' }];
    const responses = await Promise.all([
      write({ groups: first, version: 1 }),
      write({ groups: second, version: 1 }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    expect(saved?.version).toBe(2);
    expect(saved?.groups).toEqual(
      (
        responses.find((response) => response.status === 200)?.body as {
          groups: unknown;
        }
      )?.groups,
    );
  });

  it.each(['P2002', 'P2034', 'P2003'])(
    'reports database race %s as409 instead of silently overwriting',
    async (code) => {
      prisma.$transaction.mockRejectedValueOnce(
        Object.assign(new Error('Database race'), { code }),
      );
      await write({ groups: groups(), version: 0 }).expect(409);
      expect(saved).toBeNull();
    },
  );
});
