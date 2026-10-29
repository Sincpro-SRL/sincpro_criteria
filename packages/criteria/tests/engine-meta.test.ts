import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Meta } from "@sincpro/criteria";
import {
  choiceLabelOf,
  choicesOf,
  describeRows,
  labelOf,
  matches,
  matching,
  nameOf,
  readCriteria,
  searchOver,
} from "@sincpro/criteria";

/**
 * What sincpro_framework sends for an entity with a `presentation`, a `DEFAULT_LITERAL_SEARCH`
 * and an enum that names itself and one of its values, dumped from
 * `describe_class(Account, "id").model_dump(mode="json")` and pasted as it came: if the
 * engine publishes a key this type does not know, or this type requires one the engine does
 * not send, this file stops compiling.
 */
const fromTheEngine: Meta = {
  aggregate: "Account",
  identity: "id",
  default_order: "code,-amount",
  get_id: "code",
  display: "name",
  search: {
    where: {
      any: [
        {
          field: "code",
          value: {
            $: "param",
            name: "text",
          },
          operator: "=",
        },
        {
          field: "code",
          value: {
            $: "param",
            name: "text",
          },
          operator: "starts with",
        },
        {
          field: "name",
          value: {
            $: "param",
            name: "text",
          },
          operator: "like",
        },
      ],
    },
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
      choice_labels: {},
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
      groupable: true,
      aggregates: ["min", "max", "count", "count_distinct"],
      computed: false,
      owner: null,
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
      choice_labels: {},
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
      groupable: true,
      aggregates: ["min", "max", "count", "count_distinct"],
      computed: false,
      owner: null,
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
      choice_labels: {},
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
      groupable: true,
      aggregates: ["min", "max", "count", "count_distinct"],
      computed: false,
      owner: null,
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
      choice_labels: {},
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
      groupable: true,
      aggregates: [
        "sum",
        "avg",
        "min",
        "max",
        "count",
        "count_distinct",
        "percentile",
        "median",
      ],
      computed: false,
      owner: null,
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
      choice_labels: {},
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
      groupable: true,
      aggregates: ["min", "max", "count", "count_distinct"],
      computed: false,
      owner: null,
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
      choice_labels: {},
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
      groupable: true,
      aggregates: ["min", "max", "count", "count_distinct"],
      computed: false,
      owner: null,
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
      choice_labels: {
        draft: {
          default: "Draft",
          es: "Borrador",
        },
      },
      exact: false,
      label: {
        default: "State",
        es: "Estado",
      },
      help: {},
      readonly: false,
      required: false,
      default: "draft",
      readonly_when: null,
      required_when: null,
      visible_when: null,
      sortable: true,
      groupable: true,
      aggregates: ["min", "max", "count", "count_distinct"],
      computed: false,
      owner: null,
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
      choice_labels: {},
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
      groupable: true,
      aggregates: [
        "sum",
        "avg",
        "min",
        "max",
        "count",
        "count_distinct",
        "percentile",
        "median",
      ],
      computed: false,
      owner: null,
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
      choice_labels: {},
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
      groupable: false,
      aggregates: [],
      computed: false,
      owner: null,
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
  resolvers: [
    {
      name: "today",
      returns: "date",
      params: {
        plus: "span",
        start_of: "grain",
      },
      choices: {
        plus: ["minutes", "hours", "days", "weeks", "months", "years"],
        start_of: ["day", "week", "month", "quarter", "year"],
      },
    },
    {
      name: "now",
      returns: "datetime",
      params: {
        plus: "span",
        start_of: "grain",
      },
      choices: {
        plus: ["minutes", "hours", "days", "weeks", "months", "years"],
        start_of: ["day", "week", "month", "quarter", "year"],
      },
    },
    {
      name: "period",
      returns: "range",
      params: {
        name: "period",
        unit: "grain",
        last: "integer",
        next: "integer",
        include_current: "boolean",
      },
      choices: {
        name: [
          "today",
          "yesterday",
          "tomorrow",
          "this_week",
          "last_week",
          "next_week",
          "this_month",
          "last_month",
          "next_month",
          "this_quarter",
          "last_quarter",
          "next_quarter",
          "this_year",
          "last_year",
          "next_year",
        ],
        unit: ["day", "week", "month", "quarter", "year"],
      },
    },
    {
      name: "context",
      returns: "any",
      params: {
        key: "text",
        plus: "span",
        start_of: "grain",
      },
      choices: {
        plus: ["minutes", "hours", "days", "weeks", "months", "years"],
        start_of: ["day", "week", "month", "quarter", "year"],
      },
    },
    {
      name: "param",
      returns: "any",
      params: {
        name: "text",
        plus: "span",
        start_of: "grain",
      },
      choices: {
        plus: ["minutes", "hours", "days", "weeks", "months", "years"],
        start_of: ["day", "week", "month", "quarter", "year"],
      },
    },
    {
      name: "field",
      returns: "field",
      params: {
        name: "text",
      },
      choices: {},
    },
  ],
};

describe("the definition the engine sends", () => {
  it("is a Meta as it comes, with what the entity declared", () => {
    assert.equal(fromTheEngine.display, "name");
    assert.equal(fromTheEngine.get_id, "code");
    assert.equal(fromTheEngine.default_order, "code,-amount");
    assert.deepEqual(readCriteria(fromTheEngine.search).where, {
      any: [
        { field: "code", operator: "=", value: { $: "param", name: "text" } },
        { field: "code", operator: "starts with", value: { $: "param", name: "text" } },
        { field: "name", operator: "like", value: { $: "param", name: "text" } },
      ],
    });
  });

  it("names the model and its fields in the words it declared", () => {
    assert.equal(nameOf(fromTheEngine), "Account");
    assert.equal(labelOf(fromTheEngine, "name", "es"), "Nombre");
    assert.equal(labelOf(fromTheEngine, "name"), "Name");
    assert.equal(labelOf(fromTheEngine, "code"), "code");
  });

  it("names a field that declared no label the way its enum names itself", () => {
    assert.equal(labelOf(fromTheEngine, "state", "es"), "Estado");
    assert.equal(labelOf(fromTheEngine, "state"), "State");
  });

  it("names each choice the enum named, and shows the value of the one it did not", () => {
    assert.deepEqual(choicesOf(fromTheEngine, "state", "es"), [
      { value: "draft", label: "Borrador" },
      { value: "confirmed", label: "confirmed" },
    ]);
    assert.equal(choiceLabelOf(fromTheEngine, "state", "draft", "fr"), "Draft");
    assert.deepEqual(choicesOf(fromTheEngine, "code"), []);
    assert.deepEqual(choicesOf(null, "state"), []);
  });

  it("fills the entity's own search template with what was typed", () => {
    assert.deepEqual(searchOver(fromTheEngine, " 1.1 "), {
      any: [
        { field: "code", operator: "=", value: "1.1" },
        { field: "code", operator: "starts with", value: "1.1" },
        { field: "name", operator: "like", value: "1.1" },
      ],
    });
    assert.equal(searchOver(fromTheEngine, "   "), undefined);
  });

  it("asks a select the same reading the engine's own matching builds", () => {
    assert.deepEqual(matching(fromTheEngine, "1.1"), {
      specification: {},
      pagination: { limit: 8 },
      where: searchOver(fromTheEngine, "1.1"),
    });
    assert.deepEqual(matching(fromTheEngine, ""), {
      specification: {},
      pagination: { limit: 8 },
    });
  });

  it("finds nothing for a typed text when the entity searches nothing, or before it is known", () => {
    const searchesNothing: Meta = { ...fromTheEngine, search: null };

    assert.deepEqual(matching(searchesNothing, "1.1").pagination, { limit: 0 });
    assert.equal(matching(searchesNothing, "1.1").where, undefined);
    assert.deepEqual(matching(searchesNothing, " ").pagination, { limit: 8 });
    assert.deepEqual(matching(null, "1.1").pagination, { limit: 0 });
  });

  it("searches rows in hand by their text fields, having no template to read", () => {
    const meta = describeRows([{ id: "1", code: "1.1", amount: 3 }]);

    assert.deepEqual(matching(meta, "1.1").where, {
      any: [
        { field: "id", operator: "like", value: "1.1" },
        { field: "code", operator: "like", value: "1.1" },
      ],
    });
    assert.deepEqual(matching(describeRows([{ amount: 3 }]), "x").pagination, { limit: 0 });
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
