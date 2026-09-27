/// <reference path="../pb_data/types.d.ts" />
// Sign-in policy lives in pb_hooks/auth.pb.js (Google only, from env, applied on
// every start). This file originally enabled email OTP; that was reversed the
// same day. Kept as a no-op so the applied-migrations table on existing
// instances stays consistent.
migrate((app) => {}, (app) => {});
