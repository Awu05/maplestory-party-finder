ALTER TABLE "User" ALTER COLUMN "discordId" DROP NOT NULL;

CREATE TABLE "Passkey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "deviceType" TEXT NOT NULL,
    "backedUp" BOOLEAN NOT NULL,
    "transports" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Passkey_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Passkey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Passkey_userId_idx" ON "Passkey"("userId");

CREATE TABLE "PasskeyChallenge" (
    "id" TEXT NOT NULL,
    "challenge" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "userId" TEXT,
    "username" TEXT,
    "displayName" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PasskeyChallenge_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PasskeyChallenge_expiresAt_idx" ON "PasskeyChallenge"("expiresAt");
