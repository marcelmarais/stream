/**
 * Formats a note with Prettier's markdown printer, which keeps syntax the
 * editor doesn't render (frontmatter, wikilinks, HTML comments). Prettier is
 * loaded on the first save so it stays out of the startup bundle.
 */
export async function formatMarkdown(markdown: string) {
  const [{ format }, markdownPlugin] = await Promise.all([
    import("prettier/standalone"),
    import("prettier/plugins/markdown"),
  ]);

  return format(markdown, { parser: "markdown", plugins: [markdownPlugin] });
}
