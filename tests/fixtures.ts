/** A small model definition, shaped exactly like the one the engine sends back. */

import type { Meta } from "@sincpro/criteria";

export interface Dataset {
  dataset_id: string;
  name: string;
  encoding: string;
  row_count: number;
  registered_at: string;
  producer_id: string | null;
  tags: string[];
}

export const datasetMeta: Meta = {
  aggregate: "Dataset",
  identity: "dataset_id",
  default_order: "-dataset_id",
  fields: {
    dataset_id: {
      type: "text",
      nullable: false,
      sortable: true,
      ops: ["=", "!=", "in", "not in", "like"],
      kind: "scalar",
    },
    name: {
      type: "text",
      nullable: false,
      sortable: true,
      ops: ["=", "!=", "in", "not in", "like"],
      kind: "scalar",
    },
    encoding: {
      type: "text",
      nullable: false,
      sortable: true,
      choices: ["utf-8", "latin-1"],
      ops: ["=", "!=", "in", "not in", "like"],
      kind: "scalar",
    },
    row_count: {
      type: "integer",
      nullable: false,
      sortable: true,
      ops: ["=", "!=", "<", "<=", ">", ">=", "between", "in", "not in"],
      kind: "scalar",
    },
    registered_at: {
      type: "datetime",
      nullable: false,
      sortable: true,
      ops: ["=", "!=", "<", "<=", ">", ">=", "between"],
      kind: "scalar",
    },
    producer_id: {
      type: "text",
      nullable: true,
      sortable: false,
      ops: ["=", "!=", "in", "not in", "like", "is null"],
      kind: "scalar",
    },
    tags: {
      type: "text[]",
      nullable: false,
      sortable: false,
      ops: ["contains", "not contains", "=", "!="],
      kind: "scalar",
    },
    runs: {
      type: "one2many",
      nullable: false,
      sortable: false,
      ops: [],
      many: true,
      relation: "Run",
      identified_by: "dataset_id",
      kind: "relation",
    },
  },
  translations: {
    name: { default: "Datasets", es: "Conjuntos" },
    labels: {
      encoding: { default: "Encoding", es: "Codificación" },
      row_count: { default: "Rows", es: "Filas" },
      registered_at: { default: "Registered", es: "Registrado" },
    },
  },
};
