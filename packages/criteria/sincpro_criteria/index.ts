/* ── writing a criteria ─────────────────────────────────────────────────────────────── */
export type {
  CriteriaFor,
  CriteriaLike,
  OrderBy,
  WrittenLevel,
} from "@sincpro/criteria/criteria/builder";
export {
  criteria,
  CriteriaBuilder,
  plain,
  readLevel,
} from "@sincpro/criteria/criteria/builder";
export type { Shift, Window } from "@sincpro/criteria/criteria/dynamic";
export { dynamic, isDynamic, readValue } from "@sincpro/criteria/criteria/dynamic";
export type { Filter, Triple } from "@sincpro/criteria/criteria/filter";
export { readFilter, where } from "@sincpro/criteria/criteria/filter";
export { measure, readMeasure } from "@sincpro/criteria/criteria/measure";

/* ── what a criteria is ─────────────────────────────────────────────────────────────── */
export type {
  AnyRecord,
  Condition,
  CountMode,
  Criteria,
  Dynamic,
  DynamicKind,
  Expression,
  Fields,
  FromContext,
  FromField,
  Grain,
  Grouping,
  Level,
  Measure,
  MeasureFunction,
  NamedPeriod,
  Now,
  Operator,
  PageStrategy,
  Pagination,
  Param,
  Part,
  Period,
  PeriodName,
  Shifted,
  Sort,
  Span,
  Specification,
  Today,
  Unit,
  Value,
  WindowPeriod,
} from "@sincpro/criteria/criteria/grammar";
export {
  DYNAMIC_KINDS,
  GRAINS,
  InvalidCriteria,
  isGrain,
  isOperator,
  isPart,
  MEASURE_FUNCTIONS,
  OPERATORS,
  PARTS,
  PERIODS,
  UNITS,
} from "@sincpro/criteria/criteria/grammar";

/* ── reading one: a saved filter, a URL, what came back ─────────────────────────────── */
export { decodeBase64Url, encodeBase64Url } from "@sincpro/criteria/criteria/base64";
export {
  conditionsOf,
  isAll,
  isAny,
  isCondition,
  isNegate,
  readExpression,
} from "@sincpro/criteria/criteria/expression";
export { forSaving, merge, narrowedBy, resumingFrom } from "@sincpro/criteria/criteria/merge";
export { formatOrder, parseOrder } from "@sincpro/criteria/criteria/order";
export { pack, readCriteria, unpack } from "@sincpro/criteria/criteria/pack";

/* ── what the model says about itself ───────────────────────────────────────────────── */
export type { DescribeOptions } from "@sincpro/criteria/meta/describe";
export { describeRows } from "@sincpro/criteria/meta/describe";
export type {
  FieldKind,
  FieldMeta,
  FieldType,
  Meta,
  ResolverMeta,
  Translated,
} from "@sincpro/criteria/meta/meta";
export {
  FIELD_TYPES,
  fieldsThatFilter,
  fieldsThatGroup,
  fieldsThatSort,
  isFilterable,
  isRelational,
  labelOf,
  nameOf,
  operatorsFor,
  RESOLVERS,
  searchOver,
} from "@sincpro/criteria/meta/meta";

/* ── what an answer carries ─────────────────────────────────────────────────────────── */
export type {
  Bucket,
  Count,
  Dropped,
  DropReason,
  Envelope,
  Page,
  PaginatedResponse,
  Pivot,
  PivotCell,
} from "@sincpro/criteria/page/page";
export { pageFrom, recordsOf } from "@sincpro/criteria/page/page";

/* ── checking and printing ──────────────────────────────────────────────────────────── */
export type { ExplainOptions } from "@sincpro/criteria/explain";
export { explain, explainFilter } from "@sincpro/criteria/explain";
export type { Refusal, Validation } from "@sincpro/criteria/validate";
export { validate } from "@sincpro/criteria/validate";

/* ── where rows come from, and what drives them ─────────────────────────────────────── */
export type { BucketsState, BucketsStatus } from "@sincpro/criteria/reading/buckets";
export { Buckets } from "@sincpro/criteria/reading/buckets";
export type { ReadingState, ReadingStatus } from "@sincpro/criteria/reading/reading";
export { Reading } from "@sincpro/criteria/reading/reading";
export type { Watchable } from "@sincpro/criteria/reading/store";
export type { Resource, ResourceOptions } from "@sincpro/criteria/source/resource";
export { resource } from "@sincpro/criteria/source/resource";
export type { FromRowsOptions } from "@sincpro/criteria/source/rows";
export { fromRows } from "@sincpro/criteria/source/rows";
export type { Awaitable, LiveChannel, Source } from "@sincpro/criteria/source/source";

/* ── the two the engine lends: narrowing a list already in hand ─────────────────────── */
export { filtered, matches } from "@sincpro/criteria/engine/evaluate";
export type { Axes } from "@sincpro/criteria/engine/pivot";
export type { ResolutionContext } from "@sincpro/criteria/engine/resolve";
export { hasDynamicValues, resolve } from "@sincpro/criteria/engine/resolve";
