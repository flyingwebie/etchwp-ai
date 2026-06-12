import { describe, expect, test } from "bun:test";
import { MockBridge } from "../../src/bridge/mock.ts";
import { call, connectedClient } from "../server.test.ts";

describe("etch_fields", () => {
  test("group + field + value round-trip; immediate persistence, never dirty", async () => {
    const b = new MockBridge();
    b.setHandler("fields", "createGroupAsync", (def) => {
      expect((def as any).label).toBe("Listing");
      return "grp-1";
    });
    b.setHandler("fields", "addFieldAsync", (groupId, field) => {
      expect(groupId).toBe("grp-1");
      expect((field as any).type).toBe("custom-type"); // open CustomFieldType
    });
    b.setHandler("fields", "setValuesAsync", (postId, values) => {
      expect(postId).toBe(42);
      expect(values).toEqual({ price: "100" });
    });
    b.setHandler("fields", "getValueAsync", () => ({
      post_id: 42,
      group_id: "grp-1",
      field: { key: "price", label: "Price", type: "text", value: "100" },
    }));
    const client = await connectedClient(b);

    const grp = await call(client, "etch_fields_write", {
      action: "create_group",
      definition: {
        label: "Listing",
        fields: [],
        assigned_to: { post_types: ["listing"], op: "isIn" },
      },
    });
    expect(grp.result).toBe("grp-1");
    expect(grp.persistence).toBe("immediate");
    expect(grp.dirty.page).toBe(0);

    const add = await call(client, "etch_fields_write", {
      action: "add_field",
      groupId: "grp-1",
      field: { label: "X", key: "x", type: "custom-type" },
    });
    expect(add.ok).toBe(true);

    await call(client, "etch_fields_write", {
      action: "set_values",
      postId: 42,
      values: { price: "100" },
    });
    const val = await call(client, "etch_fields_read", {
      action: "get_value",
      postId: 42,
      fieldKey: "price",
    });
    expect(val.result.field.value).toBe("100");
  });

  test("update_group warns full replacement; missing definition rejected", async () => {
    const client = await connectedClient(new MockBridge());
    const out = await call(client, "etch_fields_write", {
      action: "update_group",
      groupId: "grp-1",
    });
    expect(out.ok).toBe(false);
    expect(out.error.message).toMatch(/full|replacement/i);
  });
});
