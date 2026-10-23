import { z } from "zod";
import { users } from "../db/schema";
import { isUniqueViolation } from "../db/errors";
import type { Db } from "../db/types";
import { EmailTakenError } from "../domain/errors";

const registrationSchema = z
  .object({
    email: z.email().transform((value) => value.toLowerCase()),
    displayName: z.string().trim().min(1).max(100),
  })
  .strict();

export async function registerUser(db: Db, rawInput: unknown) {
  const input = registrationSchema.parse(rawInput);
  try {
    // 不接受客户端传入 role；类型通过不代表有权写入。
    const [user] = await db
      .insert(users)
      .values(input)
      .returning({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
      });
    if (!user) throw new Error("注册没有返回用户");
    return user;
  } catch (err) {
    if (isUniqueViolation(err, "users_email_lower_uq"))
      throw new EmailTakenError(input.email);
    throw err;
  }
}
