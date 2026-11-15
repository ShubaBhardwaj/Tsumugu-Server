import { afterEach, expect, mock, spyOn, test } from "bun:test";
import {
  assertMemoryOwner,
  memoryClientProvider,
  memoryOwner,
} from "../src/lib/mem0";
import {
  deleteMemoryForUser,
  updateMemoryForUser,
} from "../src/services/memory.services";
afterEach(() => mock.restore());
test("SDK owner forms are normalized and metadata is never ownership", () => {
  expect(memoryOwner({ userId: "alice" })).toBe("alice");
  expect(memoryOwner({ user_id: "alice" })).toBe("alice");
  expect(memoryOwner({ metadata: { userId: "alice" } })).toBeUndefined();
});
test("foreign and unknown owners cannot update or delete", async () => {
  const update = mock();
  const remove = mock();
  const api = {
    get: mock(async () => ({ userId: "alice" })),
    update,
    delete: remove,
  };
  spyOn(memoryClientProvider, "get").mockReturnValue(api as any);
  await expect(
    updateMemoryForUser("bob", "m1", { memory: "changed" }),
  ).rejects.toMatchObject({ statusCode: 404 });
  await expect(deleteMemoryForUser("bob", "m1")).rejects.toMatchObject({
    statusCode: 404,
  });
  api.get.mockResolvedValue({} as any);
  await expect(assertMemoryOwner("alice", "m1")).rejects.toMatchObject({
    statusCode: 404,
  });
  expect(update).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});
test("owner can update and delete; lookup outage fails closed", async () => {
  const api = {
    get: mock(async () => ({ userId: "alice" })),
    update: mock(async () => [{ id: "m1", memory: "updated" }]),
    delete: mock(async () => ({})),
  };
  spyOn(memoryClientProvider, "get").mockReturnValue(api as any);
  await updateMemoryForUser("alice", "m1", { memory: "new" });
  await deleteMemoryForUser("alice", "m1");
  expect(api.update).toHaveBeenCalledTimes(1);
  expect(api.delete).toHaveBeenCalledTimes(1);
  api.get.mockRejectedValue(new Error("provider unavailable"));
  await expect(
    updateMemoryForUser("alice", "m1", { memory: "x" }),
  ).rejects.toMatchObject({ statusCode: 503 });
  expect(api.update).toHaveBeenCalledTimes(1);
});
