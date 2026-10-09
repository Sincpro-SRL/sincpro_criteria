import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Meta } from "@sincpro/criteria";
import { labelOf, matches, nameOf, readCriteria } from "@sincpro/criteria";

/**
 * What sincpro_framework sends for an entity with a `presentation`, dumped from
 * `describe_class(Account, "id").model_dump(mode="json")` and pasted as it came: if the
 * engine publishes a key this type does not know, or this type requires one the engine does
 * not send, this file stops compiling.
 */
const fromTheEngine: Meta = {
  aggregate: "Account",
  identity: "id",
  default_order: "code,-amount",
  display: "name",
  search: [
    {
      field: "code",
      mode: "equal",
    },
    {
      field: "code",
      mode: "prefix",
    },
    {
      field: "name",
      mode: "contains",
    },
  ],
  detail: {
    where: null,
    order: [],
    pagination: {
      limit: 50,
      strategy: {
        token: null,
      },
    },
    specification: {
      code: {
        where: null,
        order: [],
        pagination: {
          limit: 50,
          strategy: {
            token: null,
          },
        },
        specification: null,
        grouping: {
          group_by: [],
          measures: {},
          where_measures: null,
          order: [],
          pagination: null,
        },
        count: "capped",
        meta: true,
      },
      name: {
        where: null,
        order: [],
        pagination: {
          limit: 50,
          strategy: {
            token: null,
          },
        },
        specification: null,
        grouping: {
          group_by: [],
          measures: {},
          where_measures: null,
          order: [],
          pagination: null,
        },
        count: "capped",
        meta: true,
      },
    },
    grouping: {
      group_by: [],
      measures: {},
      where_measures: null,
      order: [],
      pagination: null,
    },
    count: "capped",
    meta: true,
  },
  fields: {
    id: {
      type: "text",
      nullable: false,
      choices: [],
      exact: false,
      label: {},
      help: {},
      readonly: true,
      required: false,
      default: null,
      readonly_when: null,
      required_when: null,
      visible_when: null,
      sortable: true,
      ops: ["=", "!=", "like", "starts with", "in", "not in"],
      many: false,
      relation: null,
      identified_by: null,
      parent_field: null,
      related_field: null,
      definition: null,
      kind: "scalar",
    },
    created_at: {
      type: "datetime",
      nullable: false,
      choices: [],
      exact: false,
      label: {},
      help: {},
      readonly: true,
      required: false,
      default: null,
      readonly_when: null,
      required_when: null,
      visible_when: null,
      sortable: true,
      ops: ["=", "!=", ">", ">=", "<", "<=", "between"],
      many: false,
      relation: null,
      identified_by: null,
      parent_field: null,
      related_field: null,
      definition: null,
      kind: "scalar",
    },
    updated_at: {
      type: "datetime",
      nullable: true,
      choices: [],
      exact: false,
      label: {},
      help: {},
      readonly: true,
      required: false,
      default: null,
      readonly_when: null,
      required_when: null,
      visible_when: null,
      sortable: false,
      ops: ["=", "!=", ">", ">=", "<", "<=", "between", "is null"],
      many: false,
      relation: null,
      identified_by: null,
      parent_field: null,
      related_field: null,
      definition: null,
      kind: "scalar",
    },
    version: {
      type: "integer",
      nullable: false,
      choices: [],
      exact: false,
      label: {},
      help: {},
      readonly: true,
      required: false,
      default: 0,
      readonly_when: null,
      required_when: null,
      visible_when: null,
      sortable: true,
      ops: ["=", "!=", ">", ">=", "<", "<=", "between", "in", "not in"],
      many: false,
      relation: null,
      identified_by: null,
      parent_field: null,
      related_field: null,
      definition: null,
      kind: "scalar",
    },
    code: {
      type: "text",
      nullable: false,
      choices: [],
      exact: false,
      label: {},
      help: {},
      readonly: false,
      required: true,
      default: null,
      readonly_when: null,
      required_when: null,
      visible_when: null,
      sortable: true,
      ops: ["=", "!=", "like", "starts with", "in", "not in"],
      many: false,
      relation: null,
      identified_by: null,
      parent_field: null,
      related_field: null,
      definition: null,
      kind: "scalar",
    },
    name: {
      type: "text",
      nullable: false,
      choices: [],
      exact: false,
      label: {
        default: "Name",
        es: "Nombre",
      },
      help: {
        default: "Shown in selects",
      },
      readonly: false,
      required: false,
      default: "",
      readonly_when: null,
      required_when: null,
      visible_when: null,
      sortable: true,
      ops: ["=", "!=", "like", "starts with", "in", "not in"],
      many: false,
      relation: null,
      identified_by: null,
      parent_field: null,
      related_field: null,
      definition: null,
      kind: "scalar",
    },
    state: {
      type: "text",
      nullable: false,
      choices: ["draft", "confirmed"],
      exact: false,
      label: {},
      help: {},
      readonly: false,
      required: false,
      default: "draft",
      readonly_when: null,
      required_when: null,
      visible_when: null,
      sortable: true,
      ops: ["=", "!=", "like", "starts with", "in", "not in"],
      many: false,
      relation: null,
      identified_by: null,
      parent_field: null,
      related_field: null,
      definition: null,
      kind: "scalar",
    },
    amount: {
      type: "number",
      nullable: false,
      choices: [],
      exact: true,
      label: {},
      help: {},
      readonly: false,
      required: false,
      default: "0",
      readonly_when: {
        field: "state",
        value: "draft",
        operator: "!=",
      },
      required_when: null,
      visible_when: null,
      sortable: true,
      ops: ["=", "!=", ">", ">=", "<", "<=", "between"],
      many: false,
      relation: null,
      identified_by: null,
      parent_field: null,
      related_field: null,
      definition: null,
      kind: "scalar",
    },
    tags: {
      type: "text[]",
      nullable: false,
      choices: [],
      exact: false,
      label: {},
      help: {},
      readonly: false,
      required: false,
      default: null,
      readonly_when: null,
      required_when: null,
      visible_when: null,
      sortable: false,
      ops: ["contains", "not contains", "=", "!="],
      many: false,
      relation: null,
      identified_by: null,
      parent_field: null,
      related_field: null,
      definition: null,
      kind: "scalar",
    },
  },
  name: {
    default: "Account",
  },
};

describe("the definition the engine sends", () => {
  it("is a Meta as it comes, with what the entity declared", () => {
    assert.equal(fromTheEngine.display, "name");
    assert.deepEqual(
      fromTheEngine.search?.map((one) => `${one.mode} ${one.field}`),
      ["equal code", "prefix code", "contains name"],
    );
    assert.equal(fromTheEngine.default_order, "code,-amount");
  });

  it("names the model and its fields in the words it declared", () => {
    assert.equal(nameOf(fromTheEngine), "Account");
    assert.equal(labelOf(fromTheEngine, "name", "es"), "Nombre");
    assert.equal(labelOf(fromTheEngine, "name"), "Name");
    assert.equal(labelOf(fromTheEngine, "code"), "code");
  });

  it("carries a detail a client reads back into a criteria", () => {
    const detail = readCriteria(fromTheEngine.detail);

    assert.deepEqual(Object.keys(detail.specification ?? {}), ["code", "name"]);
  });

  it("evaluates a form hint over a decimal as a number", () => {
    const condition = fromTheEngine.fields.amount!.readonly_when!;

    assert.equal(fromTheEngine.fields.amount!.exact, true);
    assert.equal(
      matches({ state: "draft", amount: "10.00" }, condition, fromTheEngine),
      false,
    );
    assert.equal(
      matches({ state: "confirmed", amount: "10.00" }, condition, fromTheEngine),
      true,
    );
  });
});
