/*
  Warnings:

  - You are about to drop the column `role` on the `RoomParticipant` table. All the data in the column will be lost.
  - Added the required column `permission` to the `RoomParticipant` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "public"."Permission" AS ENUM ('HOST', 'PLAYER', 'SPECTATOR');

-- AlterTable
ALTER TABLE "public"."RoomParticipant" DROP COLUMN "role",
ADD COLUMN     "permission" "public"."Permission" NOT NULL;

-- DropEnum
DROP TYPE "public"."Role";
