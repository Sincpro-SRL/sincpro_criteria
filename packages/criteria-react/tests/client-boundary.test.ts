import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { criteria, pack, resource } from "@sincpro/criteria";
import { queryKeyFor, useBuckets, useReading } from "@sincpro/criteria-react";
import React from "react";
import { renderToString } from "react-dom/server";
import ts from "typescript";

/*
 * In a React Server Components app (Next.js App Router) a module that calls a hook must open
 * with `"use client"`: without it the bundler evaluates the module on the server, where React
 * has no `useEffect`, and the app fails to build in the consumer's code, far from the cause.
 * The reverse holds too: a module that calls none stays unmarked, so `queryKeyFor` is still
 * callable from a Server Component — a directive on `index` would make the whole package a
 * client boundary.
 */

const ROOT = join(import.meta.dirname, "..");
const SRC = join(ROOT, "src");

function modules(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return modules(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

function parsed(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
}

/** The directive as the first statement: below an import it is just a string. */
function opensWithUseClient(file: ts.SourceFile): boolean {
  const first = file.statements[0];
  return (
    first !== undefined &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === "use client"
  );
}

/**
 * Whether the module calls a hook — React's or one of ours — or creates a context. Read from
 * the syntax tree, not the text: the JSDoc examples here are full of `useReading(` and
 * `useQuery(`, and they call nothing.
 */
function callsAHook(file: ts.SourceFile): boolean {
  const visit = (node: ts.Node): boolean => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : "";
      if (/^use[A-Z]/.test(name) || name === "createContext") return true;
    }
    return ts.forEachChild(node, visit) ?? false;
  };
  return visit(file);
}

const sources = modules(SRC).map((path) => ({
  name: path.slice(SRC.length + 1),
  file: parsed(path, readFileSync(path, "utf8")),
}));

describe("the client boundary", () => {
  it('every module that calls a hook opens with "use client"', () => {
    const missing = sources
      .filter(({ file }) => callsAHook(file) && !opensWithUseClient(file))
      .map(({ name }) => name);
    assert.deepEqual(missing, [], 'add `"use client";` as the first line of these modules');
  });

  it("the modules that call none stay server modules", () => {
    const marked = sources
      .filter(({ file }) => !callsAHook(file) && opensWithUseClient(file))
      .map(({ name }) => name);
    assert.deepEqual(
      marked,
      [],
      "these call no hook: the directive keeps them off the server",
    );
  });

  it("the build emits it as the first statement of each of those modules", () => {
    const config = ts.getParsedCommandLineOfConfigFile(
      join(ROOT, "tsconfig.build.json"),
      undefined,
      { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined },
    );
    assert.ok(config, "tsconfig.build.json could not be read");

    const lost = sources
      .filter(({ file }) => callsAHook(file))
      .filter(({ name, file }) => {
        const { outputText } = ts.transpileModule(file.text, {
          compilerOptions: config.options,
          fileName: name,
        });
        return !opensWithUseClient(parsed(name.replace(/\.ts$/, ".js"), outputText));
      })
      .map(({ name }) => name);
    assert.deepEqual(lost, []);
  });
});

describe("the package root in a server render", () => {
  interface Widget {
    id: string;
    kind: string;
  }

  it("imports and renders both hooks, and queryKeyFor answers there", () => {
    const widgets = resource<Widget>({
      read: async () => ({
        rows: [],
        cursor: null,
        count: { value: 0, exact: true },
        meta: null,
        dropped: [],
      }),
    });
    function Screen() {
      const reading = useReading(widgets, criteria<Widget>().limit(10));
      const buckets = useBuckets(widgets, criteria<Widget>().groupBy("kind"));
      return React.createElement("p", null, `${reading.status}:${buckets.status}`);
    }

    assert.equal(renderToString(React.createElement(Screen)), "<p>idle:idle</p>");
    assert.deepEqual(queryKeyFor(["widgets"], {}), ["widgets", pack({})]);
  });
});
