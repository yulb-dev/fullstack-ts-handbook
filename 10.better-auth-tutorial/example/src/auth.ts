import { db, env } from "./db/client.js";
import { createMailer } from "./mail.js";
import { createAuth } from "./auth-factory.js";

export const auth = createAuth(db, env, createMailer(env));
