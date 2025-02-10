import fs from "fs";
import jwt from "jsonwebtoken";
import path from "path";

const PUBLIC_KEY = fs.readFileSync(path.join("./keys", "public.key"));
const PRIVATE_KEY = fs.readFileSync(path.join("./keys", "private.key"));

export interface IToken {
  clientId: string;
  roomId: string;
  roles: string[];
}

async function unserialize(
  authorization: string | undefined
): Promise<IToken | null> {
  if (!authorization?.startsWith("Bearer")) {
    throw new Error("Invalid authorization type, must be Bearer token");
  }
  const token = authorization!?.split(/\s+/g)?.pop();
  return jwt.verify(token!, PUBLIC_KEY, { algorithms: ["RS256"] }) as IToken;
}

async function serialize(payload: IToken): Promise<string> {
  return jwt.sign(payload, PRIVATE_KEY, {
    expiresIn: "300m",
    algorithm: "RS256",
  });
}

export default {
  serialize,
  unserialize,
};
