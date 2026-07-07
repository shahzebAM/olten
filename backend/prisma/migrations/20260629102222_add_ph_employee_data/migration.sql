/*
  Warnings:

  - A unique constraint covering the columns `[tin]` on the table `Employee` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[sssNumber]` on the table `Employee` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[philhealth]` on the table `Employee` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[pagIbig]` on the table `Employee` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "address" TEXT,
ADD COLUMN     "bankAccount" TEXT,
ADD COLUMN     "civilStatus" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN     "employmentStatus" TEXT NOT NULL DEFAULT 'Probationary',
ADD COLUMN     "pagIbig" TEXT,
ADD COLUMN     "philhealth" TEXT,
ADD COLUMN     "sssNumber" TEXT,
ADD COLUMN     "tin" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE UNIQUE INDEX "Employee_tin_key" ON "Employee"("tin");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_sssNumber_key" ON "Employee"("sssNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_philhealth_key" ON "Employee"("philhealth");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_pagIbig_key" ON "Employee"("pagIbig");
