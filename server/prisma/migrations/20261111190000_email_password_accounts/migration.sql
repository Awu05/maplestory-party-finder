CREATE TABLE "PasswordCredential" (
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    CONSTRAINT "PasswordCredential_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "PasswordCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PasswordCredential_email_key" ON "PasswordCredential"("email");
