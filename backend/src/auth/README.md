# Document API sessions

Deploy the backend and frontend updates together. The real `/auth/login` endpoint now returns an eight-hour signed bearer session; the frontend keeps it in tab-scoped session storage and sends it on document, admin and workspace requests. An expired session returns the user to login. The former hardcoded frontend developer bypass has been removed.

Set `SESSION_SECRET` to a securely generated value containing at least 32 bytes in the backend environment. `JWT_SECRET` is accepted as an alternative. Never expose the secret through a `VITE_` environment variable or commit it. All replicas must share the same value. Without a configured secret, the backend generates a secure in-memory secret, which invalidates sessions on restart and cannot support multiple replicas reliably.

The document guard validates the signature and expiry, loads current user permissions from the database, and requires access to AI Docs and the requested existing workspace. Super Admins can access existing workspaces. The server uses the authenticated username rather than trusting `x-username`. Password changes, suspension and user deletion revoke existing sessions. Admin management and company writes require a Super Admin; users can update their own presence and layout. The UI's user-edit route validates role, status and permission fields, preserves a blank password field and hashes a replacement password. New passwords must contain at least eight characters and no more than bcrypt's 72-byte limit; existing login passwords continue to work.

Demotion, suspension and deletion of an active Super Admin check the remaining active admins in the same serializable transaction as the write. Serialization conflicts retry at most three attempts, rechecking current records; a persistent conflict returns HTTP 409. This prevents concurrent management requests from removing the final active Super Admin.

Production CORS allows `https://olten.vercel.app`. Add exact additional frontend origins using comma-separated `CORS_ORIGINS` or `FRONTEND_URL`; unconfigured preview deployments are rejected. Development includes the usual localhost Vite ports. Cross-origin cookies are disabled because the API uses bearer sessions.

These guards cover documents, account administration and company management. Existing payroll, sales, inventory and other ERP controllers require a separate authorization migration before the entire ERP can be described as protected.
