import { describe, expect, it } from "vitest";
import { cleanSnippet } from "./search-snippet";

function highlighted(text: string, ranges: [number, number][]) {
  const result = cleanSnippet(text, ranges);
  return {
    text: result.text,
    marks: result.ranges.map(([start, end]) => result.text.slice(start, end)),
  };
}

describe("cleanSnippet", () => {
  it("drops task markers and keeps the match on the same word", () => {
    expect(highlighted("- [x] Ship the footer", [[11, 14]])).toEqual({
      text: "Ship the footer",
      marks: ["the"],
    });
  });

  it("drops headings, quotes and ordered list markers", () => {
    expect(cleanSnippet("## Focus", []).text).toBe("Focus");
    expect(cleanSnippet("> The right amount", []).text).toBe(
      "The right amount",
    );
    expect(cleanSnippet("12. Search is instant", []).text).toBe(
      "Search is instant",
    );
  });

  it("keeps a link's label and drops its URL", () => {
    const text = "[Calm tech](https://calmtech.com/) maps onto the timeline";
    expect(
      highlighted(text, [
        [1, 5],
        [49, 57],
      ]),
    ).toEqual({
      text: "Calm tech maps onto the timeline",
      marks: ["Calm", "timeline"],
    });
  });

  it("drops strong and code marks around a match", () => {
    expect(
      highlighted("only **never** a `toast`", [
        [7, 12],
        [18, 23],
      ]),
    ).toEqual({
      text: "only never a toast",
      marks: ["never", "toast"],
    });
  });

  it("drops a match that only covered syntax", () => {
    expect(cleanSnippet("**bold**", [[0, 2]]).ranges).toEqual([]);
  });

  it("leaves single underscores and asterisks in words alone", () => {
    expect(cleanSnippet("needs last_commit_at and 2*3", []).text).toBe(
      "needs last_commit_at and 2*3",
    );
  });
});
