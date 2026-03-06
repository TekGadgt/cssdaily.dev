import { useRef, useEffect, useState } from 'react';
import { EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { oneDark } from '@codemirror/theme-one-dark';
import { autocompletion, acceptCompletion } from '@codemirror/autocomplete';
import { basicSetup } from 'codemirror';

interface CodeEditorProps {
  initialCss: string;
  htmlContent: string;
  onChange: (css: string) => void;
}

export default function CodeEditor({ initialCss, htmlContent, onChange }: CodeEditorProps) {
  const cssEditorRef = useRef<HTMLDivElement>(null);
  const htmlEditorRef = useRef<HTMLDivElement>(null);
  const cssViewRef = useRef<EditorView | null>(null);
  const htmlViewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [activeTab, setActiveTab] = useState<'css' | 'html'>('css');

  useEffect(() => {
    if (!cssEditorRef.current) return;

    const state = EditorState.create({
      doc: initialCss,
      extensions: [
        basicSetup,
        css(),
        oneDark,
        EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { overflow: 'auto' } }),
        keymap.of([indentWithTab, ...defaultKeymap]),
        Prec.highest(keymap.of([{ key: 'Tab', run: acceptCompletion }])),
        autocompletion(),
        EditorState.tabSize.of(2),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: cssEditorRef.current });
    cssViewRef.current = view;

    return () => view.destroy();
  }, [initialCss]);

  useEffect(() => {
    if (!htmlEditorRef.current) return;

    const state = EditorState.create({
      doc: htmlContent,
      extensions: [
        basicSetup,
        html(),
        oneDark,
        EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { overflow: 'auto' } }),
        EditorState.readOnly.of(true),
      ],
    });

    const view = new EditorView({ state, parent: htmlEditorRef.current });
    htmlViewRef.current = view;

    return () => view.destroy();
  }, [htmlContent]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-gray-700">
        <button
          className={`px-4 py-2 text-sm font-medium ${activeTab === 'css' ? 'bg-gray-800 text-white border-b-2 border-blue-500' : 'text-gray-400 hover:text-white'}`}
          onClick={() => setActiveTab('css')}
        >
          CSS
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium ${activeTab === 'html' ? 'bg-gray-800 text-white border-b-2 border-blue-500' : 'text-gray-400 hover:text-white'}`}
          onClick={() => setActiveTab('html')}
        >
          HTML (read-only)
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        <div ref={cssEditorRef} className={`h-full ${activeTab === 'css' ? '' : 'hidden'}`} />
        <div ref={htmlEditorRef} className={`h-full ${activeTab === 'html' ? '' : 'hidden'}`} />
      </div>
    </div>
  );
}
