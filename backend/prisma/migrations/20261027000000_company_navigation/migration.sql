-- Company-level presentation settings. Existing operational data is unchanged.
CREATE TABLE "CompanyNavigation" (
  "company" TEXT NOT NULL,
  "groups" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedBy" INTEGER NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompanyNavigation_pkey" PRIMARY KEY ("company"),
  CONSTRAINT "CompanyNavigation_version_check" CHECK ("version" > 0),
  CONSTRAINT "CompanyNavigation_groups_check" CHECK (jsonb_typeof("groups") = 'array'),
  CONSTRAINT "CompanyNavigation_company_fkey" FOREIGN KEY ("company")
    REFERENCES "Company"("name") ON DELETE CASCADE ON UPDATE CASCADE
);
