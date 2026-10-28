import { expect, test } from "bun:test";
import { postgresPlaceholders } from "../../../../services/operations/storage/postgres";

test("only bare positional markers change", () => {
  const input = `SELECT ?, '?', 'it''s ?', "col?""?", E'escape\\'?', $$?$$, $tag$?$tag$, value$tag
-- ?
, ? /* ? /* ? */ ? */, '{"key":true}'::jsonb ?? 'key', data ??| array['?']`;
  expect(postgresPlaceholders(input, 2)).toBe(input.replace("SELECT ?", "SELECT $1").replace(", ? /*", ", $2 /*").replace(" ?? ", " ? ").replace(" ??|", " ?|"));
  expect(postgresPlaceholders("SELECT ?::text,?::int", 2)).toBe("SELECT $1::text,$2::int");
  expect(postgresPlaceholders("SELECT name$tag, $tag$?$tag$, $é$?$é$, ? -- ?\r, ?", 2))
    .toBe("SELECT name$tag, $tag$?$tag$, $é$?$é$, $1 -- ?\r, $2");
});

test("lexer validates bind counts and incomplete SQL before driver submission", () => {
  for (const input of ["SELECT '?", 'SELECT "?', "SELECT $$?", "SELECT $tag$?", "SELECT /* ? /* */", "SELECT $1"]) {
    expect(() => postgresPlaceholders(input, 0)).toThrow("INVALID_SQL");
  }
  expect(() => postgresPlaceholders("SELECT ?", 0)).toThrow("SQL_PARAMETER_COUNT");
  expect(() => postgresPlaceholders("SELECT 1", 1)).toThrow("SQL_PARAMETER_COUNT");
  expect(postgresPlaceholders("SELECT '?\\', ? -- ?", 1)).toBe("SELECT '?\\', $1 -- ?");
});
