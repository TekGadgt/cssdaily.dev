import { useRef, useEffect } from 'react';
import { EditorState, Prec, RangeSetBuilder } from '@codemirror/state';
import type { Transaction } from '@codemirror/state';
import { EditorView, Decoration, keymap } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { html } from '@codemirror/lang-html';
import { oneDark } from '@codemirror/theme-one-dark';
import { autocompletion, acceptCompletion } from '@codemirror/autocomplete';
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { basicSetup } from 'codemirror';
import tailwindClasses from '../data/tailwind-classes.json';

// Flatten all categories into a single list
const ALL_CLASSES: string[] = Object.values(tailwindClasses).flat();

// Allowed characters in class attribute values
const ALLOWED_CLASS_CHARS = /^[a-zA-Z0-9\s\-_:\/\[\]\.%#(),!]*$/;

interface TailwindEditorProps {
  initialHtml: string;
  onChange: (html: string) => void;
}

/** Find all class="..." value regions (positions of text between quotes) */
function findClassRegions(doc: string): { from: number; to: number }[] {
  const regions: { from: number; to: number }[] = [];
  const regex = /class="([^"]*)"/g;
  let match;
  while ((match = regex.exec(doc)) !== null) {
    const valueStart = match.index + 'class="'.length;
    const valueEnd = valueStart + match[1].length;
    regions.push({ from: valueStart, to: valueEnd });
  }
  return regions;
}

/** Check if a position is inside any class value region */
function isInClassRegion(pos: number, regions: { from: number; to: number }[]): boolean {
  return regions.some((r) => pos >= r.from && pos <= r.to);
}

/** Build decorations that dim everything outside class value regions */
function buildDecorations(state: EditorState): DecorationSet {
  const doc = state.doc.toString();
  const regions = findClassRegions(doc);
  const builder = new RangeSetBuilder<Decoration>();

  const dimMark = Decoration.mark({ class: 'cm-tw-locked' });
  const editableMark = Decoration.mark({ class: 'cm-tw-editable' });
  let pos = 0;

  for (const region of regions) {
    if (pos < region.from) {
      builder.add(pos, region.from, dimMark);
    }
    if (region.from < region.to) {
      builder.add(region.from, region.to, editableMark);
    }
    pos = region.to;
  }
  if (pos < doc.length) {
    builder.add(pos, doc.length, dimMark);
  }

  return builder.finish();
}

/** Tailwind class completion source */
function tailwindCompletion(context: CompletionContext): CompletionResult | null {
  const doc = context.state.doc.toString();
  const regions = findClassRegions(doc);

  if (!isInClassRegion(context.pos, regions)) return null;

  // Find the current word (class name being typed)
  const wordMatch = context.matchBefore(/[\w\-\[\]\.:%\/!#]+/);
  if (!wordMatch && !context.explicit) return null;

  const from = wordMatch ? wordMatch.from : context.pos;
  const prefix = wordMatch ? wordMatch.text : '';

  const options = ALL_CLASSES
    .filter((cls) => cls.startsWith(prefix))
    .map((cls) => ({ label: cls, type: 'class' }));

  return { from, options, filter: false };
}

export default function TailwindEditor({ initialHtml, onChange }: TailwindEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!editorRef.current) return;

    const decorationField = EditorView.decorations.compute(['doc'], (state) => {
      return buildDecorations(state);
    });

    const transactionFilter = EditorState.transactionFilter.of((tr: Transaction) => {
      if (!tr.docChanged) return tr;

      const doc = tr.startState.doc.toString();
      const regions = findClassRegions(doc);

      // Check each change is within a class region and uses allowed chars
      let valid = true;
      tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        if (!valid) return;

        // Deletion: check the deleted range is within a class region
        if (fromA !== toA) {
          if (!regions.some((r) => fromA >= r.from && toA <= r.to)) {
            valid = false;
            return;
          }
        }

        // Insertion: check position is in a class region and chars are allowed
        if (inserted.length > 0) {
          if (!isInClassRegion(fromA, regions)) {
            valid = false;
            return;
          }
          const text = inserted.toString();
          if (!ALLOWED_CLASS_CHARS.test(text)) {
            valid = false;
            return;
          }
        }
      });

      return valid ? tr : [];
    });

    const state = EditorState.create({
      doc: initialHtml,
      extensions: [
        basicSetup,
        html(),
        oneDark,
        EditorView.theme({
          '&': { height: '100%' },
          '.cm-scroller': { overflow: 'auto' },
          '.cm-tw-locked': { opacity: '0.5' },
          '.cm-tw-editable': { opacity: '1', backgroundColor: 'rgba(59, 130, 246, 0.08)' },
        }),
        keymap.of([indentWithTab, ...defaultKeymap]),
        Prec.highest(keymap.of([{ key: 'Tab', run: acceptCompletion }])),
        autocompletion({ override: [tailwindCompletion] }),
        EditorState.tabSize.of(2),
        transactionFilter,
        decorationField,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: editorRef.current });
    viewRef.current = view;

    return () => view.destroy();
  }, [initialHtml]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-gray-700">
        <div className="px-4 py-2 text-sm font-medium bg-gray-800 text-white border-b-2 border-blue-500">
          HTML (class editing only)
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <div ref={editorRef} className="h-full" />
      </div>
    </div>
  );
}
