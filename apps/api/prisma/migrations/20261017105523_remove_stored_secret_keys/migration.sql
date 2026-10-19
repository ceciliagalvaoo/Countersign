/*
  Warnings:

  - You are about to drop the column `admin_secret_key` on the `funds` table. All the data in the column will be lost.
  - You are about to drop the column `secret_key` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "funds" DROP COLUMN "admin_secret_key";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "secret_key";
