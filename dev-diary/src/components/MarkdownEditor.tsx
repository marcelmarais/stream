import { Crepe, type CrepeConfig } from "@milkdown/crepe";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import type { FC } from "react";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

const config: CrepeConfig = {
  features: {
    [Crepe.Feature.Cursor]: false,
    [Crepe.Feature.Toolbar]: false,
    [Crepe.Feature.BlockEdit]: false,
    [Crepe.Feature.Placeholder]: false,
    [Crepe.Feature.LinkTooltip]: false,
    [Crepe.Feature.CodeMirror]: true,
  },
  featureConfigs: {
    [Crepe.Feature.CodeMirror]: {
      copyIcon: undefined,
      copyText: " ",
      languages: [],
    },
  },
};

const CrepeEditor: FC<{
  value: string;
  onChange: (value: string) => void;
  className?: string;
}> = ({ value, onChange, className = "" }) => {
  useEditor((root) => {
    const crepe = new Crepe({
      root,
      defaultValue: value,
      ...config,
    });

    // Set up change listener
    crepe.on((listener) => {
      listener.markdownUpdated((_, markdown) => {
        onChange(markdown);
      });
    });

    return crepe;
  });

  return (
    <div className={`milkdown-container ${className}`}>
      <Milkdown />
    </div>
  );
};

export function MarkdownEditor({ value, onChange }: MarkdownEditorProps) {
  return (
    <div className={`markdown-editor-wrapper`}>
      <MilkdownProvider>
        <CrepeEditor value={value} onChange={onChange} className="" />
      </MilkdownProvider>
    </div>
  );
}

export default MarkdownEditor;
