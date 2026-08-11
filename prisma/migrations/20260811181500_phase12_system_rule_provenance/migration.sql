-- System-created safe defaults have no human configurator. Keeping this
-- nullable avoids falsely attributing an automated bootstrap action to the
-- first user found in a tenant. Human configuration APIs always set it.
ALTER TABLE "analytics_rules" ALTER COLUMN "configuredByUserId" DROP NOT NULL;
