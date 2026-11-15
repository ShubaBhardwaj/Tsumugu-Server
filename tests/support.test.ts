import { expect, test } from "bun:test";
import { assertTestDatabase } from "./helpers";
test("test database guard rejects normal databases and remote hosts", () => {
  expect(() => assertTestDatabase("postgresql://localhost/tsumugu")).toThrow();
  expect(() =>
    assertTestDatabase("postgresql://remote.example/tsumugu_test"),
  ).toThrow();
  expect(assertTestDatabase("postgresql://localhost/tsumugu_test")).toContain(
    "tsumugu_test",
  );
});
test("unstubbed external calls are blocked", async () => {
  await expect(fetch("https://api.openai.com/v1/models")).rejects.toThrow(
    "Unstubbed external call blocked",
  );
});
