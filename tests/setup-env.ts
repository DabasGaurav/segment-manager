// Tests run against a separate local database and fixed, non-secret keys.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres@localhost:5432/segment_manager_test";
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.SESSION_SECRET = "test-secret-0123456789abcdef0123456789abcdef";
process.env.DEMO_MODE = "true";
process.env.BIDDER_SERVICE_KEY = "sm_test_bidder_key_0123456789abcdef";
process.env.DEMO_READONLY_KEY = "sm_test_readonly_key_0123456789abcdef";
