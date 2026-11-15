import { mock, spyOn } from "bun:test";
export { mock, spyOn };
export function assertTestDatabase(url: string) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    !/^tsumugu_test(?:_[a-z0-9_]+)?$/.test(parsed.pathname.slice(1))
  ) {
    throw new Error("Refusing to use a non-local or non-test database");
  }
  return url;
}
