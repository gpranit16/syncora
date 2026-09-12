// Test bootstrap: JWT secret used by authMiddleware during tests.
// No database connection is opened in tests - ../config/db is mocked per suite.
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";
process.env.NODE_ENV = process.env.NODE_ENV || "test";
